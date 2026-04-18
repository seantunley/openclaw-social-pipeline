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
      .set({ status, updated_at: new Date().toISOString() })
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
    notes?: string
  ): Promise<ApprovalRecord> {
    const run = this.getRun(runId);

    if (run.status !== 'awaiting_approval') {
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
      reviewer: record.reviewer,
      decision: record.decision,
      notes: record.notes,
      rerun_stages: null,
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
    notes: string
  ): Promise<ApprovalRecord> {
    const run = this.getRun(runId);

    if (run.status !== 'awaiting_approval') {
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
      reviewer: record.reviewer,
      decision: record.decision,
      notes: record.notes,
      rerun_stages: null,
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
    rerunStages?: string[]
  ): Promise<ApprovalRecord> {
    const run = this.getRun(runId);

    if (run.status !== 'awaiting_approval') {
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
      reviewer: record.reviewer,
      decision: record.decision,
      notes: record.notes,
      rerun_stages: rerunStages ? JSON.stringify(rerunStages) : null,
      created_at: record.created_at,
    }).run();

    // Reset the specified stages so the pipeline can re-run them
    if (rerunStages && rerunStages.length > 0) {
      for (const stage of rerunStages) {
        this.db
          .update(socialRunStage)
          .set({
            status: 'pending',
            output_json: null,
            completed_at: null,
          })
          .where(
            and(
              eq(socialRunStage.run_id, runId),
              eq(socialRunStage.stage, stage)
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
    const rows = this.db
      .select({
        run_id: socialRun.id,
        campaign_id: socialRun.campaign_id,
        status: socialRun.status,
        submitted_at: socialRun.updated_at,
        brief_json: socialRun.brief_json,
      })
      .from(socialRun)
      .where(eq(socialRun.status, 'awaiting_approval'))
      .all();

    return rows.map((row) => ({
      run_id: row.run_id as string,
      campaign_id: (row.campaign_id as string) ?? null,
      status: row.status as string,
      submitted_at: row.submitted_at as string,
      brief_json:
        typeof row.brief_json === 'string'
          ? JSON.parse(row.brief_json as string)
          : row.brief_json,
    }));
  }
}
