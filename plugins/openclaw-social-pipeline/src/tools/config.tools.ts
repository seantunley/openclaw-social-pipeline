import { eq, desc, count } from 'drizzle-orm';
import {
  socialConfig,
  socialCampaign,
  socialRun,
  socialRunStage,
  socialDraft,
  socialPublishRecord,
} from '../db/schema.js';
import type { PluginContext, ToolParams, ToolResult } from './types.js';

// ── social_config_get ───────────────────────────────────────────────────────────

interface ConfigGetParams extends ToolParams {
  key?: string;
}

export async function social_config_get(
  params: ConfigGetParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  try {
    if (params.key) {
      const row = db
        .select()
        .from(socialConfig)
        .where(eq(socialConfig.key, params.key))
        .get();

      if (!row) {
        return { success: false, data: null, error: `Config key '${params.key}' not found` };
      }

      // Try to parse JSON values
      let value: unknown = row.value;
      try {
        value = JSON.parse(row.value);
      } catch {
        // Keep as string
      }

      logger.info('Config retrieved', { key: params.key });
      return { success: true, data: { key: row.key, value, updated_at: row.updated_at } };
    }

    // Return all config
    const rows = db.select().from(socialConfig).all();
    const config: Record<string, unknown> = {};

    for (const row of rows) {
      try {
        config[row.key] = JSON.parse(row.value);
      } catch {
        config[row.key] = row.value;
      }
    }

    logger.info('All config retrieved', { count: rows.length });
    return { success: true, data: config };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to get config', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_config_set ───────────────────────────────────────────────────────────

interface ConfigSetParams extends ToolParams {
  key: string;
  value: unknown;
}

export async function social_config_set(
  params: ConfigSetParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  if (!params.key) {
    return { success: false, data: null, error: 'key is required' };
  }
  if (params.value === undefined) {
    return { success: false, data: null, error: 'value is required' };
  }

  try {
    const now = new Date().toISOString();
    const valueStr = typeof params.value === 'string' ? params.value : JSON.stringify(params.value);

    const existing = db.select().from(socialConfig).where(eq(socialConfig.key, params.key)).get();

    if (existing) {
      db.update(socialConfig)
        .set({ value: valueStr, updated_at: now })
        .where(eq(socialConfig.key, params.key))
        .run();
    } else {
      db.insert(socialConfig)
        .values({ key: params.key, value: valueStr, updated_at: now })
        .run();
    }

    logger.info('Config set', { key: params.key });
    return { success: true, data: { key: params.key, value: params.value, updated_at: now } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to set config', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_dashboard_summary ────────────────────────────────────────────────────

export async function social_dashboard_summary(
  _params: ToolParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  try {
    const campaigns = db.select({ count: count() }).from(socialCampaign).get();
    const activeCampaigns = db
      .select({ count: count() })
      .from(socialCampaign)
      .where(eq(socialCampaign.status, 'active'))
      .get();

    const totalRuns = db.select({ count: count() }).from(socialRun).get();
    const pendingRuns = db
      .select({ count: count() })
      .from(socialRun)
      .where(eq(socialRun.status, 'pending'))
      .get();
    const runningRuns = db
      .select({ count: count() })
      .from(socialRun)
      .where(eq(socialRun.status, 'running'))
      .get();
    const completedRuns = db
      .select({ count: count() })
      .from(socialRun)
      .where(eq(socialRun.status, 'completed'))
      .get();
    const failedRuns = db
      .select({ count: count() })
      .from(socialRun)
      .where(eq(socialRun.status, 'failed'))
      .get();

    const totalDrafts = db.select({ count: count() }).from(socialDraft).get();
    const publishedDrafts = db
      .select({ count: count() })
      .from(socialDraft)
      .where(eq(socialDraft.status, 'published'))
      .get();

    const totalPublished = db
      .select({ count: count() })
      .from(socialPublishRecord)
      .where(eq(socialPublishRecord.status, 'published'))
      .get();

    const recentRuns = db
      .select()
      .from(socialRun)
      .orderBy(desc(socialRun.created_at))
      .limit(5)
      .all();

    const summary = {
      campaigns: {
        total: campaigns?.count ?? 0,
        active: activeCampaigns?.count ?? 0,
      },
      runs: {
        total: totalRuns?.count ?? 0,
        pending: pendingRuns?.count ?? 0,
        running: runningRuns?.count ?? 0,
        completed: completedRuns?.count ?? 0,
        failed: failedRuns?.count ?? 0,
      },
      drafts: {
        total: totalDrafts?.count ?? 0,
        published: publishedDrafts?.count ?? 0,
      },
      published: {
        total: totalPublished?.count ?? 0,
      },
      recent_runs: recentRuns.map((r) => ({
        id: r.id,
        campaign_id: r.campaign_id,
        status: r.status,
        created_at: r.created_at,
      })),
    };

    logger.info('Dashboard summary generated');
    return { success: true, data: summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to generate dashboard summary', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_dashboard_pipeline_state ─────────────────────────────────────────────

export async function social_dashboard_pipeline_state(
  _params: ToolParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  try {
    // Get all currently active runs (pending or running)
    const activeRuns = db
      .select()
      .from(socialRun)
      .where(eq(socialRun.status, 'running'))
      .all();

    const pendingRuns = db
      .select()
      .from(socialRun)
      .where(eq(socialRun.status, 'pending'))
      .all();

    const allActive = [...activeRuns, ...pendingRuns];

    const pipelineState = [];
    for (const run of allActive) {
      const stages = db
        .select()
        .from(socialRunStage)
        .where(eq(socialRunStage.run_id, run.id))
        .all();

      const draftCount = db
        .select({ count: count() })
        .from(socialDraft)
        .where(eq(socialDraft.run_id, run.id))
        .get();

      const config = JSON.parse(run.config_snapshot);

      pipelineState.push({
        run_id: run.id,
        campaign_id: run.campaign_id,
        platform: config.platform ?? 'unknown',
        status: run.status,
        created_at: run.created_at,
        draft_count: draftCount?.count ?? 0,
        stages: stages.map((s) => ({
          name: s.stage_name,
          status: s.status,
          attempts: s.attempts,
          order: s.order_index,
        })),
        current_stage: stages.find((s) => s.status === 'running')?.stage_name
          ?? stages.find((s) => s.status === 'pending')?.stage_name
          ?? 'done',
      });
    }

    logger.info('Pipeline state retrieved', { activeRunCount: pipelineState.length });
    return { success: true, data: { active_runs: pipelineState, total_active: pipelineState.length } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to get pipeline state', { error: message });
    return { success: false, data: null, error: message };
  }
}
