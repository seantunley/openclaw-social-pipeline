import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { socialRun, socialRunStage, socialDraft } from '../db/schema.js';
import type { PluginContext, ToolParams, ToolResult, StageName } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────────

function getRun(db: PluginContext['db'], runId: string) {
  return db.select().from(socialRun).where(eq(socialRun.id, runId)).get();
}

function getStage(db: PluginContext['db'], runId: string, stageName: StageName) {
  return db
    .select()
    .from(socialRunStage)
    .where(and(eq(socialRunStage.run_id, runId), eq(socialRunStage.stage_name, stageName)))
    .get();
}

function markStageRunning(db: PluginContext['db'], stageId: string) {
  db.update(socialRunStage)
    .set({ status: 'running', started_at: new Date().toISOString() })
    .where(eq(socialRunStage.id, stageId))
    .run();
}

function markStageCompleted(db: PluginContext['db'], stageId: string, output: unknown, startedAt: string) {
  const now = new Date().toISOString();
  const durationMs = new Date(now).getTime() - new Date(startedAt).getTime();
  db.update(socialRunStage)
    .set({
      status: 'completed',
      output_data: JSON.stringify(output),
      completed_at: now,
      duration_ms: durationMs,
    })
    .where(eq(socialRunStage.id, stageId))
    .run();
}

function markStageFailed(db: PluginContext['db'], stageId: string, error: string) {
  db.update(socialRunStage)
    .set({ status: 'failed', error_message: error, completed_at: new Date().toISOString() })
    .where(eq(socialRunStage.id, stageId))
    .run();
}

// ── social_research_generate ────────────────────────────────────────────────────

interface ResearchGenerateParams extends ToolParams {
  run_id: string;
}

export async function social_research_generate(
  params: ResearchGenerateParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }

  try {
    const run = getRun(db, params.run_id);
    if (!run) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const stage = getStage(db, params.run_id, 'generate');
    if (!stage) {
      return { success: false, data: null, error: 'Generate stage not found for this run' };
    }

    const now = new Date().toISOString();
    markStageRunning(db, stage.id);

    db.update(socialRun)
      .set({ status: 'running', started_at: now, updated_at: now })
      .where(eq(socialRun.id, params.run_id))
      .run();

    const config = JSON.parse(run.config_snapshot);
    const result = await services.pipeline.generateResearch(config);

    markStageCompleted(db, stage.id, result, now);

    logger.info('Research generated', { runId: params.run_id });
    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Research generation failed', { runId: params.run_id, error: message });

    const stage = getStage(db, params.run_id, 'generate');
    if (stage) markStageFailed(db, stage.id, message);

    db.update(socialRun)
      .set({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
      .where(eq(socialRun.id, params.run_id))
      .run();

    return { success: false, data: null, error: message };
  }
}

// ── social_draft_generate ───────────────────────────────────────────────────────

interface DraftGenerateParams extends ToolParams {
  run_id: string;
  variant_count?: number;
}

export async function social_draft_generate(
  params: DraftGenerateParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }

  const variantCount = params.variant_count ?? 3;

  try {
    const run = getRun(db, params.run_id);
    if (!run) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const stage = getStage(db, params.run_id, 'generate');
    if (!stage) {
      return { success: false, data: null, error: 'Generate stage not found for this run' };
    }

    // Get research output if available
    let research = '';
    if (stage.output_data && stage.output_data !== '{}') {
      const researchData = JSON.parse(stage.output_data);
      research = researchData.research ?? '';
    }

    const now = new Date().toISOString();
    markStageRunning(db, stage.id);

    const config = JSON.parse(run.config_snapshot);
    const platform = config.platform ?? 'generic';

    const result = await services.pipeline.generateDrafts({
      brief: config,
      research,
      platform,
      variantCount,
    });

    // Store each draft variant
    const savedDrafts = [];
    for (let i = 0; i < result.drafts.length; i++) {
      const draftId = uuidv4();
      const draftNow = new Date().toISOString();
      const draft = {
        id: draftId,
        run_id: params.run_id,
        campaign_id: run.campaign_id,
        platform,
        variant_index: i,
        status: 'generating' as const,
        raw_content: result.drafts[i],
        humanized_content: '',
        final_content: result.drafts[i],
        psychology_principles_applied: '[]',
        humanizer_changes: '[]',
        seo_score: null,
        brand_score: null,
        character_count: result.drafts[i].length,
        hashtags: '[]',
        metadata: '{}',
        created_at: draftNow,
        updated_at: draftNow,
      };
      db.insert(socialDraft).values(draft).run();
      savedDrafts.push(draft);
    }

    markStageCompleted(db, stage.id, {
      draft_count: savedDrafts.length,
      draft_ids: savedDrafts.map((d) => d.id),
    }, now);

    logger.info('Drafts generated', { runId: params.run_id, count: savedDrafts.length });
    return { success: true, data: { drafts: savedDrafts } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Draft generation failed', { runId: params.run_id, error: message });

    const stage = getStage(db, params.run_id, 'generate');
    if (stage) markStageFailed(db, stage.id, message);

    return { success: false, data: null, error: message };
  }
}

// ── social_draft_score ──────────────────────────────────────────────────────────

interface DraftScoreParams extends ToolParams {
  run_id: string;
}

export async function social_draft_score(
  params: DraftScoreParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }

  try {
    const run = getRun(db, params.run_id);
    if (!run) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const drafts = db
      .select()
      .from(socialDraft)
      .where(eq(socialDraft.run_id, params.run_id))
      .all();

    if (drafts.length === 0) {
      return { success: false, data: null, error: 'No drafts found for this run. Generate drafts first.' };
    }

    const config = JSON.parse(run.config_snapshot);
    const platform = config.platform ?? 'generic';

    const scoredDrafts = [];
    for (const draft of drafts) {
      const content = draft.final_content || draft.raw_content;
      const result = await services.pipeline.scoreDraft(content, platform);

      db.update(socialDraft)
        .set({
          seo_score: result.score,
          metadata: JSON.stringify({
            ...JSON.parse(draft.metadata),
            score_breakdown: result.breakdown,
          }),
          updated_at: new Date().toISOString(),
        })
        .where(eq(socialDraft.id, draft.id))
        .run();

      scoredDrafts.push({
        id: draft.id,
        variant_index: draft.variant_index,
        score: result.score,
        breakdown: result.breakdown,
      });
    }

    logger.info('Drafts scored', { runId: params.run_id, count: scoredDrafts.length });
    return { success: true, data: { scores: scoredDrafts } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Draft scoring failed', { runId: params.run_id, error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_draft_select ─────────────────────────────────────────────────────────

interface DraftSelectParams extends ToolParams {
  run_id: string;
  draft_id: string;
}

export async function social_draft_select(
  params: DraftSelectParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }
  if (!params.draft_id) {
    return { success: false, data: null, error: 'draft_id is required' };
  }

  try {
    const run = getRun(db, params.run_id);
    if (!run) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const draft = db
      .select()
      .from(socialDraft)
      .where(and(eq(socialDraft.id, params.draft_id), eq(socialDraft.run_id, params.run_id)))
      .get();

    if (!draft) {
      return { success: false, data: null, error: `Draft ${params.draft_id} not found in run ${params.run_id}` };
    }

    // Mark all drafts in this run as not ready, then mark selected as ready
    const allDrafts = db
      .select()
      .from(socialDraft)
      .where(eq(socialDraft.run_id, params.run_id))
      .all();

    for (const d of allDrafts) {
      if (d.id === params.draft_id) {
        db.update(socialDraft)
          .set({ status: 'ready', updated_at: new Date().toISOString() })
          .where(eq(socialDraft.id, d.id))
          .run();
      }
    }

    logger.info('Draft selected', { runId: params.run_id, draftId: params.draft_id });
    return { success: true, data: { run_id: params.run_id, selected_draft_id: params.draft_id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to select draft', { error: message });
    return { success: false, data: null, error: message };
  }
}
