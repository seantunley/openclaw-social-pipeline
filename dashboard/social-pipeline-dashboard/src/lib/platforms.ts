/**
 * Per-platform spec for the dashboard. Mirrors
 * `engine/src/services/platform/specs.ts`.
 *
 * Kept as a static TS file rather than an API call because:
 *   1. The data is static and identical for every user
 *   2. Composer needs char limits during keystrokes — no roundtrip
 *   3. Type-checked at compile time alongside React components
 *
 * **Drift rule:** if you change a value here, update the engine spec, and
 * vice versa. The truncation safety net + prompt injection happen on the
 * engine side, so the engine values are authoritative for what actually
 * ships.
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
  accept: string;
  hint: string;
  files: string;
  parser: PlatformId;
}

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  icon: string;
  color: string;
  content: {
    charLimit: number;
    premiumLimit?: number;
    hashtags: { min: number; max: number };
    linkBehaviour: 'preview' | 'inline' | 'stripped' | 'first-comment';
    disclosures: Array<'ai_generated' | 'paid_partnership'>;
    replyAudience?: Array<'everyone' | 'following' | 'mentioned' | 'verified'>;
  };
  media: {
    imageAspectRatio: string;
    imageDimensions: { width: number; height: number };
    altFormats?: Array<{
      id: string;
      label: string;
      aspectRatio: string;
      dimensions: { width: number; height: number };
    }>;
    videoMaxDurationSec: number;
    supportsCarousel: boolean;
  };
  import: PlatformImportSpec;
}

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

export const PLATFORMS_ORDERED: PlatformSpec[] = [
  PLATFORM_SPECS.twitter,
  PLATFORM_SPECS.instagram,
  PLATFORM_SPECS.facebook,
  PLATFORM_SPECS.linkedin,
  PLATFORM_SPECS.tiktok,
  PLATFORM_SPECS.youtube,
  PLATFORM_SPECS.threads,
  PLATFORM_SPECS.bluesky,
  PLATFORM_SPECS.pinterest,
  PLATFORM_SPECS.reddit,
  PLATFORM_SPECS.vk,
];

export function getPlatformSpec(id: string): PlatformSpec {
  return PLATFORM_SPECS[id as PlatformId] ?? PLATFORM_SPECS.linkedin;
}
