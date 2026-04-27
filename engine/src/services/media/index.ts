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

import { generateImageFal, buildImagePrompt } from './fal.service.js';
import {
  generateImageOpenAI,
  type OpenAIImageInput,
} from './openai-image.service.js';

// Same suffix fal.service appends — applied here too so OpenAI's prompts
// match the editorial-photography quality bar.
const IMAGE_QUALITY_SUFFIX =
  'Hyper-detailed, tack sharp, anatomically perfect, natural skin texture, 8K, award-winning photography.';

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
}

export class AllImageProvidersFailed extends Error {
  attempts: ImageAttempt[];
  constructor(attempts: ImageAttempt[]) {
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
  const isCarousel =
    !!input.format &&
    (input.format === 'instagram_carousel' ||
      input.format.endsWith('_carousel') ||
      input.format === 'carousel');
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
    try {
      const params: FalParams = {
        title: input.title,
        body: input.body,
        platform: input.platform,
        aspectRatio: input.aspectRatio,
        format: input.format,
        // Pass the orchestrator-built prompt so fal doesn't rebuild it.
        // For carousel + no customPrompt, this is null and fal builds per-slide.
        customPrompt: editorialPrompt ?? input.customPrompt,
      };
      const result = await generateImageFal(params);
      if (result.urls.length === 0) {
        attempts.push({ provider: 'fal', ok: false, error: 'fal returned no urls', workaround: deriveImageWorkaround('fal', 'no urls') });
        return null;
      }
      attempts.push({ provider: 'fal', ok: true });
      return { urls: result.urls, prompts: result.prompts };
    } catch (err) {
      const msg = (err as Error).message;
      attempts.push({ provider: 'fal', ok: false, error: msg, workaround: deriveImageWorkaround('fal', msg) });
      return null;
    }
  };

  const tryOpenAI = async (): Promise<Attempt> => {
    try {
      // Use the orchestrator's editorial prompt (same one fal would use).
      // For carousel where editorialPrompt was deferred to fal's per-slide
      // builder, build a single one-shot prompt here so OpenAI still gets
      // a rich prompt rather than the old "${title}. ${body}" stub.
      const promptForOpenAI =
        editorialPrompt ??
        (input.customPrompt ??
          `${(await buildImagePrompt(input.title, input.body, input.platform)).trim()}. ${IMAGE_QUALITY_SUFFIX}`);
      const openaiInput: OpenAIImageInput = {
        prompt: promptForOpenAI,
        aspectRatio: input.aspectRatio,
      };
      const result = await generateImageOpenAI(openaiInput);
      if (!result.url) {
        attempts.push({ provider: 'openai', ok: false, error: 'openai returned empty url', workaround: deriveImageWorkaround('openai', 'empty url') });
        return null;
      }
      attempts.push({ provider: 'openai', ok: true });
      return { urls: [result.url], prompts: [promptForOpenAI] };
    } catch (err) {
      const msg = (err as Error).message;
      attempts.push({ provider: 'openai', ok: false, error: msg, workaround: deriveImageWorkaround('openai', msg) });
      return null;
    }
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
    throw new AllImageProvidersFailed(attempts);
  }
  if (input.preferOnly === 'fal') {
    const r = await tryFal();
    if (r) return wrap(r, 'fal');
    throw new AllImageProvidersFailed(attempts);
  }

  const pref = resolveImageProviderPref();

  if (pref === 'openai-only') {
    const r = await tryOpenAI();
    if (r) return wrap(r, 'openai');
    throw new AllImageProvidersFailed(attempts);
  }
  if (pref === 'fal-only') {
    const r = await tryFal();
    if (r) return wrap(r, 'fal');
    throw new AllImageProvidersFailed(attempts);
  }

  // Default chain: fal → openai
  const falUrls = await tryFal();
  if (falUrls) return wrap(falUrls, 'fal');

  const openaiUrls = await tryOpenAI();
  if (openaiUrls) return wrap(openaiUrls, 'openai');

  throw new AllImageProvidersFailed(attempts);
}
