import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  socialRun,
  socialApproval,
  socialRunStage,
} from '../../db/schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface ApprovalRecord {
  id: string;
  run_id: string;
  reviewer: string;
  decision: 'approved' | 'rejected' | 'revision_requested';
  notes: string | null;
  rerun_stages: string[] | null;
  created_at: string;
}

interface PendingApproval {
  run_id: string;
  campaign_id: string | null;
  status: string;
  submitted_at: string;
  brief_json: unknown;
}

// --------------------------------------------------------------------------
// Approval Service
// --------------------------------------------------------------------------

export class ApprovalService {
  constructor(private readonly db: BetterSQLite3Database) {}

  // -------------------------------- helpers --------------------------------

  private getRun(runId: string) {
    const rows = this.db
      .select()
      .from(socialRun)
      .where(eq(socialRun.id, runId))
      .all();
    if (rows.length === 0) throw new Error(`Run not found: ${runId}`);
    return rows[0];
  }

  private updateRunStatus(runId: string, status: string): void {
    this.db
      .update(socialRun)
      .set({
        status: status as 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .where(eq(socialRun.id, runId))
      .run();
  }

  // ------------------------------- methods --------------------------------

  /**
   * Submit a completed pipeline run for human review.
   * Validates that the run is in a submittable state.
   */
  async submitForApproval(runId: string): Promise<ApprovalRecord> {
    const run = this.getRun(runId);

    const allowedStatuses = ['completed', 'compliance_failed', 'revision_completed'];
    if (!allowedStatuses.includes(run.status as string)) {
      throw new Error(
        `Run ${runId} cannot be submitted for approval (current status: ${run.status}). ` +
          `Must be one of: ${allowedStatuses.join(', ')}`
      );
    }

    this.updateRunStatus(runId, 'awaiting_approval');

    const record: ApprovalRecord = {
      id: uuidv4(),
      run_id: runId,
      reviewer: '',
      decision: 'approved', // placeholder — actual decision comes later
      notes: null,
      rerun_stages: null,
      created_at: new Date().toISOString(),
    };

    // We don't insert a decision record yet — just update the run status.
    // The actual approval/rejection will create the record.
    return {
      ...record,
      decision: 'approved', // indicates submission, not a decision
    };
  }

  /**
   * Approve a run that is awaiting approval.
   */
  async approve(
    runId: string,
    reviewer: string,
    notes?: string,
    draftId?: string
  ): Promise<ApprovalRecord> {
    const run = this.getRun(runId);

    if ((run.status as string) !== 'awaiting_approval') {
      throw new Error(
        `Run ${runId} is not awaiting approval (current status: ${run.status})`
      );
    }

    const record: ApprovalRecord = {
      id: uuidv4(),
      run_id: runId,
      reviewer,
      decision: 'approved',
      notes: notes ?? null,
      rerun_stages: null,
      created_at: new Date().toISOString(),
    };

    this.db.insert(socialApproval).values({
      id: record.id,
      run_id: record.run_id,
      draft_id: draftId ?? '',
      reviewer: record.reviewer,
      decision: record.decision,
      comments: record.notes ?? '',
      reviewed_at: record.created_at,
      created_at: record.created_at,
    }).run();

    this.updateRunStatus(runId, 'approved');

    return record;
  }

  /**
   * Reject a run that is awaiting approval.
   */
  async reject(
    runId: string,
    reviewer: string,
    notes: string,
    draftId?: string
  ): Promise<ApprovalRecord> {
    const run = this.getRun(runId);

    if ((run.status as string) !== 'awaiting_approval') {
      throw new Error(
        `Run ${runId} is not awaiting approval (current status: ${run.status})`
      );
    }

    const record: ApprovalRecord = {
      id: uuidv4(),
      run_id: runId,
      reviewer,
      decision: 'rejected',
      notes,
      rerun_stages: null,
      created_at: new Date().toISOString(),
    };

    this.db.insert(socialApproval).values({
      id: record.id,
      run_id: record.run_id,
      draft_id: draftId ?? '',
      reviewer: record.reviewer,
      decision: record.decision,
      comments: record.notes ?? '',
      reviewed_at: record.created_at,
      created_at: record.created_at,
    }).run();

    this.updateRunStatus(runId, 'rejected');

    return record;
  }

  /**
   * Request revisions on a run. Optionally specify which pipeline stages
   * should be re-run.
   */
  async requestRevision(
    runId: string,
    reviewer: string,
    notes: string,
    rerunStages?: string[],
    draftId?: string
  ): Promise<ApprovalRecord> {
    const run = this.getRun(runId);

    if ((run.status as string) !== 'awaiting_approval') {
      throw new Error(
        `Run ${runId} is not awaiting approval (current status: ${run.status})`
      );
    }

    const record: ApprovalRecord = {
      id: uuidv4(),
      run_id: runId,
      reviewer,
      decision: 'revision_requested',
      notes,
      rerun_stages: rerunStages ?? null,
      created_at: new Date().toISOString(),
    };

    this.db.insert(socialApproval).values({
      id: record.id,
      run_id: record.run_id,
      draft_id: draftId ?? '',
      reviewer: record.reviewer,
      decision: record.decision,
      comments: record.notes ?? '',
      revision_notes: rerunStages ? JSON.stringify(rerunStages) : '',
      reviewed_at: record.created_at,
      created_at: record.created_at,
    }).run();

    // Reset the specified stages so the pipeline can re-run them
    if (rerunStages && rerunStages.length > 0) {
      for (const stage of rerunStages) {
        this.db
          .update(socialRunStage)
          .set({
            status: 'pending',
            output_data: '{}',
            completed_at: null,
          })
          .where(
            and(
              eq(socialRunStage.run_id, runId),
              eq(
                socialRunStage.stage_name,
                stage as 'generate' | 'humanize' | 'psychology' | 'media' | 'approve' | 'publish' | 'analytics'
              )
            )
          )
          .run();
      }
    }

    this.updateRunStatus(runId, 'revision_requested');

    return record;
  }

  /**
   * List all pipeline runs currently awaiting approval.
   */
  async getPendingApprovals(): Promise<PendingApproval[]> {
    // brief_json lives inside config_snapshot JSON per schema
    const rows = this.db
      .select({
        run_id: socialRun.id,
        campaign_id: socialRun.campaign_id,
        status: socialRun.status,
        submitted_at: socialRun.updated_at,
        config_snapshot: socialRun.config_snapshot,
      })
      .from(socialRun)
      .where(eq(socialRun.status, 'awaiting_approval' as 'pending'))
      .all();

    return rows.map((row) => {
      let brief: unknown = null;
      try {
        const snapshot = row.config_snapshot
          ? JSON.parse(row.config_snapshot as string)
          : {};
        brief = snapshot?.brief ?? snapshot;
      } catch {
        brief = null;
      }
      return {
        run_id: row.run_id as string,
        campaign_id: (row.campaign_id as string) ?? null,
        status: row.status as string,
        submitted_at: row.submitted_at as string,
        brief_json: brief,
      };
    });
  }
}
