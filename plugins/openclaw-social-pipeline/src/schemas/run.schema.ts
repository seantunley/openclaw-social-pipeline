import { z } from "zod";
import { platformEnum, mediaMode, aspectRatio } from "./config.schema.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

const campaignStatus = z.enum(["draft", "active", "paused", "completed", "archived"]);
const runStatus = z.enum(["pending", "running", "completed", "failed", "cancelled"]);
const stageStatus = z.enum(["pending", "running", "completed", "failed", "skipped", "retrying"]);
const draftStatus = z.enum(["generating", "humanizing", "enhancing", "media_pending", "ready", "approved", "rejected", "published", "failed"]);
const assetType = z.enum(["image", "video", "carousel_frame"]);
const assetStatus = z.enum(["generating", "uploading", "hosted", "failed"]);
const approvalDecision = z.enum(["approved", "rejected", "revision_requested"]);
const publishStatus = z.enum(["scheduled", "publishing", "published", "failed"]);

const stageName = z.enum([
  "generate",
  "humanize",
  "psychology",
  "media",
  "approve",
  "publish",
  "analytics",
]);

// ---------------------------------------------------------------------------
// Social Campaign
// ---------------------------------------------------------------------------

export const socialCampaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().default(""),
  status: campaignStatus.default("draft"),
  target_platforms: z.array(platformEnum).min(1),
  target_audience: z.string().default(""),
  brand_voice_notes: z.string().default(""),
  goals: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Social Run
// ---------------------------------------------------------------------------

export const socialRunSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  status: runStatus.default("pending"),
  trigger: z.enum(["manual", "scheduled", "workflow"]).default("manual"),
  config_snapshot: z.record(z.string(), z.unknown()).default({}),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  error_message: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Social Run Stage
// ---------------------------------------------------------------------------

export const socialRunStageSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  stage_name: stageName,
  status: stageStatus.default("pending"),
  order_index: z.number().int().min(0),
  attempts: z.number().int().min(0).default(0),
  max_retries: z.number().int().min(0).default(3),
  input_data: z.record(z.string(), z.unknown()).default({}),
  output_data: z.record(z.string(), z.unknown()).default({}),
  error_message: z.string().optional(),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  duration_ms: z.number().int().optional(),
  created_at: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Social Draft
// ---------------------------------------------------------------------------

export const socialDraftSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  platform: platformEnum,
  variant_index: z.number().int().min(0).default(0),
  status: draftStatus.default("generating"),
  raw_content: z.string().default(""),
  humanized_content: z.string().default(""),
  final_content: z.string().default(""),
  psychology_principles_applied: z.array(z.string()).default([]),
  humanizer_changes: z.array(z.string()).default([]),
  seo_score: z.number().min(0).max(100).optional(),
  brand_score: z.number().min(0).max(100).optional(),
  character_count: z.number().int().min(0).default(0),
  hashtags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Social Media Asset
// ---------------------------------------------------------------------------

export const socialMediaAssetSchema = z.object({
  id: z.string().uuid(),
  draft_id: z.string().uuid(),
  type: assetType,
  status: assetStatus.default("generating"),
  prompt: z.string().default(""),
  provider: z.string().default(""),
  model: z.string().default(""),
  source_url: z.string().url().optional(),
  hosted_url: z.string().url().optional(),
  media_mode: mediaMode.default("image"),
  aspect_ratio: aspectRatio.default("1:1"),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  duration_seconds: z.number().optional(),
  file_size_bytes: z.number().int().optional(),
  mime_type: z.string().optional(),
  carousel_index: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Social Approval
// ---------------------------------------------------------------------------

export const socialApprovalSchema = z.object({
  id: z.string().uuid(),
  draft_id: z.string().uuid(),
  run_id: z.string().uuid(),
  reviewer: z.string().default(""),
  decision: approvalDecision,
  comments: z.string().default(""),
  revision_notes: z.string().default(""),
  reviewed_at: z.string().datetime(),
  created_at: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Social Publish Record
// ---------------------------------------------------------------------------

export const socialPublishRecordSchema = z.object({
  id: z.string().uuid(),
  draft_id: z.string().uuid(),
  run_id: z.string().uuid(),
  platform: platformEnum,
  status: publishStatus.default("scheduled"),
  postiz_post_id: z.string().optional(),
  postiz_integration_id: z.string().optional(),
  scheduled_at: z.string().datetime().optional(),
  published_at: z.string().datetime().optional(),
  platform_post_id: z.string().optional(),
  platform_post_url: z.string().url().optional(),
  error_message: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Social Analytics Snapshot
// ---------------------------------------------------------------------------

export const socialAnalyticsSnapshotSchema = z.object({
  id: z.string().uuid(),
  publish_record_id: z.string().uuid(),
  draft_id: z.string().uuid(),
  platform: platformEnum,
  snapshot_at: z.string().datetime(),
  impressions: z.number().int().min(0).default(0),
  reach: z.number().int().min(0).default(0),
  engagements: z.number().int().min(0).default(0),
  likes: z.number().int().min(0).default(0),
  comments: z.number().int().min(0).default(0),
  shares: z.number().int().min(0).default(0),
  saves: z.number().int().min(0).default(0),
  clicks: z.number().int().min(0).default(0),
  video_views: z.number().int().min(0).default(0),
  video_watch_time_seconds: z.number().min(0).default(0),
  followers_gained: z.number().int().min(0).default(0),
  engagement_rate: z.number().min(0).max(100).default(0),
  raw_data: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type SocialCampaign = z.infer<typeof socialCampaignSchema>;
export type SocialRun = z.infer<typeof socialRunSchema>;
export type SocialRunStage = z.infer<typeof socialRunStageSchema>;
export type SocialDraft = z.infer<typeof socialDraftSchema>;
export type SocialMediaAsset = z.infer<typeof socialMediaAssetSchema>;
export type SocialApproval = z.infer<typeof socialApprovalSchema>;
export type SocialPublishRecord = z.infer<typeof socialPublishRecordSchema>;
export type SocialAnalyticsSnapshot = z.infer<typeof socialAnalyticsSnapshotSchema>;

export {
  campaignStatus,
  runStatus,
  stageStatus,
  draftStatus,
  assetType,
  assetStatus,
  approvalDecision,
  publishStatus,
  stageName,
};
