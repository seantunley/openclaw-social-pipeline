import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const timestamps = {
  created_at: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updated_at: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};

const createdAt = {
  created_at: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};

// ---------------------------------------------------------------------------
// social_campaign
// ---------------------------------------------------------------------------

export const socialCampaign = sqliteTable(
  "social_campaign",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", {
      enum: ["draft", "active", "paused", "completed", "archived"],
    })
      .notNull()
      .default("draft"),
    target_platforms: text("target_platforms").notNull().default("[]"),
    target_audience: text("target_audience").notNull().default(""),
    brand_voice_notes: text("brand_voice_notes").notNull().default(""),
    goals: text("goals").notNull().default("[]"),
    tags: text("tags").notNull().default("[]"),
    start_date: text("start_date"),
    end_date: text("end_date"),
    ...timestamps,
  },
  (table) => [
    index("idx_campaign_status").on(table.status),
    index("idx_campaign_created").on(table.created_at),
  ]
);

// ---------------------------------------------------------------------------
// social_run
// ---------------------------------------------------------------------------

export const socialRun = sqliteTable(
  "social_run",
  {
    id: text("id").primaryKey(),
    campaign_id: text("campaign_id")
      .notNull()
      .references(() => socialCampaign.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("pending"),
    trigger: text("trigger", {
      enum: ["manual", "scheduled", "workflow"],
    })
      .notNull()
      .default("manual"),
    config_snapshot: text("config_snapshot").notNull().default("{}"),
    started_at: text("started_at"),
    completed_at: text("completed_at"),
    error_message: text("error_message"),
    ...timestamps,
  },
  (table) => [
    index("idx_run_campaign").on(table.campaign_id),
    index("idx_run_status").on(table.status),
  ]
);

// ---------------------------------------------------------------------------
// social_run_stage
// ---------------------------------------------------------------------------

export const socialRunStage = sqliteTable(
  "social_run_stage",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => socialRun.id, { onDelete: "cascade" }),
    stage_name: text("stage_name", {
      enum: [
        "generate",
        "humanize",
        "psychology",
        "media",
        "approve",
        "publish",
        "analytics",
      ],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed", "skipped", "retrying"],
    })
      .notNull()
      .default("pending"),
    order_index: integer("order_index").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    max_retries: integer("max_retries").notNull().default(3),
    input_data: text("input_data").notNull().default("{}"),
    output_data: text("output_data").notNull().default("{}"),
    error_message: text("error_message"),
    started_at: text("started_at"),
    completed_at: text("completed_at"),
    duration_ms: integer("duration_ms"),
    ...createdAt,
  },
  (table) => [
    index("idx_stage_run").on(table.run_id),
    index("idx_stage_status").on(table.status),
    index("idx_stage_name").on(table.stage_name),
  ]
);

// ---------------------------------------------------------------------------
// social_draft
// ---------------------------------------------------------------------------

export const socialDraft = sqliteTable(
  "social_draft",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => socialRun.id, { onDelete: "cascade" }),
    campaign_id: text("campaign_id")
      .notNull()
      .references(() => socialCampaign.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    variant_index: integer("variant_index").notNull().default(0),
    status: text("status", {
      enum: [
        "generating",
        "humanizing",
        "enhancing",
        "media_pending",
        "ready",
        "approved",
        "rejected",
        "published",
        "failed",
      ],
    })
      .notNull()
      .default("generating"),
    raw_content: text("raw_content").notNull().default(""),
    humanized_content: text("humanized_content").notNull().default(""),
    final_content: text("final_content").notNull().default(""),
    psychology_principles_applied: text("psychology_principles_applied")
      .notNull()
      .default("[]"),
    humanizer_changes: text("humanizer_changes").notNull().default("[]"),
    seo_score: real("seo_score"),
    brand_score: real("brand_score"),
    character_count: integer("character_count").notNull().default(0),
    hashtags: text("hashtags").notNull().default("[]"),
    metadata: text("metadata").notNull().default("{}"),
    ...timestamps,
  },
  (table) => [
    index("idx_draft_run").on(table.run_id),
    index("idx_draft_campaign").on(table.campaign_id),
    index("idx_draft_platform").on(table.platform),
    index("idx_draft_status").on(table.status),
  ]
);

// ---------------------------------------------------------------------------
// social_media_asset
// ---------------------------------------------------------------------------

export const socialMediaAsset = sqliteTable(
  "social_media_asset",
  {
    id: text("id").primaryKey(),
    draft_id: text("draft_id")
      .notNull()
      .references(() => socialDraft.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["image", "video", "carousel_frame"],
    }).notNull(),
    status: text("status", {
      enum: ["generating", "uploading", "hosted", "failed"],
    })
      .notNull()
      .default("generating"),
    prompt: text("prompt").notNull().default(""),
    provider: text("provider").notNull().default(""),
    model: text("model").notNull().default(""),
    source_url: text("source_url"),
    hosted_url: text("hosted_url"),
    media_mode: text("media_mode", {
      enum: ["image", "video", "carousel", "none"],
    })
      .notNull()
      .default("image"),
    aspect_ratio: text("aspect_ratio").notNull().default("1:1"),
    width: integer("width"),
    height: integer("height"),
    duration_seconds: real("duration_seconds"),
    file_size_bytes: integer("file_size_bytes"),
    mime_type: text("mime_type"),
    carousel_index: integer("carousel_index"),
    metadata: text("metadata").notNull().default("{}"),
    ...createdAt,
  },
  (table) => [
    index("idx_asset_draft").on(table.draft_id),
    index("idx_asset_type").on(table.type),
    index("idx_asset_status").on(table.status),
  ]
);

// ---------------------------------------------------------------------------
// social_approval
// ---------------------------------------------------------------------------

export const socialApproval = sqliteTable(
  "social_approval",
  {
    id: text("id").primaryKey(),
    draft_id: text("draft_id")
      .notNull()
      .references(() => socialDraft.id, { onDelete: "cascade" }),
    run_id: text("run_id")
      .notNull()
      .references(() => socialRun.id, { onDelete: "cascade" }),
    reviewer: text("reviewer").notNull().default(""),
    decision: text("decision", {
      enum: ["approved", "rejected", "revision_requested"],
    }).notNull(),
    comments: text("comments").notNull().default(""),
    revision_notes: text("revision_notes").notNull().default(""),
    reviewed_at: text("reviewed_at").notNull(),
    ...createdAt,
  },
  (table) => [
    index("idx_approval_draft").on(table.draft_id),
    index("idx_approval_run").on(table.run_id),
    index("idx_approval_decision").on(table.decision),
  ]
);

// ---------------------------------------------------------------------------
// social_publish_record
// ---------------------------------------------------------------------------

export const socialPublishRecord = sqliteTable(
  "social_publish_record",
  {
    id: text("id").primaryKey(),
    draft_id: text("draft_id")
      .notNull()
      .references(() => socialDraft.id, { onDelete: "cascade" }),
    run_id: text("run_id")
      .notNull()
      .references(() => socialRun.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    status: text("status", {
      enum: ["scheduled", "publishing", "published", "failed"],
    })
      .notNull()
      .default("scheduled"),
    postiz_post_id: text("postiz_post_id"),
    postiz_integration_id: text("postiz_integration_id"),
    scheduled_at: text("scheduled_at"),
    published_at: text("published_at"),
    platform_post_id: text("platform_post_id"),
    platform_post_url: text("platform_post_url"),
    error_message: text("error_message"),
    metadata: text("metadata").notNull().default("{}"),
    ...timestamps,
  },
  (table) => [
    index("idx_publish_draft").on(table.draft_id),
    index("idx_publish_run").on(table.run_id),
    index("idx_publish_platform").on(table.platform),
    index("idx_publish_status").on(table.status),
  ]
);

// ---------------------------------------------------------------------------
// social_analytics_snapshot
// ---------------------------------------------------------------------------

export const socialAnalyticsSnapshot = sqliteTable(
  "social_analytics_snapshot",
  {
    id: text("id").primaryKey(),
    publish_record_id: text("publish_record_id")
      .notNull()
      .references(() => socialPublishRecord.id, { onDelete: "cascade" }),
    draft_id: text("draft_id")
      .notNull()
      .references(() => socialDraft.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    snapshot_at: text("snapshot_at").notNull(),
    impressions: integer("impressions").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    engagements: integer("engagements").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    video_views: integer("video_views").notNull().default(0),
    video_watch_time_seconds: real("video_watch_time_seconds")
      .notNull()
      .default(0),
    followers_gained: integer("followers_gained").notNull().default(0),
    engagement_rate: real("engagement_rate").notNull().default(0),
    raw_data: text("raw_data").notNull().default("{}"),
    ...createdAt,
  },
  (table) => [
    index("idx_analytics_publish").on(table.publish_record_id),
    index("idx_analytics_draft").on(table.draft_id),
    index("idx_analytics_platform").on(table.platform),
    index("idx_analytics_snapshot_at").on(table.snapshot_at),
  ]
);

// ---------------------------------------------------------------------------
// social_research (pipeline research outputs, browsable + promotable)
// ---------------------------------------------------------------------------

export const socialResearch = sqliteTable(
  "social_research",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id").references(() => socialRun.id, { onDelete: "set null" }),
    campaign_id: text("campaign_id").references(() => socialCampaign.id, { onDelete: "set null" }),
    topic: text("topic").notNull(),
    title: text("title").notNull(),
    brief: text("brief").notNull().default(""),
    angle: text("angle").notNull().default(""),
    why_now: text("why_now").notNull().default(""),
    platforms: text("platforms").notNull().default("[]"), // JSON array
    sources: text("sources").notNull().default("[]"), // JSON array [{platform, signal, url}]
    source_summary: text("source_summary").notNull().default(""),
    tags: text("tags").notNull().default("[]"), // JSON array
    content_type: text("content_type", { enum: ["trend", "evergreen", "research"] }).notNull().default("research"),
    suggested_format: text("suggested_format").notNull().default(""),
    status: text("status", { enum: ["pending", "approved", "rejected", "promoted", "archived"] }).notNull().default("pending"),
    promoted_run_id: text("promoted_run_id"), // if promoted to a content run
    research_data: text("research_data").notNull().default("{}"), // full JSON blob of research output
    researched_at: text("researched_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    ...timestamps,
  },
  (table) => [
    index("idx_research_status").on(table.status),
    index("idx_research_campaign").on(table.campaign_id),
    index("idx_research_topic").on(table.topic),
  ]
);

// ---------------------------------------------------------------------------
// social_config (key-value store for plugin settings)
// ---------------------------------------------------------------------------

export const socialConfig = sqliteTable("social_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updated_at: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});
