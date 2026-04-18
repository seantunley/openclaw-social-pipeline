import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.js';

// ── Service interfaces ─────────────────────────────────────────────────────────

export interface PostizService {
  checkAuth(): Promise<{ authenticated: boolean; user?: string }>;
  listIntegrations(): Promise<Integration[]>;
  uploadMedia(filePath: string, metadata?: Record<string, unknown>): Promise<{ id: string; url: string }>;
  createPost(params: { content: string; integrationId: string; mediaIds?: string[] }): Promise<{ id: string }>;
  schedulePost(params: { postId: string; scheduledFor: string }): Promise<void>;
  setPostStatus(params: { postId: string; status: string }): Promise<void>;
  listPosts(params?: { integrationId?: string; status?: string }): Promise<PostizPost[]>;
  getPostAnalytics(postId: string): Promise<Record<string, unknown>>;
  getPlatformAnalytics(params: { integrationId: string; startDate?: string; endDate?: string }): Promise<Record<string, unknown>>;
}

export interface PipelineService {
  generateResearch(brief: Record<string, unknown>): Promise<{ research: string; sources: string[] }>;
  generateDrafts(params: { brief: Record<string, unknown>; research: string; platform: string; variantCount: number }): Promise<{ drafts: string[] }>;
  scoreDraft(content: string, platform: string): Promise<{ score: number; breakdown: Record<string, number> }>;
  generateImage(params: { prompt: string; aspectRatio?: string }): Promise<{ url: string }>;
  generateVideo(params: { prompt: string; aspectRatio?: string; duration?: number }): Promise<{ url: string }>;
}

export interface ApprovalService {
  notify(params: { runId: string; action: string; reviewer?: string; notes?: string }): Promise<void>;
}

export interface AnalyticsService {
  recordEvent(event: string, data: Record<string, unknown>): Promise<void>;
}

export interface SkillsService {
  applyMarketingPsychology(content: string, options?: { principles?: string[]; intensity?: string }): Promise<{ content: string; appliedPrinciples: string[] }>;
  applyHumanizer(content: string, options?: { aggressiveness?: string }): Promise<{ content: string; patternsFixed: string[] }>;
}

// ── Shared types ────────────────────────────────────────────────────────────────

export interface Integration {
  id: string;
  platform: string;
  name: string;
  status: string;
}

export interface PostizPost {
  id: string;
  content: string;
  integrationId: string;
  status: string;
  scheduledFor?: string;
  publishedAt?: string;
}

// ── Plugin context ──────────────────────────────────────────────────────────────

export interface PluginContext {
  db: BetterSQLite3Database<typeof schema>;
  config: Record<string, unknown>;
  services: {
    postiz: PostizService;
    pipeline: PipelineService;
    approvals: ApprovalService;
    analytics: AnalyticsService;
  };
  skills: SkillsService;
  logger: Logger;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

// ── Tool result ─────────────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
}

// ── Common param types ──────────────────────────────────────────────────────────

export interface ToolParams {
  [key: string]: unknown;
}

// ── Pipeline stage names ────────────────────────────────────────────────────────

export const STAGE_NAMES = [
  'generate',
  'humanize',
  'psychology',
  'media',
  'approve',
  'publish',
  'analytics',
] as const;

export type StageName = (typeof STAGE_NAMES)[number];
