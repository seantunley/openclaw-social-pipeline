/**
 * Canonical per-platform spec.
 *
 * Single source of truth for everything the engine and dashboard need to
 * know about a target platform: character limits, image/video dimensions,
 * hashtag conventions, link behaviour, disclosure requirements, and
 * historical-data import format.
 *
 * The pipeline injects the spec into every generation prompt and uses it
 * to pick correct media dimensions. The dashboard mirrors a subset of
 * these fields for the Post Composer (character counters, live preview)
 * and Settings → Import (accept patterns, hint text).
 *
 * **Update rule:** if a platform changes a limit, update it here. Do not
 * pin limits in pipeline.ts, fal.service.ts, or dashboard pages — every
 * call site should resolve through `getPlatformSpec(id)`.
 */

export type PlatformId =
  | 'twitter'
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'tiktok'
  | 'youtube'
  | 'threads'
  | 'bluesky'
  | 'pinterest'
  | 'reddit'
  | 'vk';

export interface PlatformImportSpec {
  /** Comma-separated <input accept=…> pattern for the file picker. */
  accept: string;
  /** One-liner telling the user where to find the export in their settings. */
  hint: string;
  /** Sample filename(s) the parser expects. */
  files: string;
  /** Parser key — matches a registered parser in import/parsers/. */
  parser: PlatformId;
}

export interface PlatformMediaSpec {
  /** Default aspect ratio for a single image post. */
  imageAspectRatio: string;
  /** Recommended pixel dimensions for the default ratio (used as a hint). */
  imageDimensions: { width: number; height: number };
  /** Alternative formats this platform accepts (story, reel, carousel, etc.). */
  altFormats?: Array<{
    id: string;
    label: string;
    aspectRatio: string;
    dimensions: { width: number; height: number };
  }>;
  /** Hard cap on video length, seconds. 0 = no native video. */
  videoMaxDurationSec: number;
  /** Whether the platform supports carousels / multi-image posts. */
  supportsCarousel: boolean;
}

export interface PlatformContentSpec {
  /** Hard cap, characters, on the standard tier. Overruns get truncated. */
  charLimit: number;
  /** Higher cap available with paid/verified tier (X premium, etc.). */
  premiumLimit?: number;
  /** Suggested hashtag range. Pipeline uses these as soft targets. */
  hashtags: { min: number; max: number };
  /** What happens to URLs in the post body. */
  linkBehaviour: 'preview' | 'inline' | 'stripped' | 'first-comment';
  /** Disclosure flags this platform expects when applicable. */
  disclosures: Array<'ai_generated' | 'paid_partnership'>;
  /** Reply-audience or visibility controls (currently X-only). */
  replyAudience?: Array<'everyone' | 'following' | 'mentioned' | 'verified'>;
}

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  /** Short single-character or emoji used in compact UI badges. */
  icon: string;
  /** Brand colour for accent strokes / dot indicators. */
  color: string;
  content: PlatformContentSpec;
  media: PlatformMediaSpec;
  import: PlatformImportSpec;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export const PLATFORM_SPECS: Record<PlatformId, PlatformSpec> = {
  twitter: {
    id: 'twitter',
    label: 'X / Twitter',
    icon: '✕',
    color: '#1DA1F2',
    content: {
      charLimit: 280,
      premiumLimit: 4000,
      hashtags: { min: 0, max: 2 },
      linkBehaviour: 'preview',
      disclosures: ['ai_generated', 'paid_partnership'],
      replyAudience: ['everyone', 'following', 'mentioned', 'verified'],
    },
    media: {
      imageAspectRatio: '16:9',
      imageDimensions: { width: 1600, height: 900 },
      videoMaxDurationSec: 140,
      supportsCarousel: true,
    },
    import: {
      accept: '.js,.json,.zip',
      hint: 'Settings → Your Account → Download an Archive',
      files: 'tweets.js or ZIP',
      parser: 'twitter',
    },
  },

  instagram: {
    id: 'instagram',
    label: 'Instagram',
    icon: '📷',
    color: '#E1306C',
    content: {
      charLimit: 2200,
      hashtags: { min: 5, max: 30 },
      linkBehaviour: 'first-comment',
      disclosures: ['paid_partnership'],
    },
    media: {
      imageAspectRatio: '4:5',
      imageDimensions: { width: 1080, height: 1350 },
      altFormats: [
        { id: 'square', label: 'Square', aspectRatio: '1:1', dimensions: { width: 1080, height: 1080 } },
        { id: 'reel', label: 'Reel / Story', aspectRatio: '9:16', dimensions: { width: 1080, height: 1920 } },
        { id: 'carousel', label: 'Carousel', aspectRatio: '4:5', dimensions: { width: 1080, height: 1350 } },
      ],
      videoMaxDurationSec: 90,
      supportsCarousel: true,
    },
    import: {
      accept: '.json,.zip',
      hint: 'Settings → Your Activity → Download Your Information → JSON',
      files: 'posts_1.json or ZIP',
      parser: 'instagram',
    },
  },

  facebook: {
    id: 'facebook',
    label: 'Facebook',
    icon: '📘',
    color: '#1877F2',
    content: {
      charLimit: 63206,
      hashtags: { min: 0, max: 3 },
      linkBehaviour: 'preview',
      disclosures: ['paid_partnership'],
    },
    media: {
      imageAspectRatio: '1:1',
      imageDimensions: { width: 1200, height: 1200 },
      altFormats: [
        { id: 'landscape', label: 'Landscape link card', aspectRatio: '16:9', dimensions: { width: 1200, height: 630 } },
        { id: 'story', label: 'Story', aspectRatio: '9:16', dimensions: { width: 1080, height: 1920 } },
      ],
      videoMaxDurationSec: 240,
      supportsCarousel: true,
    },
    import: {
      accept: '.json,.zip',
      hint: 'Settings → Your Information → Download Your Information → JSON',
      files: 'your_posts_1.json or ZIP',
      parser: 'facebook',
    },
  },

  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    icon: '💼',
    color: '#0A66C2',
    content: {
      charLimit: 3000,
      hashtags: { min: 3, max: 5 },
      linkBehaviour: 'preview',
      disclosures: ['paid_partnership'],
    },
    media: {
      imageAspectRatio: '1:1',
      imageDimensions: { width: 1200, height: 1200 },
      altFormats: [
        { id: 'landscape', label: 'Landscape link card', aspectRatio: '1.91:1', dimensions: { width: 1200, height: 627 } },
      ],
      videoMaxDurationSec: 600,
      supportsCarousel: true,
    },
    import: {
      accept: '.csv,.zip',
      hint: 'Settings → Data Privacy → Get a Copy of Your Data',
      files: 'Shares.csv',
      parser: 'linkedin',
    },
  },

  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    icon: '♪',
    color: '#000000',
    content: {
      charLimit: 2200,
      hashtags: { min: 3, max: 8 },
      linkBehaviour: 'stripped',
      disclosures: ['ai_generated', 'paid_partnership'],
    },
    media: {
      imageAspectRatio: '9:16',
      imageDimensions: { width: 1080, height: 1920 },
      videoMaxDurationSec: 600,
      supportsCarousel: true,
    },
    import: {
      accept: '.json,.zip',
      hint: 'Settings → Account → Download Your Data → JSON',
      files: 'VideoList.json or ZIP',
      parser: 'tiktok',
    },
  },

  youtube: {
    id: 'youtube',
    label: 'YouTube',
    icon: '▶',
    color: '#FF0000',
    content: {
      // YouTube description limit. Title is a separate, much shorter field.
      charLimit: 5000,
      hashtags: { min: 3, max: 15 },
      linkBehaviour: 'inline',
      disclosures: ['paid_partnership'],
    },
    media: {
      imageAspectRatio: '16:9',
      imageDimensions: { width: 1280, height: 720 },
      altFormats: [
        { id: 'short', label: 'Short', aspectRatio: '9:16', dimensions: { width: 1080, height: 1920 } },
      ],
      videoMaxDurationSec: 43200,
      supportsCarousel: false,
    },
    import: {
      accept: '.json,.zip',
      hint: 'Google Takeout → YouTube → JSON format',
      files: 'video-metadata.json or ZIP',
      parser: 'youtube',
    },
  },

  threads: {
    id: 'threads',
    label: 'Threads',
    icon: '@',
    color: '#000000',
    content: {
      charLimit: 500,
      hashtags: { min: 0, max: 5 },
      linkBehaviour: 'preview',
      disclosures: ['paid_partnership'],
    },
    media: {
      imageAspectRatio: '1:1',
      imageDimensions: { width: 1080, height: 1080 },
      videoMaxDurationSec: 300,
      supportsCarousel: true,
    },
    import: {
      accept: '.json,.zip',
      hint: 'Threads is part of Instagram export — use Instagram option',
      files: 'threads_posts.json',
      parser: 'instagram',
    },
  },

  bluesky: {
    id: 'bluesky',
    label: 'Bluesky',
    icon: '🦋',
    color: '#0085FF',
    content: {
      charLimit: 300,
      hashtags: { min: 0, max: 3 },
      linkBehaviour: 'preview',
      disclosures: [],
    },
    media: {
      imageAspectRatio: '16:9',
      imageDimensions: { width: 1600, height: 900 },
      videoMaxDurationSec: 60,
      supportsCarousel: false,
    },
    import: {
      accept: '.json,.zip',
      hint: 'Bluesky data export not yet supported',
      files: 'n/a',
      parser: 'bluesky',
    },
  },

  pinterest: {
    id: 'pinterest',
    label: 'Pinterest',
    icon: '📌',
    color: '#E60023',
    content: {
      charLimit: 500,
      hashtags: { min: 0, max: 5 },
      linkBehaviour: 'inline',
      disclosures: ['paid_partnership'],
    },
    media: {
      imageAspectRatio: '2:3',
      imageDimensions: { width: 1000, height: 1500 },
      videoMaxDurationSec: 60,
      supportsCarousel: false,
    },
    import: {
      accept: '.json,.zip',
      hint: 'Pinterest data export not yet supported',
      files: 'n/a',
      parser: 'pinterest',
    },
  },

  reddit: {
    id: 'reddit',
    label: 'Reddit',
    icon: '🔥',
    color: '#FF4500',
    content: {
      charLimit: 40000,
      hashtags: { min: 0, max: 0 },
      linkBehaviour: 'inline',
      disclosures: [],
    },
    media: {
      imageAspectRatio: '16:9',
      imageDimensions: { width: 1200, height: 675 },
      videoMaxDurationSec: 900,
      supportsCarousel: true,
    },
    import: {
      accept: '.csv,.zip',
      hint: 'reddit.com/settings/data-request',
      files: 'posts.csv',
      parser: 'reddit',
    },
  },

  vk: {
    id: 'vk',
    label: 'VK',
    icon: 'V',
    color: '#0077FF',
    content: {
      charLimit: 16384,
      hashtags: { min: 0, max: 5 },
      linkBehaviour: 'preview',
      disclosures: [],
    },
    media: {
      imageAspectRatio: '16:9',
      imageDimensions: { width: 1280, height: 720 },
      videoMaxDurationSec: 300,
      supportsCarousel: true,
    },
    import: {
      accept: '.json,.zip',
      hint: 'VK data export not yet supported',
      files: 'n/a',
      parser: 'vk',
    },
  },
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a platform string (incl. legacy aliases like 'x') to a spec.
 * Returns the LinkedIn spec as a safe default if the input is unknown —
 * LinkedIn is the platform our pipeline was built around and has the most
 * forgiving limits.
 */
export function getPlatformSpec(platform: string): PlatformSpec {
  const id = normalisePlatformId(platform);
  return PLATFORM_SPECS[id];
}

export function isKnownPlatform(platform: string): platform is PlatformId {
  return platform in PLATFORM_SPECS;
}

/** Map common aliases ("x", "ig", "fb") to canonical IDs. */
export function normalisePlatformId(platform: string): PlatformId {
  const k = platform.trim().toLowerCase();
  const aliases: Record<string, PlatformId> = {
    x: 'twitter',
    'x/twitter': 'twitter',
    'x / twitter': 'twitter',
    ig: 'instagram',
    insta: 'instagram',
    fb: 'facebook',
    li: 'linkedin',
    yt: 'youtube',
    tt: 'tiktok',
  };
  if (aliases[k]) return aliases[k];
  if (k in PLATFORM_SPECS) return k as PlatformId;
  return 'linkedin';
}

/**
 * Resolve an alt-format id (e.g. 'carousel', 'reel', 'story', 'short',
 * 'landscape', 'square') against a platform spec. Returns null if the
 * format isn't declared on this platform — caller falls back to the
 * platform default.
 *
 * Format ids passed across the wire can be either bare ('carousel') or
 * platform-prefixed ('instagram_carousel'); both forms resolve.
 */
export function resolveFormat(
  spec: PlatformSpec,
  formatId: string | null | undefined,
): { aspectRatio: string; dimensions: { width: number; height: number }; id: string } | null {
  if (!formatId) return null;
  const bare = formatId.includes('_') ? formatId.split('_').slice(1).join('_') : formatId;
  const found = spec.media.altFormats?.find((f) => f.id === bare);
  if (!found) return null;
  return { aspectRatio: found.aspectRatio, dimensions: found.dimensions, id: found.id };
}

/**
 * Render a spec block suitable for injection into a generation prompt.
 * The model sees this verbatim and is expected to honour the limits.
 *
 * `format` overrides the default image aspect for this run and adds
 * format-specific instructions (carousel slide structure, reel hook,
 * etc.). Pass null/undefined to use the platform's defaults.
 */
export function formatSpecForPrompt(
  spec: PlatformSpec,
  formatId?: string | null,
): string {
  const resolvedFormat = resolveFormat(spec, formatId);
  const aspect = resolvedFormat?.aspectRatio ?? spec.media.imageAspectRatio;
  const dims = resolvedFormat?.dimensions ?? spec.media.imageDimensions;

  const parts: string[] = [
    `\n\n=== PLATFORM SPEC: ${spec.label}${resolvedFormat ? ` — ${resolvedFormat.id}` : ''} ===`,
    `Hard character limit: ${spec.content.charLimit}${
      spec.content.premiumLimit ? ` (or ${spec.content.premiumLimit} on premium tier)` : ''
    }. Do not exceed.`,
    `Hashtag count: aim for ${spec.content.hashtags.min}–${spec.content.hashtags.max}.`,
    `Links: ${describeLinks(spec.content.linkBehaviour)}.`,
  ];
  if (spec.content.disclosures.length > 0) {
    parts.push(
      `Required disclosures when applicable: ${spec.content.disclosures.join(', ')}.`,
    );
  }
  parts.push(
    `Image aspect ratio: ${aspect} (${dims.width}×${dims.height}px).`,
  );

  // Format-specific authoring instructions. Each block is a contract the
  // model needs to follow so the downstream slide-parser / video-script
  // logic can carve up the body correctly.
  const formatHint = describeFormat(resolvedFormat?.id);
  if (formatHint) parts.push(formatHint);

  if (!resolvedFormat && spec.media.altFormats?.length) {
    parts.push(
      `Other accepted formats: ${spec.media.altFormats
        .map((f) => `${f.label} ${f.aspectRatio}`)
        .join('; ')}.`,
    );
  }
  parts.push('=== END SPEC ===\n');
  return parts.join('\n');
}

function describeFormat(id: string | undefined): string | null {
  if (!id) return null;
  switch (id) {
    case 'carousel':
      return [
        'FORMAT: CAROUSEL.',
        'Structure the body as 5–8 slides separated by `## Slide 1`, `## Slide 2`, … headings.',
        'Each slide: 25–60 words. Slide 1 must hook (one sharp claim). Slide 2–6 deliver the substance one beat at a time. Final slide closes with the takeaway or CTA.',
        'Each slide must stand on its own visually — assume the reader stops swiping at any point.',
      ].join(' ');
    case 'reel':
    case 'story':
    case 'short':
      return [
        `FORMAT: ${id.toUpperCase()} (vertical, short-form).`,
        'Open with a 3-second hook on line one. Keep total length under 80 words.',
        'Write as if narrating to camera; favour second person ("you") and concrete verbs.',
      ].join(' ');
    case 'landscape':
      return 'FORMAT: LANDSCAPE link card. Write a single-paragraph caption that complements a horizontal hero image — the image carries the visual punch.';
    case 'square':
      return 'FORMAT: SQUARE single image. Treat the body as one self-contained micro-essay; the image is editorial, not illustrative.';
    default:
      return null;
  }
}

function describeLinks(b: PlatformContentSpec['linkBehaviour']): string {
  switch (b) {
    case 'preview':
      return 'OK to include — platform renders preview cards';
    case 'inline':
      return 'OK to include inline; no preview card';
    case 'stripped':
      return 'links are stripped from the body — put them in profile or pinned comment';
    case 'first-comment':
      return 'put any link in a follow-up first comment, never in the caption';
  }
}

/**
 * Hard truncate to a platform's char limit, preserving word boundaries
 * where possible. Used as a safety net AFTER generation — the prompt
 * already asks the model to stay under, so this should rarely fire.
 */
export function truncateToLimit(content: string, spec: PlatformSpec): {
  content: string;
  truncated: boolean;
} {
  const limit = spec.content.charLimit;
  if (content.length <= limit) return { content, truncated: false };
  const slice = content.slice(0, limit);
  // Walk back to the last whitespace so we don't chop mid-word.
  const lastSpace = slice.lastIndexOf(' ');
  const safeEnd = lastSpace > limit * 0.8 ? lastSpace : limit;
  return {
    content: slice.slice(0, safeEnd).trimEnd() + '…',
    truncated: true,
  };
}
