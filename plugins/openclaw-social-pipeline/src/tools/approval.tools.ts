import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { socialRun, socialRunStage, socialDraft, socialApproval } from '../db/schema.js';
import type { PluginContext, ToolParams, ToolResult, StageName } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────────

function getRunWithReadyDraft(db: PluginContext['db'], runId: string) {
  const run = db.select().from(socialRun).where(eq(socialRun.id, runId)).get();
  if (!run) return null;

  const draft = db
    .select()
    .from(socialDraft)
    .where(and(eq(socialDraft.run_id, runId), eq(socialDraft.status, 'ready')))
    .get();

  return { run, draft };
}

function getStage(db: PluginContext['db'], runId: string, stageName: StageName) {
  return db
    .select()
    .from(socialRunStage)
    .where(and(eq(socialRunStage.run_id, runId), eq(socialRunStage.stage_name, stageName)))
    .get();
}

// ── social_submit_for_approval ──────────────────────────────────────────────────

interface SubmitForApprovalParams extends ToolParams {
  run_id: string;
}

export async function social_submit_for_approval(
  params: SubmitForApprovalParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }

  try {
    const data = getRunWithReadyDraft(db, params.run_id);
    if (!data) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const { run, draft } = data;

    if (!draft) {
      // Fall back to any draft in the run
      const anyDraft = db
        .select()
        .from(socialDraft)
        .where(eq(socialDraft.run_id, params.run_id))
        .get();

      if (!anyDraft) {
        return { success: false, data: null, error: 'No drafts found for this run' };
      }
    }

    const stage = getStage(db, params.run_id, 'approve');
    const now = new Date().toISOString();

    if (stage) {
      db.update(socialRunStage)
        .set({ status: 'running', started_at: now })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    // Update run status
    db.update(socialRun)
      .set({ status: 'running', updated_at: now })
      .where(eq(socialRun.id, params.run_id))
      .run();

    // Notify via approval service
    await services.approvals.notify({
      runId: params.run_id,
      action: 'submitted_for_approval',
    });

    logger.info('Submitted for approval', { runId: params.run_id });
    return {
      success: true,
      data: { run_id: params.run_id, status: 'awaiting_approval', submitted_at: now },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to submit for approval', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_approve ──────────────────────────────────────────────────────────────

interface ApproveParams extends ToolParams {
  run_id: string;
  reviewer: string;
  notes?: string;
}

export async function social_approve(
  params: ApproveParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }
  if (!params.reviewer) {
    return { success: false, data: null, error: 'reviewer is required' };
  }

  try {
    const run = db.select().from(socialRun).where(eq(socialRun.id, params.run_id)).get();
    if (!run) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    // Find the draft being approved (ready or first available)
    const draft = db
      .select()
      .from(socialDraft)
      .where(and(eq(socialDraft.run_id, params.run_id), eq(socialDraft.status, 'ready')))
      .get()
      ?? db.select().from(socialDraft).where(eq(socialDraft.run_id, params.run_id)).get();

    if (!draft) {
      return { success: false, data: null, error: 'No draft found to approve' };
    }

    const now = new Date().toISOString();
    const approvalId = uuidv4();

    db.insert(socialApproval)
      .values({
        id: approvalId,
        draft_id: draft.id,
        run_id: params.run_id,
        reviewer: params.reviewer,
        decision: 'approved',
        comments: params.notes ?? '',
        revision_notes: '',
        reviewed_at: now,
        created_at: now,
      })
      .run();

    // Update draft status
    db.update(socialDraft)
      .set({ status: 'approved', updated_at: now })
      .where(eq(socialDraft.id, draft.id))
      .run();

    // Complete approval stage
    const stage = getStage(db, params.run_id, 'approve');
    if (stage) {
      db.update(socialRunStage)
        .set({
          status: 'completed',
          output_data: JSON.stringify({ approval_id: approvalId, decision: 'approved' }),
          completed_at: now,
        })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    db.update(socialRun)
      .set({ updated_at: now })
      .where(eq(socialRun.id, params.run_id))
      .run();

    await services.approvals.notify({
      runId: params.run_id,
      action: 'approved',
      reviewer: params.reviewer,
      notes: params.notes,
    });

    logger.info('Run approved', { runId: params.run_id, reviewer: params.reviewer });
    return {
      success: true,
      data: { approval_id: approvalId, run_id: params.run_id, decision: 'approved', reviewer: params.reviewer },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to approve', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_reject ───────────────────────────────────────────────────────────────

interface RejectParams extends ToolParams {
  run_id: string;
  reviewer: string;
  notes: string;
}

export async function social_reject(
  params: RejectParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }
  if (!params.reviewer) {
    return { success: false, data: null, error: 'reviewer is required' };
  }
  if (!params.notes) {
    return { success: false, data: null, error: 'notes is required for rejection' };
  }

  try {
    const run = db.select().from(socialRun).where(eq(socialRun.id, params.run_id)).get();
    if (!run) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const draft = db
      .select()
      .from(socialDraft)
      .where(and(eq(socialDraft.run_id, params.run_id), eq(socialDraft.status, 'ready')))
      .get()
      ?? db.select().from(socialDraft).where(eq(socialDraft.run_id, params.run_id)).get();

    if (!draft) {
      return { success: false, data: null, error: 'No draft found to reject' };
    }

    const now = new Date().toISOString();
    const approvalId = uuidv4();

    db.insert(socialApproval)
      .values({
        id: approvalId,
        draft_id: draft.id,
        run_id: params.run_id,
        reviewer: params.reviewer,
        decision: 'rejected',
        comments: params.notes,
        revision_notes: '',
        reviewed_at: now,
        created_at: now,
      })
      .run();

    db.update(socialDraft)
      .set({ status: 'rejected', updated_at: now })
      .where(eq(socialDraft.id, draft.id))
      .run();

    const stage = getStage(db, params.run_id, 'approve');
    if (stage) {
      db.update(socialRunStage)
        .set({
          status: 'completed',
          output_data: JSON.stringify({ approval_id: approvalId, decision: 'rejected' }),
          completed_at: now,
        })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    db.update(socialRun)
      .set({ status: 'failed', error_message: `Rejected by ${params.reviewer}: ${params.notes}`, updated_at: now })
      .where(eq(socialRun.id, params.run_id))
      .run();

    await services.approvals.notify({
      runId: params.run_id,
      action: 'rejected',
      reviewer: params.reviewer,
      notes: params.notes,
    });

    logger.info('Run rejected', { runId: params.run_id, reviewer: params.reviewer });
    return {
      success: true,
      data: { approval_id: approvalId, run_id: params.run_id, decision: 'rejected', reviewer: params.reviewer },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to reject', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_request_revision ─────────────────────────────────────────────────────

interface RequestRevisionParams extends ToolParams {
  run_id: string;
  reviewer: string;
  notes: string;
  rerun_stages?: string[];
}

export async function social_request_revision(
  params: RequestRevisionParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }
  if (!params.reviewer) {
    return { success: false, data: null, error: 'reviewer is required' };
  }
  if (!params.notes) {
    return { success: false, data: null, error: 'notes is required for revision requests' };
  }

  try {
    const run = db.select().from(socialRun).where(eq(socialRun.id, params.run_id)).get();
    if (!run) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const draft = db
      .select()
      .from(socialDraft)
      .where(and(eq(socialDraft.run_id, params.run_id), eq(socialDraft.status, 'ready')))
      .get()
      ?? db.select().from(socialDraft).where(eq(socialDraft.run_id, params.run_id)).get();

    if (!draft) {
      return { success: false, data: null, error: 'No draft found for revision' };
    }

    const now = new Date().toISOString();
    const approvalId = uuidv4();

    db.insert(socialApproval)
      .values({
        id: approvalId,
        draft_id: draft.id,
        run_id: params.run_id,
        reviewer: params.reviewer,
        decision: 'revision_requested',
        comments: params.notes,
        revision_notes: params.notes,
        reviewed_at: now,
        created_at: now,
      })
      .run();

    // Reset specified stages for re-run
    const stagesToRerun: StageName[] = (params.rerun_stages ?? ['generate', 'humanize', 'psychology']) as StageName[];
    for (const stageName of stagesToRerun) {
      const stage = getStage(db, params.run_id, stageName);
      if (stage) {
        db.update(socialRunStage)
          .set({
            status: 'pending',
            error_message: null,
            started_at: null,
            completed_at: null,
            duration_ms: null,
            attempts: stage.attempts + 1,
          })
          .where(eq(socialRunStage.id, stage.id))
          .run();
      }
    }

    // Reset approval stage
    const approveStage = getStage(db, params.run_id, 'approve');
    if (approveStage) {
      db.update(socialRunStage)
        .set({ status: 'pending', started_at: null, completed_at: null })
        .where(eq(socialRunStage.id, approveStage.id))
        .run();
    }

    db.update(socialRun)
      .set({ status: 'running', updated_at: now, error_message: null })
      .where(eq(socialRun.id, params.run_id))
      .run();

    await services.approvals.notify({
      runId: params.run_id,
      action: 'revision_requested',
      reviewer: params.reviewer,
      notes: params.notes,
    });

    logger.info('Revision requested', { runId: params.run_id, reviewer: params.reviewer, rerunStages: stagesToRerun });
    return {
      success: true,
      data: {
        approval_id: approvalId,
        run_id: params.run_id,
        decision: 'revision_requested',
        reviewer: params.reviewer,
        rerun_stages: stagesToRerun,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to request revision', { error: message });
    return { success: false, data: null, error: message };
  }
}
