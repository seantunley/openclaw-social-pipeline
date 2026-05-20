/**
 * fal.ai Media Generation Service
 *
 * Ported from content-machine with full tuning:
 *   Image: fal-ai/nano-banana-2 — editorial photography quality
 *   Video: kling-v3 (default), wan-2.7, sora-2, longcat
 *
 * Pipeline:
 *   1. AI generates a precise editorial visual prompt from content
 *   2. fal.ai renders at the correct aspect ratio for the platform
 *   3. Quality suffix appended for photorealism
 */

import { createFalClient } from '@fal-ai/client';
import { llmGenerate } from '../pipeline/llm.js';
import { getPlatformSpec, resolveFormat } from '../platform/specs.js';

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function getClient(): ReturnType<typeof createFalClient> {
  const credentials = process.env.FAL_API_KEY ?? '';
  if (!credentials) throw new Error('No fal.ai API key configured. Set FAL_API_KEY in .env');
  return createFalClient({ credentials });
}

// fal.subscribe blocks on the queued job's webhook callback and has been
// observed to hang indefinitely when fal's queue is overloaded. Wrap each
// call in a hard timeout so the orchestrator can fall through to the next
// provider instead of stalling the entire run.
const FAL_TIMEOUT_MS = Number(process.env.FAL_TIMEOUT_MS) || 90_000;
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// Aspect-ratio resolution
// ---------------------------------------------------------------------------
//
// Aspect comes from the platform spec — either the platform default, or a
// declared alt-format override (carousel, reel, story, short, landscape,
// square, etc.). All format ids the dashboard sends through must exist on
// the platform's `altFormats` list, otherwise we fall back to the default.

function resolveAspectRatio(platform: string, format?: string): string {
  const spec = getPlatformSpec(platform);
  const fmt = resolveFormat(spec, format);
  return fmt?.aspectRatio ?? spec.media.imageAspectRatio;
}

/**
 * True when this platform/format combination should fan out one image per
 * slide rather than one image per post. Currently the only fan-out format
 * is carousel; reels/stories/landscape are still single-image.
 */
export function isCarouselFormat(format: string | undefined): boolean {
  if (!format) return false;
  return format === 'instagram_carousel' || format.endsWith('_carousel') || format === 'carousel';
}

/**
 * The closed set of aspect ratios fal.ai's nano-banana-2 image endpoint
 * accepts. Anything outside this set 400s on the SDK; we narrow inputs
 * to it before calling subscribe().
 */
const FAL_ASPECT_RATIOS = [
  '1:1', '4:5', '9:16', '16:9', '3:4', '4:3', '21:9', '3:2', '5:4', '2:3',
] as const;
type FalAspectRatio = typeof FAL_ASPECT_RATIOS[number];

function narrowAspectRatio(value: string): FalAspectRatio {
  return (FAL_ASPECT_RATIOS as readonly string[]).includes(value)
    ? (value as FalAspectRatio)
    : '1:1';
}

/** Map aspect ratio string to fal.ai image_size preset */
function aspectRatioToImageSize(aspectRatio: string): string {
  const map: Record<string, string> = {
    '9:16': 'portrait_16_9',
    '4:5': 'portrait_4_3',
    '1:1': 'square_hd',
    '16:9': 'landscape_16_9',
    '4:3': 'landscape_4_3',
  };
  return map[aspectRatio] ?? 'landscape_16_9';
}

// ---------------------------------------------------------------------------
// Quality suffix — appended to every image prompt
// ---------------------------------------------------------------------------

const IMAGE_QUALITY_SUFFIX =
  'Hyper-detailed, tack sharp, anatomically perfect, natural skin texture, 8K, award-winning photography.';

// ---------------------------------------------------------------------------
// Image Prompt Builder (editorial photography director)
// ---------------------------------------------------------------------------

const IMAGE_PROMPT_SYSTEM = `You are a world-class photo director writing prompts for FLUX 2 Max / gpt-image-2 — high-quality AI photorealism models.

Your prompts must produce images indistinguishable from real editorial photography, while passing image-model safety filters and matching prompt complexity to topic.

CRITICAL SAFETY-FILTER RULES (these are how prompts get blocked):

1. NEVER reference a named living or recognizable photographer's style. Do NOT write "in the style of Annie Leibovitz / Steve McCurry / Martin Schoeller / Platon / Tim Walker / Peter Lindbergh / [any named photographer]". Style-replication is auto-rejected. Instead use generic descriptors: "editorial photography", "documentary-style", "cinematic", "lifestyle photography", "photojournalistic", "fine-art portrait".
2. Sensitive subjects (breastfeeding, postpartum, recovery, intimacy, vulnerability, medical procedure, children) ARE allowed when framed as maternal / nurturing / non-sexual / clinical. Keep the register tender and tasteful. Avoid: explicit body-part nouns, sexualized language, exposed-body framing. Prefer: "cradling", "softly lit", "tender", "quiet", "protective", focus on connection and atmosphere.
3. NO public figures, named brands/logos/trademarks, copyrighted characters, or weapons.
4. NO text, words, signs, watermarks, or readable typography in the scene.

STEP 1 — Classify the content into ONE of these visual modes (silently — do NOT print the mode):

  A. HUMAN-MOMENT — parenting, relationships, daily life, lifestyle, healthcare, food culture, sports.
     → Rich editorial-photo prompt with a real subject in an unposed moment. For sensitive topics (breastfeeding, postpartum, mental health, medical, vulnerability, children) describe the moment with maternal/nurturing register: cradling, soft natural light, tender expression, intimate but non-sexual, protective hand position, cozy environment. Subject can appear at any framing as long as the register is non-sexual and clothing is appropriate.
  B. EDITORIAL-PEOPLE — interviews, profiles, athletes, artists.
     → Editorial portrait prompt with subject, lens, lighting, mood. NO photographer-name reference.
  C. B2B / TECH / PROFESSIONAL — software, SaaS, AI, ops, productivity, analytics, enterprise.
     → Minimal conceptual photograph: clean object on neutral background, quiet workspace, abstract still-life. No people. Short prompt (2–4 sentences). Light styling.
  D. ABSTRACT / DATA / FRAMEWORK — concepts, methodologies, decision frameworks.
     → Symbolic minimal still-life: ONE object, neutral backdrop, soft window light. 1–2 sentences. No people.
  E. PLACE / PRODUCT / OBJECT — review of a tool, a destination, a product launch.
     → Editorial product or environmental shot. Medium length.

STEP 2 — Write the prompt for the chosen mode following the rules below.

UNIVERSAL RULES (apply to every mode):
1. Read the content carefully. Identify the exact topic, emotion, and target audience.
2. NO text, words, logos, overlays, signage, or watermarks in the scene.
3. NO "diverse group smiling at camera", "businessman", "handshake", "teamwork", "stock photo" — these always look fake.
4. When people appear: unposed natural moment, hands in simple relaxed positions (no specific finger gestures, no close-up hands).
5. End the prompt with a generic style cue — pick from: "editorial photography", "documentary-style photography", "cinematic", "lifestyle photography", "fine-art portrait photography", "photojournalistic". NEVER a person's name.
6. Output ONLY the prompt. No explanation, no preamble, no mode label, no quotes around it.

MODE-SPECIFIC LENGTH:
- Mode A or B: up to 180 words, full camera (e.g. "85mm lens look, shallow depth of field") + lighting + style cue.
- Mode C: 60–120 words, minimal styling.
- Mode D: 30–80 words, single object, single light source.
- Mode E: 80–150 words.`;

async function buildImagePrompt(title: string, body: string, platform: string): Promise<string> {
  const response = await llmGenerate(
    IMAGE_PROMPT_SYSTEM,
    `Create an image prompt for this content:

TITLE: ${title}
PLATFORM: ${platform}

CONTENT:
${body.slice(0, 1200)}

---

Write a single, hyper-specific FLUX 2 Max image generation prompt that captures the emotional truth of this content in one editorial photograph.`,
    { maxTokens: 500 },
  );

  return response.trim();
}

// ---------------------------------------------------------------------------
// Video Prompt Builder (cinematic director)
// ---------------------------------------------------------------------------

const VIDEO_PROMPT_SYSTEM = `You are a world-class video director writing prompts for Kling v3, a cinematic AI video model that produces 10-second clips with realistic motion.

Your prompts produce cinematic clips that feel like they belong in a documentary, brand film, or high-end editorial — not generic stock footage.

RULES:
1. Read the content carefully. Identify the specific topic, emotion, and message.
2. Design ONE specific 10-second cinematic scene that emotionally captures the content.
3. Always specify: subject + precise action, camera movement (slow dolly push, handheld tracking shot, static wide, aerial descent, rack focus), setting, lighting quality and direction, mood/atmosphere.
4. Kling excels at: smooth camera movement, natural human motion, realistic environments, golden hour light.
5. Describe motion explicitly — what is moving and how (e.g. "camera slowly pushes toward subject", "leaves drift in foreground", "steam rises from mug").
6. Style: documentary, cinematic, lifestyle editorial — never corporate or staged.
7. NO text overlays, logos, graphics, or on-screen elements.
8. Output ONLY the prompt. No explanation, no preamble.
9. Max 120 words.`;

async function buildVideoPrompt(title: string, body: string, platform: string): Promise<string> {
  const response = await llmGenerate(
    VIDEO_PROMPT_SYSTEM,
    `Create a video prompt for:

TITLE: ${title}
PLATFORM: ${platform}

CONTENT:
${body.slice(0, 800)}

---

Write a single cinematic video prompt.`,
    { maxTokens: 300 },
  );

  return response.trim();
}

// ---------------------------------------------------------------------------
// Video Model Configuration
// ---------------------------------------------------------------------------

export type VideoModel = 'kling-v3' | 'wan-2.7' | 'sora-2' | 'longcat';

export const VIDEO_MODELS: Record<
  VideoModel,
  { label: string; maxDuration: number; cost: string; quality: string }
> = {
  'kling-v3': { label: 'Kling v3', maxDuration: 10, cost: '~$0.04/s', quality: 'Best quality/cost' },
  'wan-2.7': { label: 'Wan 2.7', maxDuration: 15, cost: '~$0.10/s', quality: 'Smooth motion' },
  'sora-2': { label: 'Sora 2', maxDuration: 25, cost: '~$0.10/s', quality: 'Premium quality' },
  longcat: { label: 'LongCat', maxDuration: 60, cost: '~$0.04/s', quality: 'Long-form content' },
};

function buildVideoModelInput(
  model: VideoModel,
  prompt: string,
  duration: number,
): { endpoint: string; input: Record<string, unknown> } {
  switch (model) {
    case 'wan-2.7':
      return {
        endpoint: 'fal-ai/wan/v2.7/text-to-video',
        input: { prompt, duration: Math.min(duration, 15), aspect_ratio: '16:9' },
      };
    case 'sora-2':
      return {
        endpoint: 'fal-ai/sora-2/text-to-video',
        input: { prompt, duration: Math.min(duration, 25), aspect_ratio: '16:9', resolution: '1080p' },
      };
    case 'longcat':
      return {
        endpoint: 'fal-ai/longcat-video/text-to-video/720p',
        input: { prompt, num_frames: Math.min(duration, 60) * 30 },
      };
    case 'kling-v3':
    default:
      return {
        endpoint: 'fal-ai/kling-video/v3/standard/text-to-video',
        input: {
          prompt,
          duration: String(Math.min(duration, 10)) as '5' | '10',
          aspect_ratio: '16:9',
          negative_prompt: 'blurry, low quality, watermark, text, logo, stock footage, generic, amateur',
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Carousel slide parser
// ---------------------------------------------------------------------------

export function parseSlides(body: string): string[] {
  const bySlide = body.split(/\n(?=##?\s*Slide\s+\d+|\*\*Slide\s+\d+\*\*)/i);
  if (bySlide.length > 1) return bySlide.map((s) => s.trim()).filter(Boolean);
  const byDivider = body.split(/\n---\n/);
  if (byDivider.length > 1) return byDivider.map((s) => s.trim()).filter(Boolean);
  return [body.trim()];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ImageGenerateParams {
  title: string;
  body: string;
  platform: string;
  aspectRatio?: string;
  format?: string; // e.g. 'instagram_carousel'
  /**
   * Pre-built editorial prompt — used by the "Regenerate Media" flow when
   * the operator has edited the prompt in the dashboard. Skips the LLM-
   * driven prompt builder. For carousel formats this prompt applies to
   * every slide (slide-text is not appended); operators wanting per-slide
   * control should disable carousel.
   */
  customPrompt?: string;
  /**
   * Carousel only. When true, the per-slide prompt is suffixed with an
   * instruction asking nano-banana-2 to render the slide's text into the
   * image. The actual instruction string is built by the orchestrator
   * (services/media/index.ts:buildTextOverlayInstruction) so fal and
   * OpenAI share the same overlay grammar.
   */
  textOverlay?: boolean;
}

export interface FalImageResult {
  urls: string[];
  /** The exact prompt sent to fal — one per url. Stored on social_media_asset.prompt. */
  prompts: string[];
}

export interface VideoGenerateParams {
  title: string;
  body: string;
  platform: string;
  model?: VideoModel;
  duration?: number;
}

/**
 * Generate one or more images using fal.ai nano-banana-2.
 * Uses the full editorial prompt engineering pipeline from content-machine.
 */
export async function generateImageFal(params: ImageGenerateParams): Promise<FalImageResult> {
  const fal = getClient();
  const aspectRatio =
    params.aspectRatio ?? resolveAspectRatio(params.platform, params.format);

  // Carousel: one image per slide, generated in parallel.
  if (isCarouselFormat(params.format)) {
    const slides = parseSlides(params.body).slice(0, 8);
    console.log(`[fal] Generating ${slides.length} carousel images for:`, params.title);

    // Lazily import the orchestrator helper to avoid a circular dep at
    // module load (services/media/index.ts already imports fal.service).
    const { buildTextOverlayInstruction } = params.textOverlay
      ? await import('./index.js')
      : { buildTextOverlayInstruction: undefined };

    const results = await Promise.all(
      slides.map(async (slideText, i) => {
        const rawPrompt = params.customPrompt
          ? params.customPrompt
          : await buildImagePrompt(
              `${params.title} — slide ${i + 1}`,
              slideText,
              params.platform,
            );
        const overlay = buildTextOverlayInstruction
          ? buildTextOverlayInstruction(slideText)
          : '';
        const prompt = `${rawPrompt}. ${IMAGE_QUALITY_SUFFIX}${overlay}`;

        const result = (await withTimeout(
          fal.subscribe('fal-ai/nano-banana-2', {
            input: {
              prompt,
              aspect_ratio: narrowAspectRatio(aspectRatio),
              resolution: '2K',
              output_format: 'jpeg',
              safety_tolerance: '2',
            },
          }),
          FAL_TIMEOUT_MS,
          `fal.ai carousel slide ${i + 1}`,
        )) as any;

        const imgs = (result?.data?.images ?? result?.images ?? [])
          .map((img: any) => img?.url ?? img)
          .filter(Boolean);
        return { url: imgs[0] as string | undefined, prompt };
      }),
    );

    const urls: string[] = [];
    const prompts: string[] = [];
    for (const r of results) if (r.url) { urls.push(r.url); prompts.push(r.prompt); }
    if (urls.length === 0) throw new Error('fal.ai returned no carousel images');
    return { urls, prompts };
  }

  // Single image
  console.log('[fal] Generating image prompt for:', params.title);
  const rawPrompt = params.customPrompt
    ? params.customPrompt
    : await buildImagePrompt(params.title, params.body, params.platform);
  const prompt = `${rawPrompt}. ${IMAGE_QUALITY_SUFFIX}`;
  console.log('[fal] Image prompt:\n', prompt);

  const result = (await withTimeout(
    fal.subscribe('fal-ai/nano-banana-2', {
      input: {
        prompt,
        aspect_ratio: narrowAspectRatio(aspectRatio),
        resolution: '2K',
        output_format: 'jpeg',
        safety_tolerance: '2',
      },
    }),
    FAL_TIMEOUT_MS,
    'fal.ai single image',
  )) as any;

  const images: string[] = (result?.data?.images ?? result?.images ?? [])
    .map((img: any) => img?.url ?? img)
    .filter(Boolean);

  if (images.length === 0) throw new Error('fal.ai returned no images');
  return { urls: images, prompts: images.map(() => prompt) };
}

/**
 * Generate a video using fal.ai.
 * Supports kling-v3 (default), wan-2.7, sora-2, and longcat.
 */
export async function generateVideoFal(params: VideoGenerateParams): Promise<string[]> {
  const fal = getClient();
  const videoModel: VideoModel = params.model ?? 'kling-v3';
  const videoDuration = params.duration ?? 10;

  console.log('[fal] Generating video prompt for:', params.title);
  const prompt = await buildVideoPrompt(params.title, params.body, params.platform);
  console.log('[fal] Video prompt:\n', prompt);

  const { endpoint, input } = buildVideoModelInput(videoModel, prompt, videoDuration);

  const result = (await withTimeout(
    fal.subscribe(endpoint, { input }),
    FAL_TIMEOUT_MS * 4, // video takes longer than image
    `fal.ai video (${endpoint})`,
  )) as any;

  const video =
    result?.data?.video?.url ??
    result?.video?.url ??
    result?.data?.video_url ??
    result?.video_url;

  if (!video) throw new Error('fal.ai returned no video');
  return [video];
}

// Re-export prompt builders for UI preview/tweaking
export { buildImagePrompt, buildVideoPrompt };
