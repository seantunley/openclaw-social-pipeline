import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, and, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  socialRun,
  socialRunStage,
  socialDraft,
  socialMediaAsset,
  socialApproval,
  socialPublishRecord,
  socialCampaign,
} from "../../src/db/schema.js";

const runsRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── GET /api/social/runs ────────────────────────────────────────────────────
  fastify.get("/api/social/runs", async (request, reply) => {
    const {
      status,
      campaign_id,
      platform,
      limit = 50,
      offset = 0,
    } = request.query as {
      status?: string;
      campaign_id?: string;
      platform?: string;
      limit?: number;
      offset?: number;
    };

    try {
      const conditions: ReturnType<typeof eq>[] = [];

      if (status) {
        conditions.push(eq(socialRun.status, status as any));
      }
      if (campaign_id) {
        conditions.push(eq(socialRun.campaign_id, campaign_id));
      }

      let query = fastify.db
        .select()
        .from(socialRun)
        .orderBy(desc(socialRun.created_at))
        .limit(Number(limit))
        .offset(Number(offset));

      if (conditions.length === 1) {
        query = query.where(conditions[0]) as typeof query;
      } else if (conditions.length > 1) {
        query = query.where(and(...conditions)) as typeof query;
      }

      const runs = await query;

      // Attach stage summaries to each run
      const result = await Promise.all(
        runs.map(async (run) => {
          const stages = await fastify.db
            .select()
            .from(socialRunStage)
            .where(eq(socialRunStage.run_id, run.id));

          const stageSummary: Record<string, string> = {};
          for (const s of stages) {
            stageSummary[s.stage_name] = s.status;
          }

          return {
            ...run,
            config_snapshot: JSON.parse(run.config_snapshot),
            stages: stageSummary,
          };
        })
      );

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to list runs");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs ───────────────────────────────────────────────────
  fastify.post("/api/social/runs", async (request, reply) => {
    const { campaign_id, platform, brief, media_mode } = request.body as {
      campaign_id: string;
      platform: string;
      brief: Record<string, unknown>;
      media_mode?: string;
    };

    if (!campaign_id) {
      return reply.status(400).send({ error: "campaign_id is required" });
    }
    if (!platform) {
      return reply.status(400).send({ error: "platform is required" });
    }
    if (!brief || typeof brief !== "object") {
      return reply
        .status(400)
        .send({ error: "brief is required and must be an object" });
    }

    try {
      // Verify campaign exists
      const campaign = await fastify.db
        .select()
        .from(socialCampaign)
        .where(eq(socialCampaign.id, campaign_id))
        .limit(1);

      if (campaign.length === 0) {
        return reply
          .status(404)
          .send({ error: `Campaign ${campaign_id} not found` });
      }

      const runId = uuidv4();
      const now = new Date().toISOString();

      await fastify.db.insert(socialRun).values({
        id: runId,
        campaign_id,
        status: "pending",
        trigger: "manual",
        config_snapshot: JSON.stringify({
          platform,
          brief,
          media_mode: media_mode ?? "image",
        }),
        created_at: now,
        updated_at: now,
      });

      // Create default stage records
      const stageNames = [
        "generate",
        "humanize",
        "psychology",
        "media",
        "approve",
        "publish",
        "analytics",
      ] as const;

      for (let i = 0; i < stageNames.length; i++) {
        await fastify.db.insert(socialRunStage).values({
          id: uuidv4(),
          run_id: runId,
          stage_name: stageNames[i],
          status: "pending",
          order_index: i,
          attempts: 0,
          max_retries: 3,
          input_data: "{}",
          output_data: "{}",
        });
      }

      const created = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, runId))
        .limit(1);

      const stages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(eq(socialRunStage.run_id, runId));

      return reply.status(201).send({
        ...created[0],
        config_snapshot: JSON.parse(created[0].config_snapshot),
        stages,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to create run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /api/social/runs/:id ────────────────────────────────────────────────
  fastify.get("/api/social/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const runs = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      if (runs.length === 0) {
        return reply.status(404).send({ error: `Run ${id} not found` });
      }

      const run = runs[0];

      const stages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(eq(socialRunStage.run_id, id));

      const drafts = await fastify.db
        .select()
        .from(socialDraft)
        .where(eq(socialDraft.run_id, id));

      // Gather media assets for each draft
      const media = [];
      for (const draft of drafts) {
        const assets = await fastify.db
          .select()
          .from(socialMediaAsset)
          .where(eq(socialMediaAsset.draft_id, draft.id));
        media.push(...assets);
      }

      const approvals = await fastify.db
        .select()
        .from(socialApproval)
        .where(eq(socialApproval.run_id, id));

      const publishRecords = await fastify.db
        .select()
        .from(socialPublishRecord)
        .where(eq(socialPublishRecord.run_id, id));

      return reply.send({
        ...run,
        config_snapshot: JSON.parse(run.config_snapshot),
        stages: stages.map((s) => ({
          ...s,
          input_data: JSON.parse(s.input_data),
          output_data: JSON.parse(s.output_data),
        })),
        drafts: drafts.map((d) => ({
          ...d,
          psychology_principles_applied: JSON.parse(
            d.psychology_principles_applied
          ),
          humanizer_changes: JSON.parse(d.humanizer_changes),
          hashtags: JSON.parse(d.hashtags),
          metadata: JSON.parse(d.metadata),
        })),
        media: media.map((m) => ({
          ...m,
          metadata: JSON.parse(m.metadata),
        })),
        approvals,
        publish_records: publishRecords.map((p) => ({
          ...p,
          metadata: JSON.parse(p.metadata),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to get run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/:id/retry-stage ───────────────────────────────────
  fastify.post("/api/social/runs/:id/retry-stage", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { stage_name } = request.body as { stage_name: string };

    if (!stage_name) {
      return reply.status(400).send({ error: "stage_name is required" });
    }

    try {
      const runs = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      if (runs.length === 0) {
        return reply.status(404).send({ error: `Run ${id} not found` });
      }

      const stages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(
          and(
            eq(socialRunStage.run_id, id),
            eq(socialRunStage.stage_name, stage_name as any)
          )
        )
        .limit(1);

      if (stages.length === 0) {
        return reply
          .status(404)
          .send({
            error: `Stage ${stage_name} not found for run ${id}`,
          });
      }

      const stage = stages[0];

      if (stage.status !== "failed") {
        return reply
          .status(400)
          .send({
            error: `Cannot retry stage with status '${stage.status}'. Only failed stages can be retried.`,
          });
      }

      if (stage.attempts >= stage.max_retries) {
        return reply
          .status(400)
          .send({
            error: `Stage ${stage_name} has exhausted all ${stage.max_retries} retries`,
          });
      }

      const now = new Date().toISOString();

      await fastify.db
        .update(socialRunStage)
        .set({
          status: "retrying",
          attempts: stage.attempts + 1,
          error_message: null,
          started_at: null,
          completed_at: null,
        })
        .where(eq(socialRunStage.id, stage.id));

      // If the run was in failed state, move it back to running
      if (runs[0].status === "failed") {
        await fastify.db
          .update(socialRun)
          .set({ status: "running", updated_at: now, error_message: null })
          .where(eq(socialRun.id, id));
      }

      const updatedRun = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      const updatedStages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(eq(socialRunStage.run_id, id));

      return reply.send({
        ...updatedRun[0],
        config_snapshot: JSON.parse(updatedRun[0].config_snapshot),
        stages: updatedStages,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to retry stage");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/:id/cancel ────────────────────────────────────────
  fastify.post("/api/social/runs/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const runs = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      if (runs.length === 0) {
        return reply.status(404).send({ error: `Run ${id} not found` });
      }

      const run = runs[0];

      if (run.status === "completed" || run.status === "cancelled") {
        return reply
          .status(400)
          .send({
            error: `Cannot cancel a run with status '${run.status}'`,
          });
      }

      const now = new Date().toISOString();

      await fastify.db
        .update(socialRun)
        .set({ status: "cancelled", updated_at: now })
        .where(eq(socialRun.id, id));

      // Cancel all pending/running stages
      await fastify.db
        .update(socialRunStage)
        .set({ status: "skipped", completed_at: now })
        .where(
          and(
            eq(socialRunStage.run_id, id),
            sql`${socialRunStage.status} IN ('pending', 'running', 'retrying')`
          )
        );

      const updatedRun = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      const updatedStages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(eq(socialRunStage.run_id, id));

      return reply.send({
        ...updatedRun[0],
        config_snapshot: JSON.parse(updatedRun[0].config_snapshot),
        stages: updatedStages,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to cancel run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── PATCH /api/social/runs/:id/reschedule ──────────────────────────────────
  fastify.patch("/api/social/runs/:id/reschedule", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { scheduledAt } = request.body as { scheduledAt: string };

      if (!scheduledAt) {
        return reply.status(400).send({ error: "scheduledAt is required" });
      }

      const existing = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      if (existing.length === 0) {
        return reply.status(404).send({ error: "Run not found" });
      }

      const now = new Date().toISOString();
      await fastify.db
        .update(socialRun)
        .set({
          scheduled_for: scheduledAt,
          updated_at: now,
        })
        .where(eq(socialRun.id, id));

      const updated = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      return reply.send({
        ...updated[0],
        config_snapshot: JSON.parse(updated[0].config_snapshot),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to reschedule run");
      return reply.status(500).send({ error: message });
    }
  });

  done();
};

export default runsRoutes;
