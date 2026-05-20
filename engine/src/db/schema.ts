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
      enum: ["pending", "scheduled", "running", "approved", "completed", "failed", "cancelled"],
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
    /** Soft-delete timestamp. Non-null = the run is in the trash. */
    deleted_at: text("deleted_at"),
    /** When this run should fire. NULL = run immediately. Used by the
     *  scheduler worker to promote scheduled rows to running at the right time. */
    scheduled_at: text("scheduled_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_run_campaign").on(table.campaign_id),
    index("idx_run_status").on(table.status),
    index("idx_run_deleted").on(table.deleted_at),
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
      enum: ["generating", "uploading", "hosted", "failed", "superseded"],
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
// social_learning (content learnings from edits, rejections, analytics)
// ---------------------------------------------------------------------------

export const socialLearning = sqliteTable(
  "social_learning",
  {
    id: text("id").primaryKey(),
    category: text("category", {
      enum: [
        "tone", "structure", "hook", "cta", "vocabulary",
        "platform", "topic", "media", "timing", "audience",
        "avoidance", "psychology",
      ],
    }).notNull(),
    platform: text("platform"), // null = applies to all
    campaign_id: text("campaign_id").references(() => socialCampaign.id, { onDelete: "set null" }),
    content: text("content").notNull(), // the learning statement
    source_type: text("source_type", {
      enum: ["draft_edit", "rejection", "revision_request", "analytics", "operator_rule"],
    }).notNull(),
    source_run_id: text("source_run_id").references(() => socialRun.id, { onDelete: "set null" }),
    confidence: real("confidence").notNull().default(0.3),
    reinforcement_count: integer("reinforcement_count").notNull().default(1),
    last_reinforced_at: text("last_reinforced_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    tags: text("tags").notNull().default("[]"), // JSON array
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("idx_learning_category").on(table.category),
    index("idx_learning_platform").on(table.platform),
    index("idx_learning_confidence").on(table.confidence),
    index("idx_learning_active").on(table.active),
  ]
);

// ---------------------------------------------------------------------------
// social_brand_profile
// ---------------------------------------------------------------------------

export const socialBrandProfile = sqliteTable(
  "social_brand_profile",
  {
    id: text("id").primaryKey(),
    /** Null campaign_id = workspace-default profile (applies when a campaign-specific one is absent). */
    campaign_id: text("campaign_id").references(() => socialCampaign.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull().default(""),
    description: text("description").notNull().default(""),
    audience: text("audience").notNull().default(""),
    tone: text("tone").notNull().default(""),
    voice: text("voice").notNull().default(""),
    writing_guidelines: text("writing_guidelines").notNull().default(""),
    banned_words: text("banned_words").notNull().default("[]"),
    required_phrases: text("required_phrases").notNull().default("[]"),
    signature_phrases: text("signature_phrases").notNull().default("[]"),
    target_keywords: text("target_keywords").notNull().default("[]"),
    target_hashtags: text("target_hashtags").notNull().default("[]"),
    audience_pain_points: text("audience_pain_points").notNull().default("[]"),
    audience_aspirations: text("audience_aspirations").notNull().default("[]"),
    archetype: text("archetype").notNull().default(""),
    primary_color: text("primary_color").notNull().default(""),
    secondary_color: text("secondary_color").notNull().default(""),
    accent_color: text("accent_color").notNull().default(""),
    logo_url: text("logo_url").notNull().default(""),
    mission: text("mission").notNull().default(""),
    ...timestamps,
  },
  (table) => [index("idx_brand_campaign").on(table.campaign_id)],
);

// ---------------------------------------------------------------------------
// social_import_batch + social_imported_post
//
// Historical content imported from each platform's data export. The bot
// reads these rows when learning brand voice and when running rerun
// pipelines, so the AI can ground new content in real existing posts.
// ---------------------------------------------------------------------------

export const socialImportBatch = sqliteTable(
  "social_import_batch",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(),
    filename: text("filename").notNull().default(""),
    /** Bytes of the source upload — useful for "are we sure we want to delete this?" prompts. */
    file_size: integer("file_size").notNull().default(0),
    total_posts: integer("total_posts").notNull().default(0),
    notes: text("notes").notNull().default(""),
    ...createdAt,
  },
  (table) => [index("idx_import_batch_platform").on(table.platform)],
);

export const socialImportedPost = sqliteTable(
  "social_imported_post",
  {
    id: text("id").primaryKey(),
    batch_id: text("batch_id")
      .notNull()
      .references(() => socialImportBatch.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    /** Original platform post id (tweet id, ig pk, etc.) — for dedupe. */
    platform_post_id: text("platform_post_id").notNull().default(""),
    content: text("content").notNull().default(""),
    /** ISO 8601 timestamp from the original export. */
    posted_at: text("posted_at"),
    /** Engagement counts as JSON {likes,replies,shares,impressions,...} when available. */
    engagement: text("engagement").notNull().default("{}"),
    /** Original media URLs/attachments as JSON array of strings. */
    media: text("media").notNull().default("[]"),
    /** Raw row from the export, kept for forensic / re-parse purposes. */
    raw: text("raw").notNull().default("{}"),
    ...createdAt,
  },
  (table) => [
    index("idx_imported_post_batch").on(table.batch_id),
    index("idx_imported_post_platform").on(table.platform),
  ],
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

// ===========================================================================
// AGENT — runtime, memory, skills
// ===========================================================================
//
// The agent is a single-operator assistant with two surfaces (Telegram bot +
// dashboard chat). It shares one identity (`agent_profile` — singleton), one
// memory store (episodic + semantic + procedural + preferences), one skill
// registry, and one tools registry across both surfaces. The model used for
// reasoning is swappable; the agent's identity lives in this DB.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// agent_profile — singleton row keyed by id='default'. The operator names the
// agent, edits its persona prompt, picks a model. One row, one personality.
// ---------------------------------------------------------------------------

export const agentProfile = sqliteTable("agent_profile", {
  id: text("id").primaryKey().default("default"),
  name: text("name").notNull().default("Agent"),
  /** Free-form personality + role + constraints. Injected as system prompt. */
  system_prompt: text("system_prompt").notNull().default(""),
  /** pi-ai model ref, e.g. "anthropic/claude-opus-4-7", "openai/gpt-5". */
  default_model: text("default_model").notNull().default("anthropic/claude-opus-4-7"),
  default_temperature: real("default_temperature").notNull().default(0.7),
  /** Max iterations of the tool-call loop before forcing a final reply. */
  max_steps: integer("max_steps").notNull().default(10),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// agent_conversation — groups messages. One per Telegram chat or per
// dashboard session. Never deleted; archive via `archived_at` instead so the
// raw episodic trail is preserved for retrieval forever.
// ---------------------------------------------------------------------------

export const agentConversation = sqliteTable(
  "agent_conversation",
  {
    id: text("id").primaryKey(),
    /** Where the conversation happens. Same persona across surfaces. */
    surface: text("surface", { enum: ["telegram", "dashboard", "system"] }).notNull(),
    /** Telegram chatId (as string) or dashboard session uuid. */
    surface_ref: text("surface_ref").notNull(),
    /** Auto-generated from the first user message (~60 chars). */
    title: text("title").notNull().default(""),
    /** Soft archive — message rows stay searchable. */
    archived_at: text("archived_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_agent_conv_surface").on(table.surface, table.surface_ref),
    index("idx_agent_conv_updated").on(table.updated_at),
  ],
);

// ---------------------------------------------------------------------------
// agent_message — RAW EPISODIC. Every turn, every tool call, every result.
// Never deleted, never summarized away. The article's "keep raw episodic
// records" rule — summaries drift, source-of-truth doesn't.
//
// FTS5 mirror lives at `agent_message_fts` (created in db/index.ts as it's
// a virtual table). Vector mirror at `agent_message_vec` (sqlite-vec).
// ---------------------------------------------------------------------------

export const agentMessage = sqliteTable(
  "agent_message",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => agentConversation.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "tool", "system"] }).notNull(),
    /** Text content. For role=tool, the rendered tool result string. */
    content: text("content").notNull().default(""),
    /** When role=assistant: tool calls the model issued. JSON array. */
    tool_calls: text("tool_calls").notNull().default("[]"),
    /** When role=tool: which call this is responding to + raw result. */
    tool_call_id: text("tool_call_id"),
    tool_name: text("tool_name"),
    tool_result: text("tool_result").notNull().default("{}"),
    /** Set by extractor after async pass; lets the cron skip already-processed rows. */
    extracted_at: text("extracted_at"),
    /** Whether this message has an embedding row in agent_message_vec. */
    embedded_at: text("embedded_at"),
    ...createdAt,
  },
  (table) => [
    index("idx_agent_msg_conv").on(table.conversation_id, table.created_at),
    index("idx_agent_msg_role").on(table.role),
    index("idx_agent_msg_extracted").on(table.extracted_at),
    index("idx_agent_msg_embedded").on(table.embedded_at),
  ],
);

// ---------------------------------------------------------------------------
// agent_fact — SEMANTIC. LLM-extracted claims from messages. Curated, not
// raw — duplicates merge by reinforcement_count, contradictions deactivate
// the older row. Confidence drives whether it's injected at retrieval time.
//
// FTS5 mirror at `agent_fact_fts`. Vector mirror at `agent_fact_vec`.
// ---------------------------------------------------------------------------

export const agentFact = sqliteTable(
  "agent_fact",
  {
    id: text("id").primaryKey(),
    /** Coarse bucketing for retrieval filters; subject is finer-grained. */
    type: text("type", {
      enum: ["preference", "fact", "skill", "relationship", "goal", "constraint"],
    }).notNull(),
    /** Who/what the fact is about. 'user', 'agent', or a topic noun ("brand", "TikTok"). */
    subject: text("subject").notNull(),
    /** The claim itself, in natural language. Injected verbatim into prompts. */
    content: text("content").notNull(),
    /** The message this fact was first extracted from. Never null. */
    source_message_id: text("source_message_id")
      .notNull()
      .references(() => agentMessage.id, { onDelete: "cascade" }),
    /** Cheap model that did the extraction; useful for auditing drift. */
    extractor_model: text("extractor_model").notNull().default(""),
    /** 0..1. < 0.7 are excluded from default retrieval injection. */
    confidence: real("confidence").notNull().default(0.5),
    /** Bumped when the user re-states the same claim. Boosts retrieval rank. */
    reinforcement_count: integer("reinforcement_count").notNull().default(1),
    /** Updated on every reinforcement and every retrieval hit. */
    last_seen_at: text("last_seen_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    /** When was this last verified true (by re-validation cron or new user statement). */
    last_validated_at: text("last_validated_at"),
    /** false = contradicted/deactivated. Never deleted; provenance preserved. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    /** When deactivated: pointer to the message that contradicted it. */
    superseded_by_message_id: text("superseded_by_message_id"),
    /** Free-form tags for filtering ("work", "linkedin", "tone"). JSON array. */
    tags: text("tags").notNull().default("[]"),
    embedded_at: text("embedded_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_agent_fact_type").on(table.type),
    index("idx_agent_fact_subject").on(table.subject),
    index("idx_agent_fact_active").on(table.active),
    index("idx_agent_fact_confidence").on(table.confidence),
    index("idx_agent_fact_embedded").on(table.embedded_at),
  ],
);

// ---------------------------------------------------------------------------
// user_preference — NEVER-FORGET. Small store, loaded entirely every turn.
// Distinct from agent_fact because preferences are operationally always
// applicable, while facts are situationally retrieved.
// ---------------------------------------------------------------------------

export const userPreference = sqliteTable(
  "user_preference",
  {
    key: text("key").primaryKey(), // 'tone', 'work_hours', 'preferred_platform', ...
    value: text("value").notNull(),
    /** true = user stated it; false = agent inferred. Inferred prefs need re-validation faster. */
    set_explicitly: integer("set_explicitly", { mode: "boolean" }).notNull().default(true),
    /** The message that established this preference. */
    set_via_message_id: text("set_via_message_id").references(() => agentMessage.id, {
      onDelete: "set null",
    }),
    /** Marked false when contradicted. Still kept; not loaded into prompt. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [index("idx_user_pref_active").on(table.active)],
);

// ---------------------------------------------------------------------------
// conversation_summary — PROCEDURAL ROLLUPS. Derived from agent_message;
// can be regenerated by deleting + rebuilding. Used to give the agent
// efficient long-conversation context without loading every message.
// ---------------------------------------------------------------------------

export const conversationSummary = sqliteTable(
  "conversation_summary",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => agentConversation.id, { onDelete: "cascade" }),
    /** turn = single tool-call round; day/week = time bucket. */
    period: text("period", { enum: ["turn", "day", "week", "conversation"] }).notNull(),
    start_message_id: text("start_message_id"),
    end_message_id: text("end_message_id"),
    /** ISO date for day/week buckets. NULL for turn/conversation. */
    bucket_date: text("bucket_date"),
    summary_text: text("summary_text").notNull(),
    /** Cheap model that produced this summary. */
    summarizer_model: text("summarizer_model").notNull().default(""),
    ...createdAt,
  },
  (table) => [
    index("idx_conv_summary_conv").on(table.conversation_id, table.period),
    index("idx_conv_summary_bucket").on(table.bucket_date),
  ],
);

// ---------------------------------------------------------------------------
// agent_lesson — PROCEDURAL/REFLECTIVE. After a conversation ends, the agent
// (cheap model) self-reviews and extracts behavioral lessons: "next time I
// should X", "Y approach doesn't work for this operator". Injected into the
// system prompt on subsequent turns.
// ---------------------------------------------------------------------------

export const agentLesson = sqliteTable(
  "agent_lesson",
  {
    id: text("id").primaryKey(),
    /** Imperative behavioral rule: "When the operator asks for X, do Y first". */
    content: text("content").notNull(),
    /** Conversation that triggered this lesson. */
    source_conversation_id: text("source_conversation_id").references(
      () => agentConversation.id,
      { onDelete: "set null" },
    ),
    confidence: real("confidence").notNull().default(0.6),
    reinforcement_count: integer("reinforcement_count").notNull().default(1),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    tags: text("tags").notNull().default("[]"),
    ...timestamps,
  },
  (table) => [
    index("idx_agent_lesson_active").on(table.active),
    index("idx_agent_lesson_confidence").on(table.confidence),
  ],
);

// ---------------------------------------------------------------------------
// agent_skill — operator-approved capabilities. Each skill packages 1+ tools
// the agent can call. Integrity is recorded at install time (SHA-256 over
// the manifest); re-checked at load time. Status flow:
//
//   registered → approved → active     (operator approves, skill loads)
//                       ↘ revoked       (operator disables; never deleted)
//
// Skills are NOT auto-trusted. The agent runtime ONLY loads skills with
// status='active', and only after re-verifying the recorded checksum.
// ---------------------------------------------------------------------------

export const agentSkill = sqliteTable(
  "agent_skill",
  {
    id: text("id").primaryKey(),
    /** Stable identifier, e.g. "here-now", "web-search.brave", "postiz". */
    name: text("name").notNull().unique(),
    description: text("description").notNull().default(""),
    /** Semver from the skill's manifest. */
    version: text("version").notNull().default("0.0.0"),
    /** Where the skill was sourced. Provenance for the integrity check. */
    source_type: text("source_type", {
      enum: ["builtin", "github", "filesystem", "npm"],
    }).notNull(),
    source_url: text("source_url").notNull().default(""),
    /** SHA-256 over a stable representation of the skill manifest + tool descriptors. */
    checksum_sha256: text("checksum_sha256").notNull(),
    /** Raw manifest JSON (tools, schemas, descriptions) so we can re-verify and re-load. */
    manifest_json: text("manifest_json").notNull(),
    status: text("status", {
      enum: ["registered", "approved", "active", "revoked"],
    })
      .notNull()
      .default("registered"),
    approved_at: text("approved_at"),
    approved_by: text("approved_by"), // operator id; for now "operator" (single-user)
    revoked_at: text("revoked_at"),
    revoked_reason: text("revoked_reason"),
    /** Last time the runtime verified the manifest matched checksum_sha256. */
    last_verified_at: text("last_verified_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_agent_skill_status").on(table.status),
    index("idx_agent_skill_name").on(table.name),
  ],
);

// ---------------------------------------------------------------------------
// agent_skill_tool — one row per tool a skill exposes. Denormalized from the
// manifest so we can index/list tools without parsing every manifest.
// ---------------------------------------------------------------------------

export const agentSkillTool = sqliteTable(
  "agent_skill_tool",
  {
    id: text("id").primaryKey(),
    skill_id: text("skill_id")
      .notNull()
      .references(() => agentSkill.id, { onDelete: "cascade" }),
    /** Tool name as the LLM sees it, e.g. "webSearch", "publishToPostiz". */
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** JSON Schema of the tool's input. */
    input_schema_json: text("input_schema_json").notNull().default("{}"),
    /** When false: skill is active but this specific tool is operator-disabled. */
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...createdAt,
  },
  (table) => [
    index("idx_agent_skill_tool_skill").on(table.skill_id),
    index("idx_agent_skill_tool_name").on(table.name),
  ],
);

// ---------------------------------------------------------------------------
// agent_skill_audit — append-only audit log of approve/revoke/verify-fail
// events. Operator-facing record of every trust transition.
// ---------------------------------------------------------------------------

export const agentSkillAudit = sqliteTable(
  "agent_skill_audit",
  {
    id: text("id").primaryKey(),
    skill_id: text("skill_id")
      .notNull()
      .references(() => agentSkill.id, { onDelete: "cascade" }),
    event: text("event", {
      enum: [
        "registered",
        "approved",
        "activated",
        "revoked",
        "verify_ok",
        "verify_failed",
        "manifest_changed",
      ],
    }).notNull(),
    actor: text("actor").notNull().default("operator"),
    note: text("note").notNull().default(""),
    /** Hashes for verify_failed / manifest_changed events. */
    expected_checksum: text("expected_checksum"),
    actual_checksum: text("actual_checksum"),
    ...createdAt,
  },
  (table) => [
    index("idx_agent_skill_audit_skill").on(table.skill_id, table.created_at),
    index("idx_agent_skill_audit_event").on(table.event),
  ],
);

// ===========================================================================
// AGENT DEFENSE — prompt-injection layers + SOC telemetry
// ===========================================================================

// ---------------------------------------------------------------------------
// security_event — every defense decision. The SOC page reads from here.
// Append-only; never updated, never deleted. Each row = one inspection
// (input or output) across one or more layers.
// ---------------------------------------------------------------------------

export const securityEvent = sqliteTable(
  "security_event",
  {
    id: text("id").primaryKey(),
    /** Where the content came from. Higher-risk sources get stricter defaults. */
    input_source: text("input_source", {
      enum: ["chat", "telegram", "webhook", "email", "web", "tool_output", "skill", "internal"],
    }).notNull(),
    /** Direction of the check. Inputs go through L1+L2; outputs through L3+L4. */
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    /** Final decision across all layers that ran for this event. */
    verdict: text("verdict", { enum: ["allow", "review", "block"] }).notNull(),
    severity: text("severity", { enum: ["low", "medium", "high", "critical"] })
      .notNull()
      .default("low"),
    /** 0..1, max of layer 1 normalized score and layer 2 model score. */
    risk_score: real("risk_score").notNull().default(0),
    /** JSON array of attack category strings, e.g. ["jailbreak","leetspeak"]. */
    attack_categories: text("attack_categories").notNull().default("[]"),
    reason: text("reason").notNull().default(""),
    /** Excerpt of offending content, redacted. Capped to 500 chars. */
    evidence: text("evidence").notNull().default(""),
    /** SHA-256 of normalized input — for trending repeat attacks. */
    input_hash: text("input_hash").notNull().default(""),
    /** When this defense ran for a chat turn. */
    conversation_id: text("conversation_id"),
    message_id: text("message_id"),
    /** Layer 1 fired-rule names, JSON array. */
    layer1_detections: text("layer1_detections").notNull().default("[]"),
    /** Layer 2 raw verdict / score / categories before override logic. */
    layer2_verdict: text("layer2_verdict"),
    layer2_score: real("layer2_score"),
    layer2_categories: text("layer2_categories"),
    layer2_reasoning: text("layer2_reasoning"),
    /** Time taken to evaluate. */
    duration_ms: integer("duration_ms").notNull().default(0),
    /** Full offending input (capped at ~8KB) so the operator can replay the
     *  attack through the layers later. evidence remains the 500-char excerpt. */
    full_input: text("full_input").notNull().default(""),
    ...createdAt,
  },
  (table) => [
    index("idx_sec_event_created").on(table.created_at),
    index("idx_sec_event_verdict").on(table.verdict),
    index("idx_sec_event_severity").on(table.severity),
    index("idx_sec_event_source").on(table.input_source),
    index("idx_sec_event_hash").on(table.input_hash),
  ],
);

// ---------------------------------------------------------------------------
// llm_call_log — every model call wrapped by Layer 5 (call governor).
// Spend tracking, dedupe accounting, runaway detection. SOC reads recent
// rows; nightly rollup truncates / aggregates if it grows large.
// ---------------------------------------------------------------------------

export const llmCallLog = sqliteTable(
  "llm_call_log",
  {
    id: text("id").primaryKey(),
    /** Component that initiated the call: 'agent.runtime', 'pipeline.draft', etc. */
    caller: text("caller").notNull(),
    model: text("model").notNull(),
    prompt_tokens: integer("prompt_tokens").notNull().default(0),
    completion_tokens: integer("completion_tokens").notNull().default(0),
    /** USD cost. Computed from per-model price table at call time. */
    cost_usd: real("cost_usd").notNull().default(0),
    /** SHA-256 of (model + prompt). Used by dedupe cache. */
    prompt_hash: text("prompt_hash").notNull(),
    /** When true: response was served from the dedupe cache, no actual call. */
    cached_response: integer("cached_response", { mode: "boolean" })
      .notNull()
      .default(false),
    duration_ms: integer("duration_ms").notNull().default(0),
    error: text("error"),
    ...createdAt,
  },
  (table) => [
    index("idx_llm_log_created").on(table.created_at),
    index("idx_llm_log_caller").on(table.caller),
    index("idx_llm_log_hash").on(table.prompt_hash),
  ],
);

// ---------------------------------------------------------------------------
// spend_window — rolling-window aggregates the governor consults before each
// call. One row per (caller, window_start) bucket so we can compute totals
// without scanning every llm_call_log row. Reset to zero on window roll.
// ---------------------------------------------------------------------------

export const spendWindow = sqliteTable(
  "spend_window",
  {
    id: text("id").primaryKey(),
    /** 'global' or a specific caller for per-caller overrides. */
    caller: text("caller").notNull(),
    /** ISO timestamp of when this window opened. */
    window_start: text("window_start").notNull(),
    /** Window length in seconds (default 3600 = 1h rolling). */
    window_seconds: integer("window_seconds").notNull().default(3600),
    total_cost_usd: real("total_cost_usd").notNull().default(0),
    call_count: integer("call_count").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("idx_spend_window_caller").on(table.caller, table.window_start),
  ],
);

// ---------------------------------------------------------------------------
// agent_runtime_state — singleton key/value config the operator can hot-edit
// from the SOC. Kill-switch, dynamic spend caps, dynamic call caps. The
// agent runtime consults this on every chat() call; the governor consults
// it on every LLM call. Updating it from the UI takes effect immediately.
// ---------------------------------------------------------------------------

export const agentRuntimeState = sqliteTable("agent_runtime_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updated_at: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updated_by: text("updated_by").notNull().default("operator"),
});

// ---------------------------------------------------------------------------
// banned_input_hash — operator-banned SHA-256 input hashes. checkInbound
// hard-blocks any input whose hash matches an active row, regardless of
// what L1/L2 would have said. Optional expires_at for time-bounded bans.
// ---------------------------------------------------------------------------

export const bannedInputHash = sqliteTable(
  "banned_input_hash",
  {
    hash: text("hash").primaryKey(),
    reason: text("reason").notNull().default(""),
    created_by: text("created_by").notNull().default("operator"),
    /** When NULL, ban is permanent. Otherwise expires at this ISO timestamp. */
    expires_at: text("expires_at"),
    ...createdAt,
  },
  (table) => [index("idx_banned_hash_expires").on(table.expires_at)],
);

// ---------------------------------------------------------------------------
// blocked_category — operator-imposed time-bounded blocks on a specific
// attack category. While active, ANY input whose categories include this
// one is force-blocked even if L1+L2 would have allowed it. Used after
// observing a wave of similar attacks.
// ---------------------------------------------------------------------------

export const blockedCategory = sqliteTable(
  "blocked_category",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    /** Block ends at this ISO timestamp. Past rows are ignored by the runtime. */
    blocked_until: text("blocked_until").notNull(),
    reason: text("reason").notNull().default(""),
    created_by: text("created_by").notNull().default("operator"),
    ...createdAt,
  },
  (table) => [
    index("idx_blocked_category_until").on(table.category, table.blocked_until),
  ],
);

// ---------------------------------------------------------------------------
// security_event_review — operator review actions on a security event.
// One event can have multiple reviews (e.g. marked FP, then unmarked).
// Latest row by created_at wins for display. Kept separate from
// security_event to keep that table append-only.
// ---------------------------------------------------------------------------

export const securityEventReview = sqliteTable(
  "security_event_review",
  {
    id: text("id").primaryKey(),
    event_id: text("event_id").notNull(),
    /** What the operator did. */
    action: text("action", {
      enum: [
        "mark_false_positive",
        "unmark_false_positive",
        "reclassify_severity",
        "add_note",
      ],
    }).notNull(),
    /** When action = reclassify_severity, the new severity. */
    new_severity: text("new_severity", {
      enum: ["low", "medium", "high", "critical"],
    }),
    note: text("note").notNull().default(""),
    reviewer: text("reviewer").notNull().default("operator"),
    ...createdAt,
  },
  (table) => [
    index("idx_sec_review_event").on(table.event_id, table.created_at),
    index("idx_sec_review_action").on(table.action),
  ],
);

// ---------------------------------------------------------------------------
// social_schedule — recurring schedules. A schedule binds an action
// ("run a pipeline on instagram about latest AI news") to a cadence
// ("every Monday at 09:00 in Europe/London") so the operator's intent
// fires repeatedly without them re-typing.
//
// Cadence model: `cadence_kind` + structured fields. We store the
// natural-language original on `cadence_source` for the dashboard to
// show, but the worker only ever reads the structured fields. Cron is
// an escape hatch for things daily/weekly can't express.
//
// Action model: `action_kind` (string id) + `action_payload` (JSON blob).
// Dispatcher routes on action_kind. Adding new actions is one switch arm,
// not a schema change.
// ---------------------------------------------------------------------------

export const socialSchedule = sqliteTable(
  "social_schedule",
  {
    id: text("id").primaryKey(),
    /** Operator-facing label so list views can group/identify schedules. */
    name: text("name").notNull(),
    /** Optional longer description / why this schedule exists. */
    description: text("description").notNull().default(""),
    /** Active|paused|cancelled. Worker only fires 'active'. */
    status: text("status", {
      enum: ["active", "paused", "cancelled"],
    })
      .notNull()
      .default("active"),

    // ── cadence ────────────────────────────────────────────────────────────
    cadence_kind: text("cadence_kind", {
      enum: ["daily", "weekly", "monthly", "cron"],
    }).notNull(),
    /** JSON: { day_of_week?: 0-6[], day_of_month?: number, hour: number, minute: number, timezone: string, cron?: string } */
    cadence_payload: text("cadence_payload").notNull(),
    /** Optional natural-language original ("every Monday morning"). */
    cadence_source: text("cadence_source").notNull().default(""),

    // ── action ─────────────────────────────────────────────────────────────
    action_kind: text("action_kind", {
      enum: [
        "run_pipeline",
        "run_pipeline_multi",
        "research_only",
        "schedule_multi_day_campaign",
      ],
    }).notNull(),
    /** JSON blob — shape matches the corresponding agent tool's input schema. */
    action_payload: text("action_payload").notNull(),

    // ── tracking ───────────────────────────────────────────────────────────
    /** ISO timestamp of the next fire. Worker selects WHERE next_fire_at <= now. */
    next_fire_at: text("next_fire_at").notNull(),
    /** Most recent fire (or null if it's never fired). */
    last_fire_at: text("last_fire_at"),
    /** Outcome of the most recent fire — ok|failed|skipped, plus message. */
    last_fire_status: text("last_fire_status"),
    last_fire_message: text("last_fire_message"),
    /** Counter; the dashboard's table sorts schedules by activity. */
    fire_count: integer("fire_count").notNull().default(0),

    // ── notification routing ───────────────────────────────────────────────
    /** Drop a chat-system-message into the agent conversation on every fire. */
    notify_chat: integer("notify_chat", { mode: "boolean" }).notNull().default(true),
    /** Bot DM the operator's chat_id on every fire (requires Telegraf running). */
    notify_telegram: integer("notify_telegram", { mode: "boolean" })
      .notNull()
      .default(false),

    /** Who created this — usually 'operator' or 'agent'. */
    created_by: text("created_by").notNull().default("operator"),

    ...timestamps,
  },
  (table) => [
    index("idx_schedule_status").on(table.status),
    index("idx_schedule_next_fire").on(table.next_fire_at),
    index("idx_schedule_action").on(table.action_kind),
  ],
);

// Per-fire log so the dashboard can show "last 10 fires + outcomes" and
// the operator can drill into a specific fire's run id / error.
export const socialScheduleFire = sqliteTable(
  "social_schedule_fire",
  {
    id: text("id").primaryKey(),
    schedule_id: text("schedule_id")
      .notNull()
      .references(() => socialSchedule.id, { onDelete: "cascade" }),
    fired_at: text("fired_at").notNull(),
    status: text("status", { enum: ["ok", "failed", "skipped"] }).notNull(),
    message: text("message").notNull().default(""),
    /** When the fire produced a run, link it back so the dashboard can deep-link. */
    run_id: text("run_id"),
    /** Result payload for richer surfaces (multi-platform, multi-day fan-outs). */
    result_payload: text("result_payload").notNull().default("{}"),
    ...createdAt,
  },
  (table) => [
    index("idx_schedule_fire_schedule").on(table.schedule_id, table.fired_at),
    index("idx_schedule_fire_status").on(table.status),
  ],
);
