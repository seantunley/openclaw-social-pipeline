import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { socialRuns, socialRunStages } from '../db/schema';

// ── Pipeline Statuses ─────────────────────────────────────────────────────────

export const PIPELINE_STATUSES = [
  'queued', 'collecting', 'researching', 'applying_psychology',
  'drafting', 'scoring', 'humanizing', 'checking_compliance',
  'generating_media', 'awaiting_approval', 'approved', 'rejected',
  'uploading_to_postiz', 'creating_post', 'scheduled', 'published',
  'analytics_pending', 'analytics_synced', 'failed', 'cancelled'
] as const;

export type PipelineStatus = typeof PIPELINE_STATUSES[number];

// ── Stage Names ───────────────────────────────────────────────────────────────

export const PIPELINE_STAGES = [
  'collect', 'research', 'psychology', 'draft', 'score',
  'humanize', 'compliance', 'media', 'approve', 'upload',
  'create_post', 'schedule', 'log', 'analytics_sync', 'feedback_writeback'
] as const;

export type StageName = typeof PIPELINE_STAGES[number];

// ── Valid Status Transitions ──────────────────────────────────────────────────

export const VALID_TRANSITIONS: Record<PipelineStatus, PipelineStatus[]> = {
  queued:               ['collecting', 'cancelled', 'failed'],
  collecting:           ['researching', 'failed', 'cancelled'],
  researching:          ['applying_psychology', 'failed', 'cancelled'],
  applying_psychology:  ['drafting', 'failed', 'cancelled'],
  drafting:             ['scoring', 'failed', 'cancelled'],
  scoring:              ['humanizing', 'failed', 'cancelled'],
  humanizing:           ['checking_compliance', 'failed', 'cancelled'],
  checking_compliance:  ['generating_media', 'awaiting_approval', 'failed', 'cancelled'],
  generating_media:     ['awaiting_approval', 'failed', 'cancelled'],
  awaiting_approval:    ['approved', 'rejected', 'cancelled'],
  approved:             ['uploading_to_postiz', 'failed', 'cancelled'],
  rejected:             ['queued', 'cancelled'],
  uploading_to_postiz:  ['creating_post', 'failed', 'cancelled'],
  creating_post:        ['scheduled', 'failed', 'cancelled'],
  scheduled:            ['published', 'failed', 'cancelled'],
  published:            ['analytics_pending', 'failed'],
  analytics_pending:    ['analytics_synced', 'failed'],
  analytics_synced:     [],
  failed:               ['queued', 'cancelled'],
  cancelled:            [],
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StageState {
  id: string;
  runId: string;
  stageName: string;
  status: string;
  input: object | null;
  output: object | null;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface RunState {
  id: string;
  campaignId: string;
  platform: string;
  brief: object;
  mediaMode: string | null;
  status: PipelineStatus;
  selectedDraftId: string | null;
  selectedMediaId: string | null;
  postizPostId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  stages: StageState[];
}

export interface PipelineSummary {
  total: number;
  byStatus: Record<string, number>;
  pendingApprovals: number;
  recentFailures: number;
}

// ── Drizzle DB type ───────────────────────────────────────────────────────────

type DrizzleDatabase = {
  select: (...args: any[]) => any;
  insert: (table: any) => any;
  update: (table: any) => any;
  delete: (table: any) => any;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

// ── Controller ────────────────────────────────────────────────────────────────

export class TaskFlowController {
  private db: DrizzleDatabase;

  constructor(db: DrizzleDatabase) {
    this.db = db;
  }

  /**
   * Create a new pipeline run with all 15 stage records in 'pending' status.
   */
  async createRun(campaignId: string, platform: string, brief: object): Promise<string> {
    const runId = uuidv4();
    const now = new Date().toISOString();

    // Insert the run record
    await (this.db.insert(socialRuns) as any).values({
      id: runId,
      campaignId,
      platform,
      brief: JSON.stringify(brief),
      mediaMode: 'image',
      status: 'queued' as PipelineStatus,
      createdAt: now,
      updatedAt: now,
    });

    // Insert all 15 stage records
    const stageRecords = PIPELINE_STAGES.map((stageName) => ({
      id: uuidv4(),
      runId,
      stageName,
      status: 'pending',
      retryCount: 0,
    }));

    await (this.db.insert(socialRunStages) as any).values(stageRecords);

    return runId;
  }

  /**
   * Return the full run state including all stage records.
   */
  async getRunState(runId: string): Promise<RunState> {
    const runs = await (this.db.select() as any)
      .from(socialRuns)
      .where(eq(socialRuns.id, runId))
      .limit(1);

    if (!runs || runs.length === 0) {
      throw new Error(`Run not found: ${runId}`);
    }

    const run = runs[0];

    const stages = await (this.db.select() as any)
      .from(socialRunStages)
      .where(eq(socialRunStages.runId, runId));

    return {
      id: run.id,
      campaignId: run.campaignId,
      platform: run.platform,
      brief: JSON.parse(run.brief),
      mediaMode: run.mediaMode,
      status: run.status as PipelineStatus,
      selectedDraftId: run.selectedDraftId,
      selectedMediaId: run.selectedMediaId,
      postizPostId: run.postizPostId,
      error: run.error,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      stages: stages.map((s: any) => ({
        id: s.id,
        runId: s.runId,
        stageName: s.stageName,
        status: s.status,
        input: s.input ? JSON.parse(s.input) : null,
        output: s.output ? JSON.parse(s.output) : null,
        retryCount: s.retryCount,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        error: s.error,
      })),
    };
  }

  /**
   * Validate and execute a run status transition.
   */
  async transitionRun(runId: string, newStatus: PipelineStatus): Promise<void> {
    const runState = await this.getRunState(runId);
    const currentStatus = runState.status;

    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: ${currentStatus} -> ${newStatus}. Allowed: [${(allowed || []).join(', ')}]`
      );
    }

    const now = new Date().toISOString();

    await (this.db.update(socialRuns) as any)
      .set({
        status: newStatus,
        updatedAt: now,
      })
      .where(eq(socialRuns.id, runId));
  }

  /**
   * Mark a stage as 'running' and record its start time.
   */
  async startStage(runId: string, stageName: string): Promise<void> {
    const stage = await this.findStage(runId, stageName);

    if (stage.status !== 'pending') {
      throw new Error(
        `Cannot start stage "${stageName}": current status is "${stage.status}", expected "pending"`
      );
    }

    const now = new Date().toISOString();

    await (this.db.update(socialRunStages) as any)
      .set({
        status: 'running',
        startedAt: now,
      })
      .where(
        and(
          eq(socialRunStages.runId, runId),
          eq(socialRunStages.stageName, stageName)
        )
      );
  }

  /**
   * Mark a stage as 'completed', store its output, and record end time.
   */
  async completeStage(runId: string, stageName: string, output: object): Promise<void> {
    const stage = await this.findStage(runId, stageName);

    if (stage.status !== 'running') {
      throw new Error(
        `Cannot complete stage "${stageName}": current status is "${stage.status}", expected "running"`
      );
    }

    const now = new Date().toISOString();

    await (this.db.update(socialRunStages) as any)
      .set({
        status: 'completed',
        output: JSON.stringify(output),
        completedAt: now,
      })
      .where(
        and(
          eq(socialRunStages.runId, runId),
          eq(socialRunStages.stageName, stageName)
        )
      );
  }

  /**
   * Mark a stage as 'failed' and record the error message.
   */
  async failStage(runId: string, stageName: string, error: string): Promise<void> {
    const now = new Date().toISOString();

    await (this.db.update(socialRunStages) as any)
      .set({
        status: 'failed',
        error,
        completedAt: now,
      })
      .where(
        and(
          eq(socialRunStages.runId, runId),
          eq(socialRunStages.stageName, stageName)
        )
      );
  }

  /**
   * Retry a failed stage: check retry limit, reset to 'pending', increment retry count.
   */
  async retryStage(runId: string, stageName: string): Promise<void> {
    const stage = await this.findStage(runId, stageName);

    if (stage.status !== 'failed') {
      throw new Error(
        `Cannot retry stage "${stageName}": current status is "${stage.status}", expected "failed"`
      );
    }

    if (stage.retryCount >= MAX_RETRIES) {
      throw new Error(
        `Stage "${stageName}" has exhausted all ${MAX_RETRIES} retries`
      );
    }

    await (this.db.update(socialRunStages) as any)
      .set({
        status: 'pending',
        retryCount: stage.retryCount + 1,
        error: null,
        startedAt: null,
        completedAt: null,
        output: null,
      })
      .where(
        and(
          eq(socialRunStages.runId, runId),
          eq(socialRunStages.stageName, stageName)
        )
      );
  }

  /**
   * Cancel a run and all its non-completed stages.
   */
  async cancelRun(runId: string): Promise<void> {
    const now = new Date().toISOString();

    // Cancel the run itself
    await (this.db.update(socialRuns) as any)
      .set({
        status: 'cancelled' as PipelineStatus,
        updatedAt: now,
      })
      .where(eq(socialRuns.id, runId));

    // Cancel all stages that are not already completed
    await (this.db.update(socialRunStages) as any)
      .set({
        status: 'cancelled',
        completedAt: now,
      })
      .where(
        and(
          eq(socialRunStages.runId, runId),
          sql`${socialRunStages.status} NOT IN ('completed', 'cancelled')`
        )
      );
  }

  /**
   * Query all runs matching a given status.
   */
  async getRunsByStatus(status: PipelineStatus): Promise<RunState[]> {
    const runs = await (this.db.select() as any)
      .from(socialRuns)
      .where(eq(socialRuns.status, status));

    const results: RunState[] = [];

    for (const run of runs) {
      const stages = await (this.db.select() as any)
        .from(socialRunStages)
        .where(eq(socialRunStages.runId, run.id));

      results.push({
        id: run.id,
        campaignId: run.campaignId,
        platform: run.platform,
        brief: JSON.parse(run.brief),
        mediaMode: run.mediaMode,
        status: run.status as PipelineStatus,
        selectedDraftId: run.selectedDraftId,
        selectedMediaId: run.selectedMediaId,
        postizPostId: run.postizPostId,
        error: run.error,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        stages: stages.map((s: any) => ({
          id: s.id,
          runId: s.runId,
          stageName: s.stageName,
          status: s.status,
          input: s.input ? JSON.parse(s.input) : null,
          output: s.output ? JSON.parse(s.output) : null,
          retryCount: s.retryCount,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          error: s.error,
        })),
      });
    }

    return results;
  }

  /**
   * Dashboard summary: total runs, breakdown by status, pending approvals, recent failures.
   */
  async getSummary(): Promise<PipelineSummary> {
    // Count all runs
    const totalResult = await (this.db.select({
      count: sql<number>`count(*)`,
    }) as any).from(socialRuns);

    const total = totalResult[0]?.count ?? 0;

    // Count by status
    const statusCounts = await (this.db.select({
      status: socialRuns.status,
      count: sql<number>`count(*)`,
    }) as any)
      .from(socialRuns)
      .groupBy(socialRuns.status);

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = row.count;
    }

    // Pending approvals
    const pendingResult = await (this.db.select({
      count: sql<number>`count(*)`,
    }) as any)
      .from(socialRuns)
      .where(eq(socialRuns.status, 'awaiting_approval'));

    const pendingApprovals = pendingResult[0]?.count ?? 0;

    // Recent failures (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const failureResult = await (this.db.select({
      count: sql<number>`count(*)`,
    }) as any)
      .from(socialRuns)
      .where(
        and(
          eq(socialRuns.status, 'failed'),
          sql`${socialRuns.updatedAt} >= ${twentyFourHoursAgo}`
        )
      );

    const recentFailures = failureResult[0]?.count ?? 0;

    return {
      total,
      byStatus,
      pendingApprovals,
      recentFailures,
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────────────────

  private async findStage(runId: string, stageName: string): Promise<StageState> {
    const stages = await (this.db.select() as any)
      .from(socialRunStages)
      .where(
        and(
          eq(socialRunStages.runId, runId),
          eq(socialRunStages.stageName, stageName)
        )
      )
      .limit(1);

    if (!stages || stages.length === 0) {
      throw new Error(`Stage "${stageName}" not found for run ${runId}`);
    }

    const s = stages[0];
    return {
      id: s.id,
      runId: s.runId,
      stageName: s.stageName,
      status: s.status,
      input: s.input ? JSON.parse(s.input) : null,
      output: s.output ? JSON.parse(s.output) : null,
      retryCount: s.retryCount,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      error: s.error,
    };
  }
}
