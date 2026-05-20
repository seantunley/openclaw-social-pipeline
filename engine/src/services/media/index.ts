/**
 * Image-generation orchestrator. Tries providers in order; first non-empty
 * URL wins. The chain is configurable via `IMAGE_PROVIDER`:
 *
 *   fal     (default) — fal.ai → openai (Codex OAuth or API key)
 *   openai            — openai only (skip fal)
 *   fal-only          — fal only (skip openai fallback)
 *
 * If every provider in the chain fails, we throw `AllImageProvidersFailed`
 * with a multi-line message listing every attempt + workarounds — same
 * pattern as the LLM chain. The pipeline catches this and persists it on
 * the run's error state so the dashboard surfaces the real cause.
 *
 * Carousel handling: when `format` triggers fal's slide fan-out, the
 * orchestrator returns ALL slide URLs in `urls`. `url` always points at
 * the first slide (the cover) so non-carousel callers don't need to know.
 */

import {
  generateImageFal,
  buildImagePrompt,
  isCarouselFormat,
  parseSlides,
} from './fal.service.js';
import {
  generateImageOpenAI,
  type OpenAIImageInput,
} from './openai-image.service.js';
import { llmGenerate } from '../pipeline/llm.js';
import { shouldAttempt, recordSuccess, recordFailure } from './provider-health.js';

// How many softening retries we'll attempt against OpenAI's safety filter
// before giving up. Default 3 — each retry costs a small LLM call.
const MAX_SOFTEN_ATTEMPTS = Number(process.env.IMAGE_SAFETY_RETRY_MAX) || 3;

/**
 * Detect when an OpenAI image error is a safety rejection (vs auth /
 * billing / network). The exact wording varies — we check both the
 * `safety_system` phrasing and the `safety_violations` array marker
 * so future API changes don't slip through.
 */
function isOpenAISafetyRejection(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('safety system') ||
    m.includes('safety_violations') ||
    m.includes('content_policy_violation') ||
    m.includes('moderation_blocked')
  );
}

/**
 * Soften an image prompt that just hit OpenAI's safety filter. We use a
 * cheap model + a tight system prompt so the rewrite stays focused on
 * stripping flagged phrasing without changing the visual intent.
 *
 * Loud failure: if the softener itself errors, we throw and bubble up to
 * the orchestrator, which records the attempt and falls through. Never
 * silently return the original prompt.
 */
async function softenImagePrompt(
  originalPrompt: string,
  rejectionReason: string,
  attempt: number,
): Promise<string> {
  const softer = await llmGenerate(
    'You rewrite image generation prompts that have been rejected by an automated content safety filter. ' +
      'Preserve the intent, composition, lighting, and visual style of the original. ' +
      'REMOVE or REPHRASE anything the filter might be flagging (suggestive body terms, intimacy language, body-fluid references, violence, drugs). ' +
      'For medical or postpartum subjects, use clinical / documentary phrasing ("clinical postnatal photography of mother and newborn in hospital recovery room, soft natural light") not emotive / intimate phrasing. ' +
      'Output ONLY the rewritten prompt — no preamble, no explanation, no quotes.',
    `Original prompt that was rejected:\n"""${originalPrompt}"""\n\nRejection reason from the filter:\n"""${rejectionReason.slice(0, 600)}"""\n\nAttempt: ${attempt}. ${
      attempt > 1
        ? 'The previous softening was ALSO rejected — be more clinical / less evocative this time.'
        : ''
    }`,
    { model: 'claude-haiku-4-5-20251001', temperature: 0.4, maxTokens: 800, caller: 'media.prompt-softener' },
  );
  const trimmed = softer.trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!trimmed || trimmed.length < 20) {
    throw new Error(`Softener returned a too-short rewrite (${trimmed.length} chars).`);
  }
  return trimmed;
}

// Same suffix fal.service appends — applied here too so OpenAI's prompts
// match the editorial-photography quality bar.
const IMAGE_QUALITY_SUFFIX =
  'Hyper-detailed, tack sharp, anatomically perfect, natural skin texture, 8K, award-winning photography.';

// Max words of slide text the image model is asked to render. Modern image
// models (nano-banana-2, gpt-image-2) handle short legible text well but
// degrade fast past ~12-15 words — typos, wonky kerning, mismatched
// repeated lines. Operators wanting longer text should regenerate per
// slide with a custom prompt.
const TEXT_OVERLAY_MAX_WORDS = 12;

/**
 * Build the text-overlay instruction suffix for a single carousel slide.
 * - Strips markdown / slide markers so they don't get rendered into the
 *   image as literal '##' characters.
 * - Caps to TEXT_OVERLAY_MAX_WORDS so the image model has a fighting chance
 *   of rendering it without typos.
 * - Returns "" when the slide has no usable text — caller treats absence as
 *   "no overlay this slide".
 */
export function buildTextOverlayInstruction(slideText: string): string {
  const cleaned = slideText
    .replace(/^##?\s*Slide\s+\d+\s*$/gim, '')
    .replace(/^\*\*Slide\s+\d+\*\*\s*$/gim, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/[#*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ');
  const capped = words.slice(0, TEXT_OVERLAY_MAX_WORDS).join(' ');
  const suffix = words.length > TEXT_OVERLAY_MAX_WORDS ? '…' : '';
  return (
    ` RENDER THIS EXACT TEXT INTO THE IMAGE in clean modern editorial typography ` +
    `(sans-serif, high contrast, placed on a subtle banner / lower-third / negative space ` +
    `area that doesn't obscure the subject): "${capped}${suffix}". Spell every word correctly.`
  );
}

type FalParams = Parameters<typeof generateImageFal>[0];

export interface ImageProviderResult {
  /** Cover image URL (`urls[0]`). Empty string when every provider failed. */
  url: string;
  /** All generated image URLs. Length > 1 only on carousel format. */
  urls: string[];
  /**
   * The exact editorial prompt sent to the provider — one per `urls`.
   * Persisted on `social_media_asset.prompt` so the dashboard can show
   * and edit it for the next regenerate. Empty array when no images.
   */
  prompts: string[];
  provider: 'fal' | 'openai' | 'none';
  /** Per-attempt diagnostic — every provider tried + what happened. */
  attempts: ImageAttempt[];
}

export interface ImageAttempt {
  provider: 'fal' | 'openai';
  ok: boolean;
  error?: string;
  workaround?: string;
}

export interface OrchestratorInput {
  title: string;
  body: string;
  platform: string;
  aspectRatio?: string;
  format?: string;
  preferOnly?: 'fal' | 'openai';
  /**
   * Operator-edited prompt from the Media tab's "Regenerate" flow. Skips
   * the LLM-driven prompt builder and uses this verbatim against fal /
   * OpenAI. The same prompt is shared across every slide on carousel.
   */
  customPrompt?: string;
  /**
   * When true on carousel runs, the per-slide prompt builder appends an
   * instruction asking the image model to render the slide's text INTO
   * the image (clean editorial typography on a banner / lower-third).
   * Ignored on single-image runs and on customPrompt regenerations.
   */
  textOverlay?: boolean;
}

export class AllImageProvidersFailed extends Error {
  attempts: ImageAttempt[];
  /**
   * The editorial prompt that was built and attempted — even though no
   * provider produced an image, the operator should still be able to edit
   * this in the regenerate UI rather than seeing a generic placeholder.
   * Empty string only when the prompt builder itself failed.
   */
  attemptedPrompt: string;
  constructor(attempts: ImageAttempt[], attemptedPrompt = "") {
    const lines = attempts.map(
      (a) => `  • ${a.provider}: ${a.error ?? 'unknown'}${a.workaround ? ` — ${a.workaround}` : ''}`,
    );
    super(
      `Every image provider failed:\n${lines.join('\n')}\n\n` +
        `Workarounds:\n` +
        `  1. Check FAL_API_KEY in engine/.env (https://fal.ai/dashboard/keys)\n` +
        `  2. Sign in with ChatGPT (run 'codex login') to use OpenAI image gen via OAuth\n` +
        `  3. Set OPENAI_API_KEY in engine/.env to use the direct OpenAI images endpoint\n` +
        `  4. Set IMAGE_PROVIDER=openai (or fal-only) in engine/.env to skip the failing provider`,
    );
    this.name = 'AllImageProvidersFailed';
    this.attempts = attempts;
    this.attemptedPrompt = attemptedPrompt;
  }
}

function deriveImageWorkaround(provider: 'fal' | 'openai', err: string): string | undefined {
  const m = err.toLowerCase();
  if (provider === 'fal') {
    if (m.includes('timed out')) return 'fal queue overloaded — retry, or set IMAGE_PROVIDER=openai';
    if (m.includes('401') || m.includes('unauthorized')) return 'Check FAL_API_KEY in engine/.env';
    if (m.includes('no fal.ai api key')) return 'Set FAL_API_KEY in engine/.env';
  }
  if (provider === 'openai') {
    if (m.includes('no openai auth')) return 'Run `codex login` or set OPENAI_API_KEY in engine/.env';
    if (m.includes('401') || m.includes('unauthorized')) return 'Codex token expired — re-run `codex login`';
    if (m.includes('quota') || m.includes('billing')) return 'Top up OpenAI credits, or use Codex OAuth (`codex login`)';
    if (m.includes('does not exist') || m.includes('model_not_found') || m.includes('not enabled'))
      return 'gpt-image-2 not available on this account — set OPENAI_IMAGE_MODEL=gpt-image-1 in engine/.env';
  }
  return undefined;
}

function resolveImageProviderPref(): 'fal-then-openai' | 'openai-only' | 'fal-only' {
  const raw = (process.env.IMAGE_PROVIDER ?? '').toLowerCase().trim();
  if (raw === 'openai') return 'openai-only';
  if (raw === 'fal-only') return 'fal-only';
  return 'fal-then-openai';
}

export async function generateImage(
  input: OrchestratorInput,
): Promise<ImageProviderResult> {
  const attempts: ImageAttempt[] = [];

  // Build the editorial prompt ONCE, up here in the orchestrator, instead
  // of letting each provider build its own. fal accepted a customPrompt
  // already; OpenAI was previously using a cheap "${title}. ${body}"
  // string which produced generic stock-photo prompts. By hoisting, both
  // providers share the same TIME-Magazine-quality editorial prompt that
  // buildImagePrompt produces — and the operator's edited prompt (if any)
  // skips the LLM build entirely.
  //
  // Carousel runs are the exception: fal needs slide-text so it can build
  // a unique prompt per slide. We let fal handle that internally by NOT
  // passing customPrompt for carousel + no custom override.
  const isCarousel = isCarouselFormat(input.format);
  const editorialPromptRaw = input.customPrompt
    ? input.customPrompt
    : isCarousel
      ? null // skip — fal will build per-slide prompts
      : await buildImagePrompt(input.title, input.body, input.platform);
  const editorialPrompt = editorialPromptRaw
    ? editorialPromptRaw.endsWith('.')
      ? `${editorialPromptRaw} ${IMAGE_QUALITY_SUFFIX}`
      : `${editorialPromptRaw}. ${IMAGE_QUALITY_SUFFIX}`
    : null;

  type Attempt = { urls: string[]; prompts: string[] } | null;

  const tryFal = async (): Promise<Attempt> => {
    // Circuit breaker — skip when fal is in cool-down. The orchestrator
    // records this as an attempt so the operator can see "fal skipped (in
    // cooldown — last error: 401, retrying in 4m)".
    if (!shouldAttempt('fal')) {
      attempts.push({
        provider: 'fal',
        ok: false,
        error: 'breaker open — skipped, retrying after cooldown',
        workaround: 'auto-routing around fal until cooldown ends',
      });
      return null;
    }
    try {
      const params: FalParams = {
        title: input.title,
        body: input.body,
        platform: input.platform,
        aspectRatio: input.aspectRatio,
        format: input.format,
        customPrompt: editorialPrompt ?? input.customPrompt,
        textOverlay: input.textOverlay && isCarousel ? true : false,
      };
      const result = await generateImageFal(params);
      if (result.urls.length === 0) {
        recordFailure('fal', 'fal returned no urls');
        attempts.push({ provider: 'fal', ok: false, error: 'fal returned no urls', workaround: deriveImageWorkaround('fal', 'no urls') });
        return null;
      }
      recordSuccess('fal');
      attempts.push({ provider: 'fal', ok: true });
      return { urls: result.urls, prompts: result.prompts };
    } catch (err) {
      const msg = (err as Error).message;
      recordFailure('fal', msg);
      attempts.push({ provider: 'fal', ok: false, error: msg, workaround: deriveImageWorkaround('fal', msg) });
      return null;
    }
  };

  // ── one-shot OpenAI image gen with the safety-softening retry loop ────────
  // Pure function over a single starting prompt. Returns the final URL +
  // the prompt that succeeded, or null on hard failure. Each invocation
  // records its own attempts onto the shared `attempts` array so the
  // operator can trace every retry in the SOC / run detail.
  //
  // Extracted from the old inline tryOpenAI so carousel can call it once
  // per slide in parallel (parity with fal's per-slide fan-out). Before
  // this refactor, OpenAI fallback for carousel produced ONE image —
  // every slide of the carousel rendered the same picture.
  const tryOpenAIOnce = async (
    startingPrompt: string,
    slideLabel?: string,
  ): Promise<{ url: string; prompt: string } | null> => {
    let currentPrompt = startingPrompt;
    let lastRejection = '';
    const tag = slideLabel ? ` (${slideLabel})` : '';
    for (let attemptNum = 0; attemptNum <= MAX_SOFTEN_ATTEMPTS; attemptNum += 1) {
      try {
        const openaiInput: OpenAIImageInput = {
          prompt: currentPrompt,
          aspectRatio: input.aspectRatio,
        };
        const result = await generateImageOpenAI(openaiInput);
        if (!result.url) {
          attempts.push({
            provider: 'openai',
            ok: false,
            error: `openai returned empty url${tag}`,
            workaround: deriveImageWorkaround('openai', 'empty url'),
          });
          return null;
        }
        recordSuccess('openai');
        if (attemptNum > 0) {
          attempts.push({
            provider: 'openai',
            ok: true,
            error: `(succeeded after ${attemptNum} safety-softening retry${attemptNum > 1 ? 'ies' : ''})${tag}`,
          });
        } else {
          attempts.push({ provider: 'openai', ok: true, error: tag || undefined });
        }
        return { url: result.url, prompt: currentPrompt };
      } catch (err) {
        const msg = (err as Error).message;
        if (!isOpenAISafetyRejection(msg)) {
          recordFailure('openai', msg);
          attempts.push({
            provider: 'openai',
            ok: false,
            error: `${msg}${tag}`,
            workaround: deriveImageWorkaround('openai', msg),
          });
          return null;
        }
        lastRejection = msg;
        attempts.push({
          provider: 'openai',
          ok: false,
          error: `safety filter rejected (attempt ${attemptNum + 1}/${MAX_SOFTEN_ATTEMPTS + 1})${tag}: ${msg.slice(0, 200)}`,
          workaround:
            attemptNum < MAX_SOFTEN_ATTEMPTS
              ? `softening prompt and retrying…`
              : `out of softening retries; give up.`,
        });
        if (attemptNum >= MAX_SOFTEN_ATTEMPTS) return null;
        try {
          currentPrompt = await softenImagePrompt(currentPrompt, lastRejection, attemptNum + 1);
        } catch (softenErr) {
          attempts.push({
            provider: 'openai',
            ok: false,
            error: `prompt softener failed on attempt ${attemptNum + 1}${tag}: ${(softenErr as Error).message}`,
            workaround: 'Check ANTHROPIC_API_KEY / Codex login — the softener uses an LLM call.',
          });
          return null;
        }
      }
    }
    return null;
  };

  const tryOpenAI = async (): Promise<Attempt> => {
    if (!shouldAttempt('openai')) {
      attempts.push({
        provider: 'openai',
        ok: false,
        error: 'breaker open — skipped, retrying after cooldown',
        workaround: 'auto-routing around openai until cooldown ends',
      });
      return null;
    }

    // ── Carousel fan-out ───────────────────────────────────────────────────
    // For carousel formats, parse the draft body into slides and generate
    // ONE image per slide in parallel — same shape as fal's per-slide flow.
    // Each slide gets its own editorial prompt with that slide's specific
    // text + a "slide N" suffix so the model differentiates visuals.
    //
    // If the operator passed a customPrompt, we apply it across every
    // slide unchanged (matches fal's policy — operators wanting per-slide
    // variation should regenerate per asset, not via the global override).
    if (isCarousel && !input.customPrompt) {
      const slides = parseSlides(input.body).slice(0, 8);
      const built = await Promise.all(
        slides.map(async (slideText, i) => {
          const raw = await buildImagePrompt(
            `${input.title} — slide ${i + 1}`,
            slideText,
            input.platform,
          );
          const base = raw.endsWith('.')
            ? `${raw} ${IMAGE_QUALITY_SUFFIX}`
            : `${raw}. ${IMAGE_QUALITY_SUFFIX}`;
          const overlay = input.textOverlay
            ? buildTextOverlayInstruction(slideText)
            : '';
          return `${base}${overlay}`;
        }),
      );
      const results = await Promise.all(
        built.map((p, i) => tryOpenAIOnce(p, `slide ${i + 1}/${built.length}`)),
      );
      const urls: string[] = [];
      const prompts: string[] = [];
      for (const r of results) if (r) { urls.push(r.url); prompts.push(r.prompt); }
      if (urls.length === 0) return null;
      return { urls, prompts };
    }

    // ── Single-image path ──────────────────────────────────────────────────
    // Use the orchestrator's editorial prompt (same one fal would use).
    // For carousel-with-customPrompt we land here too — one image with the
    // operator's override, replicated across slides at the storage layer
    // is wrong (it would lose the per-slide differentiation point), so we
    // still fan out: parse slides and replicate the customPrompt N times.
    if (isCarousel && input.customPrompt) {
      const slides = parseSlides(input.body).slice(0, 8);
      const results = await Promise.all(
        slides.map((_, i) =>
          tryOpenAIOnce(
            `${input.customPrompt}. ${IMAGE_QUALITY_SUFFIX}`,
            `slide ${i + 1}/${slides.length}`,
          ),
        ),
      );
      const urls: string[] = [];
      const prompts: string[] = [];
      for (const r of results) if (r) { urls.push(r.url); prompts.push(r.prompt); }
      if (urls.length === 0) return null;
      return { urls, prompts };
    }

    const basePrompt =
      editorialPrompt ??
      (input.customPrompt ??
        `${(await buildImagePrompt(input.title, input.body, input.platform)).trim()}. ${IMAGE_QUALITY_SUFFIX}`);
    const r = await tryOpenAIOnce(basePrompt);
    if (!r) return null;
    return { urls: [r.url], prompts: [r.prompt] };
  };

  const wrap = (
    a: Attempt,
    provider: 'fal' | 'openai',
  ): ImageProviderResult => ({
    url: a?.urls[0] ?? '',
    urls: a?.urls ?? [],
    prompts: a?.prompts ?? [],
    provider: a ? provider : 'none',
    attempts,
  });

  if (input.preferOnly === 'openai') {
    const r = await tryOpenAI();
    if (r) return wrap(r, 'openai');
    throw new AllImageProvidersFailed(attempts, editorialPrompt ?? "");
  }
  if (input.preferOnly === 'fal') {
    const r = await tryFal();
    if (r) return wrap(r, 'fal');
    throw new AllImageProvidersFailed(attempts, editorialPrompt ?? "");
  }

  const pref = resolveImageProviderPref();

  if (pref === 'openai-only') {
    const r = await tryOpenAI();
    if (r) return wrap(r, 'openai');
    throw new AllImageProvidersFailed(attempts, editorialPrompt ?? "");
  }
  if (pref === 'fal-only') {
    const r = await tryFal();
    if (r) return wrap(r, 'fal');
    throw new AllImageProvidersFailed(attempts, editorialPrompt ?? "");
  }

  // Default chain: fal → openai
  const falUrls = await tryFal();
  if (falUrls) return wrap(falUrls, 'fal');

  const openaiUrls = await tryOpenAI();
  if (openaiUrls) return wrap(openaiUrls, 'openai');

  throw new AllImageProvidersFailed(attempts);
}
