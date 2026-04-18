/**
 * Research tools — give the OpenClaw agent access to the research library.
 * Research outputs from the pipeline are stored and browsable here.
 * The agent can query, save, approve, and promote research to content runs.
 */

import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { socialResearch, socialRun } from '../db/schema.js';
import type { PluginContext, ToolResult } from './types.js';

/**
 * List research findings with optional filters.
 */
export async function social_research_list(
  params: { status?: string; campaign_id?: string; topic?: string; limit?: number },
  context: PluginContext,
): Promise<ToolResult> {
  try {
    const conditions = [];
    if (params.status) conditions.push(eq(socialResearch.status, params.status as any));
    if (params.campaign_id) conditions.push(eq(socialResearch.campaign_id, params.campaign_id));
    if (params.topic) conditions.push(eq(socialResearch.topic, params.topic));

    const query = context.db
      .select()
      .from(socialResearch)
      .orderBy(desc(socialResearch.researched_at))
      .limit(params.limit ?? 20);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

    const parsed = rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      title: r.title,
      brief: r.brief,
      angle: r.angle,
      why_now: r.why_now,
      platforms: JSON.parse(r.platforms),
      tags: JSON.parse(r.tags),
      content_type: r.content_type,
      suggested_format: r.suggested_format,
      status: r.status,
      source_summary: r.source_summary,
      researched_at: r.researched_at,
    }));

    return { success: true, data: { total: parsed.length, items: parsed } };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Get full details of a single research item including raw research data.
 */
export async function social_research_get(
  params: { research_id: string },
  context: PluginContext,
): Promise<ToolResult> {
  if (!params.research_id) {
    return { success: false, data: null, error: 'research_id is required' };
  }

  try {
    const rows = await context.db
      .select()
      .from(socialResearch)
      .where(eq(socialResearch.id, params.research_id))
      .limit(1);

    if (rows.length === 0) {
      return { success: false, data: null, error: 'Research item not found' };
    }

    const r = rows[0];
    return {
      success: true,
      data: {
        ...r,
        platforms: JSON.parse(r.platforms),
        sources: JSON.parse(r.sources),
        tags: JSON.parse(r.tags),
        research_data: JSON.parse(r.research_data),
      },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Save a research finding to the library.
 * Called by the pipeline after the research stage, or manually by the agent.
 */
export async function social_research_save(
  params: {
    topic: string;
    title: string;
    brief?: string;
    angle?: string;
    why_now?: string;
    platforms?: string[];
    sources?: { platform: string; signal: string; url?: string }[];
    source_summary?: string;
    tags?: string[];
    content_type?: 'trend' | 'evergreen' | 'research';
    suggested_format?: string;
    research_data?: Record<string, unknown>;
    run_id?: string;
    campaign_id?: string;
  },
  context: PluginContext,
): Promise<ToolResult> {
  if (!params.topic || !params.title) {
    return { success: false, data: null, error: 'topic and title are required' };
  }

  try {
    const id = uuidv4();
    const now = new Date().toISOString();

    await context.db.insert(socialResearch).values({
      id,
      run_id: params.run_id ?? null,
      campaign_id: params.campaign_id ?? null,
      topic: params.topic,
      title: params.title,
      brief: params.brief ?? '',
      angle: params.angle ?? '',
      why_now: params.why_now ?? '',
      platforms: JSON.stringify(params.platforms ?? []),
      sources: JSON.stringify(params.sources ?? []),
      source_summary: params.source_summary ?? '',
      tags: JSON.stringify(params.tags ?? []),
      content_type: params.content_type ?? 'research',
      suggested_format: params.suggested_format ?? '',
      status: 'pending',
      research_data: JSON.stringify(params.research_data ?? {}),
      researched_at: now,
      created_at: now,
      updated_at: now,
    });

    return { success: true, data: { id, status: 'pending' } };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Update a research item's status (approve, reject, archive).
 */
export async function social_research_update_status(
  params: { research_id: string; status: 'approved' | 'rejected' | 'archived' },
  context: PluginContext,
): Promise<ToolResult> {
  if (!params.research_id || !params.status) {
    return { success: false, data: null, error: 'research_id and status are required' };
  }

  try {
    const now = new Date().toISOString();
    await context.db
      .update(socialResearch)
      .set({ status: params.status, updated_at: now })
      .where(eq(socialResearch.id, params.research_id));

    return { success: true, data: { id: params.research_id, status: params.status } };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Promote a research finding to a new content run.
 * Creates a queued run pre-loaded with the research brief.
 */
export async function social_research_promote(
  params: { research_id: string; platform?: string; campaign_id?: string },
  context: PluginContext,
): Promise<ToolResult> {
  if (!params.research_id) {
    return { success: false, data: null, error: 'research_id is required' };
  }

  try {
    const rows = await context.db
      .select()
      .from(socialResearch)
      .where(eq(socialResearch.id, params.research_id))
      .limit(1);

    if (rows.length === 0) {
      return { success: false, data: null, error: 'Research item not found' };
    }

    const research = rows[0];
    const platforms = JSON.parse(research.platforms);
    const platform = params.platform ?? platforms[0] ?? 'linkedin';
    const now = new Date().toISOString();

    const runId = uuidv4();
    await context.db.insert(socialRun).values({
      id: runId,
      campaign_id: params.campaign_id ?? research.campaign_id ?? null,
      platform,
      status: 'queued',
      trigger: 'promoted_research',
      config_snapshot: JSON.stringify({
        platform,
        brief: {
          topic: research.topic,
          title: research.title,
          brief: research.brief,
          angle: research.angle,
          why_now: research.why_now,
          sources: JSON.parse(research.sources),
          source_summary: research.source_summary,
          suggested_format: research.suggested_format,
          research_id: research.id,
        },
        media_mode: 'image',
      }),
      created_at: now,
      updated_at: now,
    });

    await context.db
      .update(socialResearch)
      .set({ status: 'promoted', promoted_run_id: runId, updated_at: now })
      .where(eq(socialResearch.id, params.research_id));

    return {
      success: true,
      data: { research_id: params.research_id, run_id: runId, platform, status: 'promoted' },
    };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}
