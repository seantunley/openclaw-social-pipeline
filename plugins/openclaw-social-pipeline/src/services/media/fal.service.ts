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

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function getClient(): ReturnType<typeof createFalClient> {
  const credentials = process.env.FAL_API_KEY ?? '';
  if (!credentials) throw new Error('No fal.ai API key configured. Set FAL_API_KEY in .env');
  return createFalClient({ credentials });
}

// ---------------------------------------------------------------------------
// Platform → Aspect Ratio mapping
// ---------------------------------------------------------------------------

const PLATFORM_ASPECT_RATIOS: Record<string, string> = {
  instagram: '4:5',
  instagram_reel: '9:16',
  instagram_carousel: '4:5',
  facebook: '1:1',
  linkedin: '1:1',
  twitter: '16:9',
  tiktok: '9:16',
  youtube: '16:9',
  youtube_short: '9:16',
  threads: '1:1',
  bluesky: '16:9',
  pinterest: '4:5',
  reddit: '16:9',
  vk: '16:9',
};

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

const IMAGE_PROMPT_SYSTEM = `You are a world-class photo director writing prompts for FLUX 2 Max, the highest quality AI photorealism model available.

Your prompts produce images indistinguishable from real editorial photography — shot by a professional for a major publication.

RULES:
1. Read the content carefully. Identify the exact topic, emotion, and target audience.
2. Design a scene a real photographer would shoot for this exact piece — think TIME Magazine, National Geographic, Vogue editorial.
3. Describe: exact subject, precise action or moment, specific setting, exact lighting, mood, atmosphere.
4. Always specify camera: body (Canon EOS R5, Sony A7R V, Leica Q3, Hasselblad X2D), lens (35mm f/1.4, 85mm f/1.2, 50mm f/1.4), shot type (tight portrait, medium environmental, wide establishing).
5. Always specify lighting conditions in detail: direction, quality, colour temperature (e.g. "soft north-facing window light, 5500K, diffused through sheer curtain").
6. When people appear: describe them in a natural, unposed moment. Keep extremities in simple, relaxed positions — resting hands, natural stance. Never describe complex hand gestures or finger positions.
7. BANNED: "diverse group", "smiling at camera", "businessman", "handshake", "teamwork", "stock photo", anything staged or corporate.
8. NO text, words, logos, overlays, or signage in the scene.
9. The image must feel like a decisive moment captured, not art directed.
10. End with: "Shot in the style of [specific photographer]" — use real names: Annie Leibovitz, Steve McCurry, Martin Schoeller, Platon, Tim Walker, Peter Lindbergh.
11. Output ONLY the prompt. No explanation, no preamble, no quotes around it.
12. Max 180 words.`;

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

function parseSlides(body: string): string[] {
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
export async function generateImageFal(params: ImageGenerateParams): Promise<string[]> {
  const fal = getClient();
  const aspectRatio =
    params.aspectRatio ?? PLATFORM_ASPECT_RATIOS[params.platform] ?? '16:9';

  // Carousel: one image per slide, generated in parallel
  if (params.format === 'instagram_carousel') {
    const slides = parseSlides(params.body).slice(0, 8);
    console.log(`[fal] Generating ${slides.length} carousel images for:`, params.title);

    const images = await Promise.all(
      slides.map(async (slideText, i) => {
        const rawPrompt = await buildImagePrompt(
          `${params.title} — slide ${i + 1}`,
          slideText,
          params.platform,
        );
        const prompt = `${rawPrompt}. ${IMAGE_QUALITY_SUFFIX}`;

        const result = (await fal.subscribe('fal-ai/nano-banana-2', {
          input: {
            prompt,
            aspect_ratio: '4:5',
            resolution: '2K',
            output_format: 'jpeg',
            safety_tolerance: '2',
          },
        })) as any;

        const imgs = (result?.data?.images ?? result?.images ?? [])
          .map((img: any) => img?.url ?? img)
          .filter(Boolean);
        return imgs[0] as string | undefined;
      }),
    );

    const urls = images.filter((u): u is string => Boolean(u));
    if (urls.length === 0) throw new Error('fal.ai returned no carousel images');
    return urls;
  }

  // Single image
  console.log('[fal] Generating image prompt for:', params.title);
  const rawPrompt = await buildImagePrompt(params.title, params.body, params.platform);
  const prompt = `${rawPrompt}. ${IMAGE_QUALITY_SUFFIX}`;
  console.log('[fal] Image prompt:\n', prompt);

  const result = (await fal.subscribe('fal-ai/nano-banana-2', {
    input: {
      prompt,
      aspect_ratio: aspectRatio,
      resolution: '2K',
      output_format: 'jpeg',
      safety_tolerance: '2',
    },
  })) as any;

  const images: string[] = (result?.data?.images ?? result?.images ?? [])
    .map((img: any) => img?.url ?? img)
    .filter(Boolean);

  if (images.length === 0) throw new Error('fal.ai returned no images');
  return images;
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

  const result = (await fal.subscribe(endpoint, { input })) as any;

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
