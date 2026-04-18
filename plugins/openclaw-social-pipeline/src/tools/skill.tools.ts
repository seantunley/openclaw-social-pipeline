import { eq, and } from 'drizzle-orm';
import { socialRun, socialRunStage, socialDraft } from '../db/schema.js';
import type { PluginContext, ToolParams, ToolResult, StageName } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────────

function getRunWithDrafts(db: PluginContext['db'], runId: string) {
  const run = db.select().from(socialRun).where(eq(socialRun.id, runId)).get();
  if (!run) return null;

  const drafts = db
    .select()
    .from(socialDraft)
    .where(eq(socialDraft.run_id, runId))
    .all();

  return { run, drafts };
}

function getStage(db: PluginContext['db'], runId: string, stageName: StageName) {
  return db
    .select()
    .from(socialRunStage)
    .where(and(eq(socialRunStage.run_id, runId), eq(socialRunStage.stage_name, stageName)))
    .get();
}

// ── social_apply_marketing_psychology ────────────────────────────────────────────

interface ApplyPsychologyParams extends ToolParams {
  run_id: string;
  principles?: string[];
  intensity?: string;
}

export async function social_apply_marketing_psychology(
  params: ApplyPsychologyParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, skills } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }

  try {
    const data = getRunWithDrafts(db, params.run_id);
    if (!data) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const { drafts } = data;

    if (drafts.length === 0) {
      return { success: false, data: null, error: 'No drafts found. Generate drafts first.' };
    }

    const stage = getStage(db, params.run_id, 'psychology');
    const now = new Date().toISOString();

    if (stage) {
      db.update(socialRunStage)
        .set({ status: 'running', started_at: now })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    const results = [];
    for (const draft of drafts) {
      const content = draft.final_content || draft.humanized_content || draft.raw_content;

      const result = await skills.applyMarketingPsychology(content, {
        principles: params.principles,
        intensity: params.intensity,
      });

      const existingPrinciples: string[] = JSON.parse(draft.psychology_principles_applied);
      const allPrinciples = [...new Set([...existingPrinciples, ...result.appliedPrinciples])];

      db.update(socialDraft)
        .set({
          final_content: result.content,
          status: 'enhancing',
          psychology_principles_applied: JSON.stringify(allPrinciples),
          character_count: result.content.length,
          updated_at: new Date().toISOString(),
        })
        .where(eq(socialDraft.id, draft.id))
        .run();

      results.push({
        draft_id: draft.id,
        applied_principles: result.appliedPrinciples,
        character_count: result.content.length,
      });
    }

    if (stage) {
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(now).getTime();
      db.update(socialRunStage)
        .set({
          status: 'completed',
          output_data: JSON.stringify({ results }),
          completed_at: completedAt,
          duration_ms: durationMs,
        })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    logger.info('Marketing psychology applied', { runId: params.run_id, draftCount: results.length });
    return { success: true, data: { results } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to apply marketing psychology', { runId: params.run_id, error: message });

    const stage = getStage(db, params.run_id, 'psychology');
    if (stage) {
      db.update(socialRunStage)
        .set({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    return { success: false, data: null, error: message };
  }
}

// ── social_apply_humanizer ──────────────────────────────────────────────────────

interface ApplyHumanizerParams extends ToolParams {
  run_id: string;
  aggressiveness?: string;
}

export async function social_apply_humanizer(
  params: ApplyHumanizerParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, skills } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }

  try {
    const data = getRunWithDrafts(db, params.run_id);
    if (!data) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const { drafts } = data;

    if (drafts.length === 0) {
      return { success: false, data: null, error: 'No drafts found. Generate drafts first.' };
    }

    const stage = getStage(db, params.run_id, 'humanize');
    const now = new Date().toISOString();

    if (stage) {
      db.update(socialRunStage)
        .set({ status: 'running', started_at: now })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    const results = [];
    for (const draft of drafts) {
      const content = draft.raw_content;

      const result = await skills.applyHumanizer(content, {
        aggressiveness: params.aggressiveness,
      });

      db.update(socialDraft)
        .set({
          humanized_content: result.content,
          final_content: result.content,
          status: 'humanizing',
          humanizer_changes: JSON.stringify(result.patternsFixed),
          character_count: result.content.length,
          updated_at: new Date().toISOString(),
        })
        .where(eq(socialDraft.id, draft.id))
        .run();

      results.push({
        draft_id: draft.id,
        patterns_fixed: result.patternsFixed,
        character_count: result.content.length,
      });
    }

    if (stage) {
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(now).getTime();
      db.update(socialRunStage)
        .set({
          status: 'completed',
          output_data: JSON.stringify({ results }),
          completed_at: completedAt,
          duration_ms: durationMs,
        })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    logger.info('Humanizer applied', { runId: params.run_id, draftCount: results.length });
    return { success: true, data: { results } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to apply humanizer', { runId: params.run_id, error: message });

    const stage = getStage(db, params.run_id, 'humanize');
    if (stage) {
      db.update(socialRunStage)
        .set({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    return { success: false, data: null, error: message };
  }
}
