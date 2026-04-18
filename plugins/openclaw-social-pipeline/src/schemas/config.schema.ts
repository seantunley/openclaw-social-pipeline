import { z } from "zod";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const platformEnum = z.enum([
  "twitter",
  "linkedin",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
  "bluesky",
  "mastodon",
  "pinterest",
  "reddit",
]);

const mediaMode = z.enum(["image", "video", "carousel", "none"]);

const aspectRatio = z.enum([
  "1:1",
  "4:5",
  "9:16",
  "16:9",
  "3:4",
  "4:3",
]);

const generalConfigSchema = z.object({
  default_platforms: z
    .array(platformEnum)
    .min(1)
    .default(["twitter", "linkedin"]),
  max_variants: z.number().int().min(1).max(20).default(3),
  approval_required: z.boolean().default(true),
  default_language: z.string().default("en"),
});

const humanizerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  aggressiveness: z.number().int().min(1).max(10).default(5),
  preserve_brand_phrases: z.array(z.string()).default([]),
});

const marketingPsychologyConfigSchema = z.object({
  enabled: z.boolean().default(true),
  allowed_principles: z.array(z.string()).default([]),
  excluded_principles: z.array(z.string()).default([]),
  default_intensity: z.number().int().min(1).max(10).default(6),
});

const mediaConfigSchema = z.object({
  preferred_mode: z
    .record(platformEnum, mediaMode)
    .default({
      twitter: "image",
      linkedin: "image",
      instagram: "carousel",
      tiktok: "video",
      youtube: "video",
      facebook: "image",
      threads: "image",
      bluesky: "image",
      mastodon: "image",
      pinterest: "image",
      reddit: "image",
    }),
  image_aspect_ratio: z
    .record(platformEnum, aspectRatio)
    .default({
      twitter: "16:9",
      linkedin: "1:1",
      instagram: "1:1",
      facebook: "16:9",
      threads: "1:1",
      tiktok: "9:16",
      youtube: "16:9",
      bluesky: "16:9",
      mastodon: "16:9",
      pinterest: "4:5",
      reddit: "16:9",
    }),
  video_aspect_ratio: z
    .record(platformEnum, aspectRatio)
    .default({
      twitter: "16:9",
      linkedin: "16:9",
      instagram: "9:16",
      facebook: "16:9",
      threads: "9:16",
      tiktok: "9:16",
      youtube: "16:9",
      bluesky: "16:9",
      mastodon: "16:9",
      pinterest: "9:16",
      reddit: "16:9",
    }),
  video_duration_defaults: z
    .record(platformEnum, z.number().int().min(1).max(600))
    .default({
      twitter: 60,
      linkedin: 90,
      instagram: 30,
      facebook: 60,
      threads: 30,
      tiktok: 30,
      youtube: 120,
      bluesky: 60,
      mastodon: 60,
      pinterest: 30,
      reddit: 60,
    }),
  provider: z.enum(["fal", "openai", "replicate"]).default("fal"),
  model: z.string().default("fal-ai/nano-banana-2"),
});

const postingWindowSchema = z.object({
  day: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  start_hour: z.number().int().min(0).max(23),
  end_hour: z.number().int().min(0).max(23),
  timezone: z.string().default("UTC"),
});

const postizConfigSchema = z.object({
  use_cli_or_api: z.enum(["cli", "api"]).default("api"),
  default_integration_ids: z.record(platformEnum, z.string()).default({}),
  posting_windows: z.array(postingWindowSchema).default([
    { day: "mon", start_hour: 9, end_hour: 17, timezone: "UTC" },
    { day: "tue", start_hour: 9, end_hour: 17, timezone: "UTC" },
    { day: "wed", start_hour: 9, end_hour: 17, timezone: "UTC" },
    { day: "thu", start_hour: 9, end_hour: 17, timezone: "UTC" },
    { day: "fri", start_hour: 9, end_hour: 17, timezone: "UTC" },
  ]),
  analytics_sync_frequency: z
    .enum(["hourly", "every_6h", "every_12h", "daily"])
    .default("daily"),
});

const pipelineConfigSchema = z.object({
  stage_retry_limits: z
    .record(z.string(), z.number().int().min(0).max(10))
    .default({
      generate: 3,
      humanize: 2,
      psychology: 2,
      media: 3,
      approve: 0,
      publish: 3,
      analytics: 5,
    }),
  auto_analytics_sync: z.boolean().default(true),
  nightly_summary_job: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Root config schema
// ---------------------------------------------------------------------------

export const socialPipelineConfigSchema = z.object({
  general: generalConfigSchema.default({}),
  humanizer: humanizerConfigSchema.default({}),
  marketing_psychology: marketingPsychologyConfigSchema.default({}),
  media: mediaConfigSchema.default({}),
  postiz: postizConfigSchema.default({}),
  pipeline: pipelineConfigSchema.default({}),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type SocialPipelineConfig = z.infer<typeof socialPipelineConfigSchema>;
export type GeneralConfig = z.infer<typeof generalConfigSchema>;
export type HumanizerConfig = z.infer<typeof humanizerConfigSchema>;
export type MarketingPsychologyConfig = z.infer<typeof marketingPsychologyConfigSchema>;
export type MediaConfig = z.infer<typeof mediaConfigSchema>;
export type PostizConfig = z.infer<typeof postizConfigSchema>;
export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;
export type Platform = z.infer<typeof platformEnum>;
export type MediaMode = z.infer<typeof mediaMode>;
export type AspectRatio = z.infer<typeof aspectRatio>;
export type PostingWindow = z.infer<typeof postingWindowSchema>;

export {
  platformEnum,
  mediaMode,
  aspectRatio,
  generalConfigSchema,
  humanizerConfigSchema,
  marketingPsychologyConfigSchema,
  mediaConfigSchema,
  postizConfigSchema,
  pipelineConfigSchema,
};
