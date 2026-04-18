import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { socialCampaign } from '../db/schema.js';
import type { PluginContext, ToolParams, ToolResult } from './types.js';

// ── social_campaign_create ──────────────────────────────────────────────────────

interface CampaignCreateParams extends ToolParams {
  name: string;
  description?: string;
  target_platforms: string[];
  audience?: string;
  objective?: string;
  cta_style?: string;
  posting_windows?: string[];
}

export async function social_campaign_create(
  params: CampaignCreateParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  if (!params.name || typeof params.name !== 'string') {
    return { success: false, data: null, error: 'name is required and must be a string' };
  }

  if (!Array.isArray(params.target_platforms) || params.target_platforms.length === 0) {
    return { success: false, data: null, error: 'target_platforms must be a non-empty array' };
  }

  try {
    const now = new Date().toISOString();
    const id = uuidv4();

    // Pack posting_windows and cta_style into goals JSON for storage
    const goals = [];
    if (params.objective) goals.push(params.objective);
    if (params.cta_style) goals.push(`CTA style: ${params.cta_style}`);
    if (params.posting_windows) goals.push(`Posting windows: ${params.posting_windows.join(', ')}`);

    const campaign = {
      id,
      name: params.name,
      description: params.description ?? '',
      status: 'active' as const,
      target_platforms: JSON.stringify(params.target_platforms),
      target_audience: params.audience ?? '',
      brand_voice_notes: '',
      goals: JSON.stringify(goals),
      tags: '[]',
      start_date: null,
      end_date: null,
      created_at: now,
      updated_at: now,
    };

    db.insert(socialCampaign).values(campaign).run();
    logger.info('Campaign created', { id, name: params.name });

    return {
      success: true,
      data: {
        ...campaign,
        target_platforms: params.target_platforms,
        goals,
        tags: [],
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to create campaign', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_campaign_update ──────────────────────────────────────────────────────

interface CampaignUpdateParams extends ToolParams {
  id: string;
  name?: string;
  description?: string;
  target_platforms?: string[];
  audience?: string;
  objective?: string;
  cta_style?: string;
  posting_windows?: string[];
  status?: string;
}

export async function social_campaign_update(
  params: CampaignUpdateParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  if (!params.id) {
    return { success: false, data: null, error: 'id is required' };
  }

  try {
    const existing = db.select().from(socialCampaign).where(eq(socialCampaign.id, params.id)).get();
    if (!existing) {
      return { success: false, data: null, error: `Campaign ${params.id} not found` };
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (params.name !== undefined) updates.name = params.name;
    if (params.description !== undefined) updates.description = params.description;
    if (params.target_platforms !== undefined) updates.target_platforms = JSON.stringify(params.target_platforms);
    if (params.audience !== undefined) updates.target_audience = params.audience;
    if (params.status !== undefined) updates.status = params.status;

    // Rebuild goals if objective/cta_style/posting_windows provided
    if (params.objective !== undefined || params.cta_style !== undefined || params.posting_windows !== undefined) {
      const existingGoals: string[] = JSON.parse(existing.goals);
      const goals = [...existingGoals];
      if (params.objective) goals.push(params.objective);
      if (params.cta_style) goals.push(`CTA style: ${params.cta_style}`);
      if (params.posting_windows) goals.push(`Posting windows: ${params.posting_windows.join(', ')}`);
      updates.goals = JSON.stringify(goals);
    }

    db.update(socialCampaign).set(updates).where(eq(socialCampaign.id, params.id)).run();
    logger.info('Campaign updated', { id: params.id });

    const updated = db.select().from(socialCampaign).where(eq(socialCampaign.id, params.id)).get();
    return { success: true, data: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to update campaign', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_brief_create ─────────────────────────────────────────────────────────
// Briefs are stored as config_snapshot JSON on the run, but we also provide a
// convenience creator that builds the brief object and returns it for use when
// creating a run.

interface BriefCreateParams extends ToolParams {
  campaign_id: string;
  platform: string;
  topic: string;
  audience_segment?: string;
  goal?: string;
  tone?: string;
  cta?: string;
}

export async function social_brief_create(
  params: BriefCreateParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  if (!params.campaign_id) {
    return { success: false, data: null, error: 'campaign_id is required' };
  }
  if (!params.platform) {
    return { success: false, data: null, error: 'platform is required' };
  }
  if (!params.topic) {
    return { success: false, data: null, error: 'topic is required' };
  }

  try {
    const campaign = db.select().from(socialCampaign).where(eq(socialCampaign.id, params.campaign_id)).get();
    if (!campaign) {
      return { success: false, data: null, error: `Campaign ${params.campaign_id} not found` };
    }

    const brief = {
      id: uuidv4(),
      campaign_id: params.campaign_id,
      platform: params.platform,
      topic: params.topic,
      audience_segment: params.audience_segment ?? null,
      goal: params.goal ?? null,
      tone: params.tone ?? null,
      cta: params.cta ?? null,
      campaign_name: campaign.name,
      target_audience: campaign.target_audience,
      brand_voice_notes: campaign.brand_voice_notes,
      created_at: new Date().toISOString(),
    };

    logger.info('Brief created', { id: brief.id, campaignId: params.campaign_id });

    return { success: true, data: brief };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to create brief', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_brief_list ───────────────────────────────────────────────────────────
// Lists briefs by reading config_snapshot from runs belonging to a campaign.

interface BriefListParams extends ToolParams {
  campaign_id?: string;
}

export async function social_brief_list(
  params: BriefListParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  try {
    // We import socialRun here to avoid circular deps at module level
    const { socialRun } = await import('../db/schema.js');

    let query = db.select().from(socialRun);

    if (params.campaign_id) {
      query = query.where(eq(socialRun.campaign_id, params.campaign_id)) as typeof query;
    }

    const runs = query.all();

    const briefs = runs.map((run) => {
      const config = JSON.parse(run.config_snapshot);
      return {
        run_id: run.id,
        campaign_id: run.campaign_id,
        brief: config,
        created_at: run.created_at,
      };
    });

    logger.info('Briefs listed', { count: briefs.length });
    return { success: true, data: briefs };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to list briefs', { error: message });
    return { success: false, data: null, error: message };
  }
}
