import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import * as sqliteVec from "sqlite-vec";
import * as schema from "./schema.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Default database path
// ---------------------------------------------------------------------------

const DEFAULT_DB_DIR = resolve(
  process.env.OPENCLAW_DATA_DIR ?? "./data"
);
const DEFAULT_DB_PATH = resolve(DEFAULT_DB_DIR, "social-pipeline.db");

// ---------------------------------------------------------------------------
// SQL for creating all tables (push-based migration)
// ---------------------------------------------------------------------------

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS social_campaign (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    target_platforms TEXT NOT NULL DEFAULT '[]',
    target_audience TEXT NOT NULL DEFAULT '',
    brand_voice_notes TEXT NOT NULL DEFAULT '',
    goals TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    start_date TEXT,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_campaign_status ON social_campaign(status);
  CREATE INDEX IF NOT EXISTS idx_campaign_created ON social_campaign(created_at);

  CREATE TABLE IF NOT EXISTS social_run (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES social_campaign(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    trigger TEXT NOT NULL DEFAULT 'manual',
    config_snapshot TEXT NOT NULL DEFAULT '{}',
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_run_campaign ON social_run(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_run_status ON social_run(status);

  CREATE TABLE IF NOT EXISTS social_run_stage (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES social_run(id) ON DELETE CASCADE,
    stage_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    order_index INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    input_data TEXT NOT NULL DEFAULT '{}',
    output_data TEXT NOT NULL DEFAULT '{}',
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_stage_run ON social_run_stage(run_id);
  CREATE INDEX IF NOT EXISTS idx_stage_status ON social_run_stage(status);
  CREATE INDEX IF NOT EXISTS idx_stage_name ON social_run_stage(stage_name);

  CREATE TABLE IF NOT EXISTS social_draft (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES social_run(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL REFERENCES social_campaign(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    variant_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'generating',
    raw_content TEXT NOT NULL DEFAULT '',
    humanized_content TEXT NOT NULL DEFAULT '',
    final_content TEXT NOT NULL DEFAULT '',
    psychology_principles_applied TEXT NOT NULL DEFAULT '[]',
    humanizer_changes TEXT NOT NULL DEFAULT '[]',
    seo_score REAL,
    brand_score REAL,
    character_count INTEGER NOT NULL DEFAULT 0,
    hashtags TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_draft_run ON social_draft(run_id);
  CREATE INDEX IF NOT EXISTS idx_draft_campaign ON social_draft(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_draft_platform ON social_draft(platform);
  CREATE INDEX IF NOT EXISTS idx_draft_status ON social_draft(status);

  CREATE TABLE IF NOT EXISTS social_media_asset (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES social_draft(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'generating',
    prompt TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    source_url TEXT,
    hosted_url TEXT,
    media_mode TEXT NOT NULL DEFAULT 'image',
    aspect_ratio TEXT NOT NULL DEFAULT '1:1',
    width INTEGER,
    height INTEGER,
    duration_seconds REAL,
    file_size_bytes INTEGER,
    mime_type TEXT,
    carousel_index INTEGER,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_asset_draft ON social_media_asset(draft_id);
  CREATE INDEX IF NOT EXISTS idx_asset_type ON social_media_asset(type);
  CREATE INDEX IF NOT EXISTS idx_asset_status ON social_media_asset(status);

  CREATE TABLE IF NOT EXISTS social_approval (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES social_draft(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES social_run(id) ON DELETE CASCADE,
    reviewer TEXT NOT NULL DEFAULT '',
    decision TEXT NOT NULL,
    comments TEXT NOT NULL DEFAULT '',
    revision_notes TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_approval_draft ON social_approval(draft_id);
  CREATE INDEX IF NOT EXISTS idx_approval_run ON social_approval(run_id);
  CREATE INDEX IF NOT EXISTS idx_approval_decision ON social_approval(decision);

  CREATE TABLE IF NOT EXISTS social_publish_record (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES social_draft(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES social_run(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    postiz_post_id TEXT,
    postiz_integration_id TEXT,
    scheduled_at TEXT,
    published_at TEXT,
    platform_post_id TEXT,
    platform_post_url TEXT,
    error_message TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_publish_draft ON social_publish_record(draft_id);
  CREATE INDEX IF NOT EXISTS idx_publish_run ON social_publish_record(run_id);
  CREATE INDEX IF NOT EXISTS idx_publish_platform ON social_publish_record(platform);
  CREATE INDEX IF NOT EXISTS idx_publish_status ON social_publish_record(status);

  CREATE TABLE IF NOT EXISTS social_analytics_snapshot (
    id TEXT PRIMARY KEY,
    publish_record_id TEXT NOT NULL REFERENCES social_publish_record(id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL REFERENCES social_draft(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    snapshot_at TEXT NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0,
    reach INTEGER NOT NULL DEFAULT 0,
    engagements INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    saves INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    video_views INTEGER NOT NULL DEFAULT 0,
    video_watch_time_seconds REAL NOT NULL DEFAULT 0,
    followers_gained INTEGER NOT NULL DEFAULT 0,
    engagement_rate REAL NOT NULL DEFAULT 0,
    raw_data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_analytics_publish ON social_analytics_snapshot(publish_record_id);
  CREATE INDEX IF NOT EXISTS idx_analytics_draft ON social_analytics_snapshot(draft_id);
  CREATE INDEX IF NOT EXISTS idx_analytics_platform ON social_analytics_snapshot(platform);
  CREATE INDEX IF NOT EXISTS idx_analytics_snapshot_at ON social_analytics_snapshot(snapshot_at);

  CREATE TABLE IF NOT EXISTS social_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS social_research (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES social_run(id) ON DELETE SET NULL,
    campaign_id TEXT REFERENCES social_campaign(id) ON DELETE SET NULL,
    topic TEXT NOT NULL,
    title TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT '',
    angle TEXT NOT NULL DEFAULT '',
    why_now TEXT NOT NULL DEFAULT '',
    platforms TEXT NOT NULL DEFAULT '[]',
    sources TEXT NOT NULL DEFAULT '[]',
    source_summary TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    content_type TEXT NOT NULL DEFAULT 'research',
    suggested_format TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    promoted_run_id TEXT,
    research_data TEXT NOT NULL DEFAULT '{}',
    researched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_research_status ON social_research(status);
  CREATE INDEX IF NOT EXISTS idx_research_campaign ON social_research(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_research_topic ON social_research(topic);

  CREATE TABLE IF NOT EXISTS social_learning (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    platform TEXT,
    campaign_id TEXT REFERENCES social_campaign(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_run_id TEXT REFERENCES social_run(id) ON DELETE SET NULL,
    confidence REAL NOT NULL DEFAULT 0.3,
    reinforcement_count INTEGER NOT NULL DEFAULT 1,
    last_reinforced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    tags TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_learning_category ON social_learning(category);
  CREATE INDEX IF NOT EXISTS idx_learning_platform ON social_learning(platform);
  CREATE INDEX IF NOT EXISTS idx_learning_confidence ON social_learning(confidence);
  CREATE INDEX IF NOT EXISTS idx_learning_active ON social_learning(active);

  CREATE TABLE IF NOT EXISTS social_brand_profile (
    id TEXT PRIMARY KEY,
    campaign_id TEXT REFERENCES social_campaign(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    audience TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    voice TEXT NOT NULL DEFAULT '',
    writing_guidelines TEXT NOT NULL DEFAULT '',
    banned_words TEXT NOT NULL DEFAULT '[]',
    required_phrases TEXT NOT NULL DEFAULT '[]',
    signature_phrases TEXT NOT NULL DEFAULT '[]',
    target_keywords TEXT NOT NULL DEFAULT '[]',
    target_hashtags TEXT NOT NULL DEFAULT '[]',
    audience_pain_points TEXT NOT NULL DEFAULT '[]',
    audience_aspirations TEXT NOT NULL DEFAULT '[]',
    archetype TEXT NOT NULL DEFAULT '',
    primary_color TEXT NOT NULL DEFAULT '',
    secondary_color TEXT NOT NULL DEFAULT '',
    accent_color TEXT NOT NULL DEFAULT '',
    logo_url TEXT NOT NULL DEFAULT '',
    mission TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_brand_campaign ON social_brand_profile(campaign_id);

  CREATE TABLE IF NOT EXISTS social_import_batch (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    filename TEXT NOT NULL DEFAULT '',
    file_size INTEGER NOT NULL DEFAULT 0,
    total_posts INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_import_batch_platform ON social_import_batch(platform);

  CREATE TABLE IF NOT EXISTS social_imported_post (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES social_import_batch(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    platform_post_id TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    posted_at TEXT,
    engagement TEXT NOT NULL DEFAULT '{}',
    media TEXT NOT NULL DEFAULT '[]',
    raw TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_imported_post_batch ON social_imported_post(batch_id);
  CREATE INDEX IF NOT EXISTS idx_imported_post_platform ON social_imported_post(platform);

  -- =========================================================================
  -- Agent tables (memory + skills + profile)
  -- =========================================================================

  CREATE TABLE IF NOT EXISTS agent_profile (
    id TEXT PRIMARY KEY DEFAULT 'default',
    name TEXT NOT NULL DEFAULT 'Agent',
    system_prompt TEXT NOT NULL DEFAULT '',
    default_model TEXT NOT NULL DEFAULT 'anthropic/claude-opus-4-7',
    default_temperature REAL NOT NULL DEFAULT 0.7,
    max_steps INTEGER NOT NULL DEFAULT 10,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Seed the singleton row exactly once.
  INSERT OR IGNORE INTO agent_profile (id, name, system_prompt)
  VALUES ('default', 'Agent', 'You are a helpful agent assisting a single operator with their social media pipeline.');

  CREATE TABLE IF NOT EXISTS agent_conversation (
    id TEXT PRIMARY KEY,
    surface TEXT NOT NULL,
    surface_ref TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_conv_surface ON agent_conversation(surface, surface_ref);
  CREATE INDEX IF NOT EXISTS idx_agent_conv_updated ON agent_conversation(updated_at);

  CREATE TABLE IF NOT EXISTS agent_message (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES agent_conversation(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tool_calls TEXT NOT NULL DEFAULT '[]',
    tool_call_id TEXT,
    tool_name TEXT,
    tool_result TEXT NOT NULL DEFAULT '{}',
    extracted_at TEXT,
    embedded_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_msg_conv ON agent_message(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_msg_role ON agent_message(role);
  CREATE INDEX IF NOT EXISTS idx_agent_msg_extracted ON agent_message(extracted_at);
  CREATE INDEX IF NOT EXISTS idx_agent_msg_embedded ON agent_message(embedded_at);

  CREATE TABLE IF NOT EXISTS agent_fact (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    source_message_id TEXT NOT NULL REFERENCES agent_message(id) ON DELETE CASCADE,
    extractor_model TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0.5,
    reinforcement_count INTEGER NOT NULL DEFAULT 1,
    last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_validated_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    superseded_by_message_id TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    embedded_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_fact_type ON agent_fact(type);
  CREATE INDEX IF NOT EXISTS idx_agent_fact_subject ON agent_fact(subject);
  CREATE INDEX IF NOT EXISTS idx_agent_fact_active ON agent_fact(active);
  CREATE INDEX IF NOT EXISTS idx_agent_fact_confidence ON agent_fact(confidence);
  CREATE INDEX IF NOT EXISTS idx_agent_fact_embedded ON agent_fact(embedded_at);

  CREATE TABLE IF NOT EXISTS user_preference (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    set_explicitly INTEGER NOT NULL DEFAULT 1,
    set_via_message_id TEXT REFERENCES agent_message(id) ON DELETE SET NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_user_pref_active ON user_preference(active);

  CREATE TABLE IF NOT EXISTS conversation_summary (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES agent_conversation(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    start_message_id TEXT,
    end_message_id TEXT,
    bucket_date TEXT,
    summary_text TEXT NOT NULL,
    summarizer_model TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_conv_summary_conv ON conversation_summary(conversation_id, period);
  CREATE INDEX IF NOT EXISTS idx_conv_summary_bucket ON conversation_summary(bucket_date);

  CREATE TABLE IF NOT EXISTS agent_lesson (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source_conversation_id TEXT REFERENCES agent_conversation(id) ON DELETE SET NULL,
    confidence REAL NOT NULL DEFAULT 0.6,
    reinforcement_count INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_lesson_active ON agent_lesson(active);
  CREATE INDEX IF NOT EXISTS idx_agent_lesson_confidence ON agent_lesson(confidence);

  CREATE TABLE IF NOT EXISTS agent_skill (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '0.0.0',
    source_type TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    checksum_sha256 TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'registered',
    approved_at TEXT,
    approved_by TEXT,
    revoked_at TEXT,
    revoked_reason TEXT,
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_skill_status ON agent_skill(status);
  CREATE INDEX IF NOT EXISTS idx_agent_skill_name ON agent_skill(name);

  CREATE TABLE IF NOT EXISTS agent_skill_tool (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL REFERENCES agent_skill(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    input_schema_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_skill_tool_skill ON agent_skill_tool(skill_id);
  CREATE INDEX IF NOT EXISTS idx_agent_skill_tool_name ON agent_skill_tool(name);

  CREATE TABLE IF NOT EXISTS agent_skill_audit (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL REFERENCES agent_skill(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'operator',
    note TEXT NOT NULL DEFAULT '',
    expected_checksum TEXT,
    actual_checksum TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_skill_audit_skill ON agent_skill_audit(skill_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_skill_audit_event ON agent_skill_audit(event);

  -- =========================================================================
  -- Agent defense (SOC telemetry)
  -- =========================================================================

  CREATE TABLE IF NOT EXISTS security_event (
    id TEXT PRIMARY KEY,
    input_source TEXT NOT NULL,
    direction TEXT NOT NULL,
    verdict TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'low',
    risk_score REAL NOT NULL DEFAULT 0,
    attack_categories TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '',
    input_hash TEXT NOT NULL DEFAULT '',
    conversation_id TEXT,
    message_id TEXT,
    layer1_detections TEXT NOT NULL DEFAULT '[]',
    layer2_verdict TEXT,
    layer2_score REAL,
    layer2_categories TEXT,
    layer2_reasoning TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    full_input TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sec_event_created ON security_event(created_at);
  CREATE INDEX IF NOT EXISTS idx_sec_event_verdict ON security_event(verdict);
  CREATE INDEX IF NOT EXISTS idx_sec_event_severity ON security_event(severity);
  CREATE INDEX IF NOT EXISTS idx_sec_event_source ON security_event(input_source);
  CREATE INDEX IF NOT EXISTS idx_sec_event_hash ON security_event(input_hash);

  CREATE TABLE IF NOT EXISTS llm_call_log (
    id TEXT PRIMARY KEY,
    caller TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    prompt_hash TEXT NOT NULL,
    cached_response INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_llm_log_created ON llm_call_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_llm_log_caller ON llm_call_log(caller);
  CREATE INDEX IF NOT EXISTS idx_llm_log_hash ON llm_call_log(prompt_hash);

  CREATE TABLE IF NOT EXISTS spend_window (
    id TEXT PRIMARY KEY,
    caller TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_seconds INTEGER NOT NULL DEFAULT 3600,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    call_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_spend_window_caller ON spend_window(caller, window_start);

  -- =========================================================================
  -- SOC operator-console state
  -- =========================================================================

  CREATE TABLE IF NOT EXISTS agent_runtime_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_by TEXT NOT NULL DEFAULT 'operator'
  );

  CREATE TABLE IF NOT EXISTS banned_input_hash (
    hash TEXT PRIMARY KEY,
    reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'operator',
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_banned_hash_expires ON banned_input_hash(expires_at);

  CREATE TABLE IF NOT EXISTS blocked_category (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    blocked_until TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'operator',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_blocked_category_until ON blocked_category(category, blocked_until);

  CREATE TABLE IF NOT EXISTS security_event_review (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    action TEXT NOT NULL,
    new_severity TEXT,
    note TEXT NOT NULL DEFAULT '',
    reviewer TEXT NOT NULL DEFAULT 'operator',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sec_review_event ON security_event_review(event_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_sec_review_action ON security_event_review(action);

  CREATE TABLE IF NOT EXISTS social_schedule (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    cadence_kind TEXT NOT NULL,
    cadence_payload TEXT NOT NULL,
    cadence_source TEXT NOT NULL DEFAULT '',
    action_kind TEXT NOT NULL,
    action_payload TEXT NOT NULL,
    next_fire_at TEXT NOT NULL,
    last_fire_at TEXT,
    last_fire_status TEXT,
    last_fire_message TEXT,
    fire_count INTEGER NOT NULL DEFAULT 0,
    notify_chat INTEGER NOT NULL DEFAULT 1,
    notify_telegram INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL DEFAULT 'operator',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_schedule_status ON social_schedule(status);
  CREATE INDEX IF NOT EXISTS idx_schedule_next_fire ON social_schedule(next_fire_at);
  CREATE INDEX IF NOT EXISTS idx_schedule_action ON social_schedule(action_kind);

  CREATE TABLE IF NOT EXISTS social_schedule_fire (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES social_schedule(id) ON DELETE CASCADE,
    fired_at TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    run_id TEXT,
    result_payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_schedule_fire_schedule ON social_schedule_fire(schedule_id, fired_at);
  CREATE INDEX IF NOT EXISTS idx_schedule_fire_status ON social_schedule_fire(status);
`;

// Separate from the main CREATE_TABLES_SQL because virtual tables (FTS5 + vec0)
// must be created after the extension is loaded, and FTS triggers need the
// table they reference to already exist. Applied unconditionally inside initDb()
// after the base CREATE runs.
const CREATE_FTS_AND_TRIGGERS_SQL = `
  -- FTS5 mirrors. Contentless mode (content=''): we manage the index manually
  -- via triggers below. Using rowid (auto-INTEGER on every SQLite table) as
  -- the join key — agent_message.id is TEXT so we keep both around.
  CREATE VIRTUAL TABLE IF NOT EXISTS agent_message_fts USING fts5(
    content,
    content='agent_message',
    content_rowid='rowid',
    tokenize='porter unicode61'
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS agent_fact_fts USING fts5(
    content,
    content='agent_fact',
    content_rowid='rowid',
    tokenize='porter unicode61'
  );

  -- Sync triggers so FTS stays consistent without us thinking about it.
  CREATE TRIGGER IF NOT EXISTS agent_message_fts_ai AFTER INSERT ON agent_message BEGIN
    INSERT INTO agent_message_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS agent_message_fts_ad AFTER DELETE ON agent_message BEGIN
    INSERT INTO agent_message_fts(agent_message_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  END;
  CREATE TRIGGER IF NOT EXISTS agent_message_fts_au AFTER UPDATE ON agent_message BEGIN
    INSERT INTO agent_message_fts(agent_message_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO agent_message_fts(rowid, content) VALUES (new.rowid, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS agent_fact_fts_ai AFTER INSERT ON agent_fact BEGIN
    INSERT INTO agent_fact_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS agent_fact_fts_ad AFTER DELETE ON agent_fact BEGIN
    INSERT INTO agent_fact_fts(agent_fact_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  END;
  CREATE TRIGGER IF NOT EXISTS agent_fact_fts_au AFTER UPDATE ON agent_fact BEGIN
    INSERT INTO agent_fact_fts(agent_fact_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO agent_fact_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
`;

// sqlite-vec virtual tables. Dimension is configurable via AGENT_EMBED_DIM
// (default 1536, matching OpenAI text-embedding-3-small). vec0 doesn't allow
// dynamic dims after creation — change AGENT_EMBED_DIM only on a fresh DB
// or migrate by exporting/re-importing embeddings.
function vecTablesSql(dim: number): string {
  return `
    CREATE VIRTUAL TABLE IF NOT EXISTS agent_message_vec USING vec0(
      message_id TEXT PRIMARY KEY,
      embedding FLOAT[${dim}]
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS agent_fact_vec USING vec0(
      fact_id TEXT PRIMARY KEY,
      embedding FLOAT[${dim}]
    );
  `;
}

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

export interface InitDbOptions {
  /** Path to the SQLite database file. Defaults to ./data/social-pipeline.db */
  dbPath?: string;
  /** Enable WAL mode for better concurrency. Defaults to true. */
  walMode?: boolean;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

/**
 * Initialize the SQLite database, create tables if they do not exist,
 * and return the Drizzle ORM instance.
 */
export function initDb(options: InitDbOptions = {}): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;

  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const walMode = options.walMode ?? true;

  // Ensure the directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Open SQLite connection
  _sqlite = new Database(dbPath);

  // Load sqlite-vec extension. Required before any vec0 virtual table runs.
  // If the extension fails to load we surface that clearly — agent memory
  // vector recall depends on it. See [feedback_no_silent_failure.md].
  try {
    sqliteVec.load(_sqlite);
  } catch (err) {
    throw new Error(
      `Failed to load sqlite-vec extension: ${(err as Error).message}. ` +
        `Agent memory vector recall will not work. Reinstall with \`npm i sqlite-vec\` ` +
        `or set AGENT_DISABLE_VECTOR=1 to skip (FTS-only memory remains functional).`,
    );
  }

  // Performance pragmas
  if (walMode) {
    _sqlite.pragma("journal_mode = WAL");
  }
  _sqlite.pragma("busy_timeout = 5000");
  _sqlite.pragma("synchronous = NORMAL");
  _sqlite.pragma("cache_size = -64000"); // 64 MB
  _sqlite.pragma("foreign_keys = ON");
  _sqlite.pragma("temp_store = MEMORY");

  // Run table creation (idempotent)
  _sqlite.exec(CREATE_TABLES_SQL);

  // FTS5 mirrors + sync triggers. Must be applied AFTER the base tables exist
  // because triggers reference them. Idempotent via IF NOT EXISTS.
  _sqlite.exec(CREATE_FTS_AND_TRIGGERS_SQL);

  // sqlite-vec virtual tables for semantic recall. Dimension is fixed at
  // creation time — change AGENT_EMBED_DIM only against a fresh DB.
  const embedDim = Number(process.env.AGENT_EMBED_DIM ?? 1536);
  if (!Number.isFinite(embedDim) || embedDim < 32 || embedDim > 4096) {
    throw new Error(`AGENT_EMBED_DIM must be 32..4096, got: ${process.env.AGENT_EMBED_DIM}`);
  }
  _sqlite.exec(vecTablesSql(embedDim));

  // Idempotent column migrations for fields added after the initial CREATE.
  // SQLite doesn't have `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so we probe
  // and conditionally add. Each ALTER must be its own statement.
  const ensureColumn = (table: string, column: string, definition: string) => {
    const cols = _sqlite!
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      _sqlite!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  ensureColumn("social_run", "deleted_at", "TEXT");
  _sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_run_deleted ON social_run(deleted_at)`,
  );
  // Smart scheduler: persists when a run should fire. The scheduler worker
  // polls for rows where status='scheduled' AND scheduled_at <= now, then
  // promotes them to 'running' and invokes the pipeline.
  ensureColumn("social_run", "scheduled_at", "TEXT");
  _sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_run_scheduled ON social_run(scheduled_at)`,
  );
  // SOC: store the full offending input alongside the truncated evidence so
  // operators can replay a blocked attack through the layers. Capped to ~8KB
  // at write time in agent-defense/index.ts.
  ensureColumn("security_event", "full_input", "TEXT NOT NULL DEFAULT ''");

  // Create Drizzle instance
  _db = drizzle(_sqlite, { schema });

  return _db;
}

/**
 * Get the existing database instance. Throws if initDb() has not been called.
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_db) {
    throw new Error(
      "Database not initialized. Call initDb() before using getDb()."
    );
  }
  return _db;
}

/**
 * Get the raw better-sqlite3 instance for advanced operations.
 */
export function getSqlite(): Database.Database {
  if (!_sqlite) {
    throw new Error(
      "Database not initialized. Call initDb() before using getSqlite()."
    );
  }
  return _sqlite;
}

/**
 * Close the database connection and reset internal state.
 */
export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}

export { schema };
