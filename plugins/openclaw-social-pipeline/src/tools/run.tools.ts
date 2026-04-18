import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  socialRun,
  socialRunStage,
  socialCampaign,
  socialDraft,
  socialMediaAsset,
  socialApproval,
} from '../db/schema.js';
import type { PluginContext, ToolParams, ToolResult, StageName } from './types.js';
import { STAGE_NAMES } from './types.js';

type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// ── social_run_create ───────────────────────────────────────────────────────────

interface RunCreateParams extends ToolParams {
  campaign_id: string;
  platform: string;
  brief: Record<string, unknown>;
  media_mode?: string;
}

export async function social_run_create(
  params: RunCreateParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  if (!params.campaign_id) {
    return { success: false, data: null, error: 'campaign_id is required' };
  }
  if (!params.platform) {
    return { success: false, data: null, error: 'platform is required' };
  }
  if (!params.brief || typeof params.brief !== 'object') {
    return { success: false, data: null, error: 'brief is required and must be an object' };
  }

  try {
    const campaign = db
      .select()
      .from(socialCampaign)
      .where(eq(socialCampaign.id, params.campaign_id))
      .get();

    if (!campaign) {
      return { success: false, data: null, error: `Campaign ${params.campaign_id} not found` };
    }

    const now = new Date().toISOString();
    const runId = uuidv4();

    const configSnapshot = {
      ...params.brief,
      platform: params.platform,
      media_mode: params.media_mode ?? 'image',
    };

    const run = {
      id: runId,
      campaign_id: params.campaign_id,
      status: 'pending' as const,
      trigger: 'manual' as const,
      config_snapshot: JSON.stringify(configSnapshot),
      started_at: null,
      completed_at: null,
      error_message: null,
      created_at: now,
      updated_at: now,
    };

    db.insert(socialRun).values(run).run();

    // Initialize all stage records
    const stages: Array<{ stage_name: StageName; order_index: number }> = STAGE_NAMES.map(
      (name, idx) => ({ stage_name: name, order_index: idx }),
    );

    for (const stage of stages) {
      db.insert(socialRunStage)
        .values({
          id: uuidv4(),
          run_id: runId,
          stage_name: stage.stage_name,
          status: 'pending',
          order_index: stage.order_index,
          attempts: 0,
          max_retries: 3,
          input_data: '{}',
          output_data: '{}',
          error_message: null,
          started_at: null,
          completed_at: null,
          duration_ms: null,
          created_at: now,
        })
        .run();
    }

    logger.info('Run created', { runId, campaignId: params.campaign_id, platform: params.platform });

    return {
      success: true,
      data: {
        ...run,
        config_snapshot: configSnapshot,
        stages: stages.map((s) => ({
          stage_name: s.stage_name,
          status: 'pending',
          order_index: s.order_index,
        })),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to create run', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_run_list ─────────────────────────────────────────────────────────────

interface RunListParams extends ToolParams {
  status?: string;
  campaign_id?: string;
  platform?: string;
  limit?: number;
  offset?: number;
}

export async function social_run_list(
  params: RunListParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  try {
    const conditions = [];

    if (params.status) {
      conditions.push(eq(socialRun.status, params.status as RunStatus));
    }
    if (params.campaign_id) {
      conditions.push(eq(socialRun.campaign_id, params.campaign_id));
    }

    let query = db.select().from(socialRun);

    if (conditions.length === 1) {
      query = query.where(conditions[0]) as typeof query;
    } else if (conditions.length > 1) {
      query = query.where(and(...conditions)) as typeof query;
    }

    query = query.orderBy(desc(socialRun.created_at)) as typeof query;

    if (params.limit) {
      query = query.limit(params.limit) as typeof query;
    }
    if (params.offset) {
      query = query.offset(params.offset) as typeof query;
    }

    const runs = query.all();

    // If platform filter requested, filter in JS since platform lives in config_snapshot
    let filtered = runs;
    if (params.platform) {
      filtered = runs.filter((r) => {
        const config = JSON.parse(r.config_snapshot);
        return config.platform === params.platform;
      });
    }

    logger.info('Runs listed', { count: filtered.length });
    return { success: true, data: filtered };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to list runs', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_run_get ──────────────────────────────────────────────────────────────

interface RunGetParams extends ToolParams {
  run_id: string;
}

export async function social_run_get(
  params: RunGetParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }

  try {
    const run = db.select().from(socialRun).where(eq(socialRun.id, params.run_id)).get();
    if (!run) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const stages = db
      .select()
      .from(socialRunStage)
      .where(eq(socialRunStage.run_id, params.run_id))
      .all();

    const drafts = db
      .select()
      .from(socialDraft)
      .where(eq(socialDraft.run_id, params.run_id))
      .all();

    const approvals = db
      .select()
      .from(socialApproval)
      .where(eq(socialApproval.run_id, params.run_id))
      .all();

    // Collect media from all drafts in this run
    const draftIds = drafts.map((d) => d.id);
    const media = [];
    for (const draftId of draftIds) {
      const assets = db
        .select()
        .from(socialMediaAsset)
        .where(eq(socialMediaAsset.draft_id, draftId))
        .all();
      media.push(...assets);
    }

    logger.info('Run retrieved', { runId: params.run_id });

    return {
      success: true,
      data: {
        ...run,
        config_snapshot: JSON.parse(run.config_snapshot),
        stages,
        drafts,
        media,
        approvals,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to get run', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_run_retry_stage ──────────────────────────────────────────────────────

interface RunRetryStageParams extends ToolParams {
  run_id: string;
  stage_name: string;
}

export async function social_run_retry_stage(
  params: RunRetryStageParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }
  if (!params.stage_name) {
    return { success: false, data: null, error: 'stage_name is required' };
  }

  if (!STAGE_NAMES.includes(params.stage_name as StageName)) {
    return {
      success: false,
      data: null,
      error: `Invalid stage_name. Must be one of: ${STAGE_NAMES.join(', ')}`,
    };
  }

  try {
    const stage = db
      .select()
      .from(socialRunStage)
      .where(
        and(
          eq(socialRunStage.run_id, params.run_id),
          eq(socialRunStage.stage_name, params.stage_name as StageName),
        ),
      )
      .get();

    if (!stage) {
      return {
        success: false,
        data: null,
        error: `Stage ${params.stage_name} not found for run ${params.run_id}`,
      };
    }

    if (stage.attempts >= stage.max_retries) {
      return {
        success: false,
        data: null,
        error: `Stage ${params.stage_name} has exceeded max retries (${stage.max_retries})`,
      };
    }

    db.update(socialRunStage)
      .set({
        status: 'retrying',
        attempts: stage.attempts + 1,
        error_message: null,
        started_at: null,
        completed_at: null,
        duration_ms: null,
      })
      .where(eq(socialRunStage.id, stage.id))
      .run();

    // Reset run status if it was failed
    const run = db.select().from(socialRun).where(eq(socialRun.id, params.run_id)).get();
    if (run && (run.status === 'failed' || run.status === 'cancelled')) {
      db.update(socialRun)
        .set({ status: 'running', updated_at: new Date().toISOString(), error_message: null })
        .where(eq(socialRun.id, params.run_id))
        .run();
    }

    logger.info('Stage retry initiated', {
      runId: params.run_id,
      stage: params.stage_name,
      attempts: stage.attempts + 1,
    });

    return {
      success: true,
      data: {
        run_id: params.run_id,
        stage_name: params.stage_name,
        attempts: stage.attempts + 1,
        max_retries: stage.max_retries,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to retry stage', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_run_cancel ───────────────────────────────────────────────────────────

interface RunCancelParams extends ToolParams {
  run_id: string;
}

export async function social_run_cancel(
  params: RunCancelParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }

  try {
    const run = db.select().from(socialRun).where(eq(socialRun.id, params.run_id)).get();
    if (!run) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    if (run.status === 'completed') {
      return { success: false, data: null, error: 'Cannot cancel a completed run' };
    }

    const now = new Date().toISOString();

    db.update(socialRun)
      .set({ status: 'cancelled', updated_at: now })
      .where(eq(socialRun.id, params.run_id))
      .run();

    // Cancel any pending/retrying stages
    const pendingStages = db
      .select()
      .from(socialRunStage)
      .where(
        and(
          eq(socialRunStage.run_id, params.run_id),
          eq(socialRunStage.status, 'pending'),
        ),
      )
      .all();

    for (const stage of pendingStages) {
      db.update(socialRunStage)
        .set({ status: 'skipped' })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    logger.info('Run cancelled', { runId: params.run_id });
    return { success: true, data: { run_id: params.run_id, status: 'cancelled' } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to cancel run', { error: message });
    return { success: false, data: null, error: message };
  }
}
