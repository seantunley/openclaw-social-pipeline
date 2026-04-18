import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
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
`;

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
