import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  socialRun,
  socialRunStage,
  socialDraft,
  socialApproval,
} from "../../src/db/schema.js";

const approvalsRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── POST /api/social/runs/:id/approve ───────────────────────────────────────
  fastify.post("/api/social/runs/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reviewer, notes } = request.body as {
      reviewer: string;
      notes?: string;
    };

    if (!reviewer) {
      return reply.status(400).send({ error: "reviewer is required" });
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

      // Find the latest ready draft for this run
      const drafts = await fastify.db
        .select()
        .from(socialDraft)
        .where(
          and(eq(socialDraft.run_id, id), eq(socialDraft.status, "ready"))
        );

      if (drafts.length === 0) {
        return reply
          .status(400)
          .send({ error: "No ready draft found for this run" });
      }

      const draft = drafts[0];
      const now = new Date().toISOString();

      // Create approval record
      await fastify.db.insert(socialApproval).values({
        id: uuidv4(),
        draft_id: draft.id,
        run_id: id,
        reviewer,
        decision: "approved",
        comments: notes ?? "",
        revision_notes: "",
        reviewed_at: now,
      });

      // Update draft status
      await fastify.db
        .update(socialDraft)
        .set({ status: "approved", updated_at: now })
        .where(eq(socialDraft.id, draft.id));

      // Complete the approve stage
      const approveStages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(
          and(
            eq(socialRunStage.run_id, id),
            eq(socialRunStage.stage_name, "approve")
          )
        )
        .limit(1);

      if (approveStages.length > 0) {
        await fastify.db
          .update(socialRunStage)
          .set({
            status: "completed",
            completed_at: now,
            output_data: JSON.stringify({
              decision: "approved",
              reviewer,
              notes: notes ?? "",
            }),
          })
          .where(eq(socialRunStage.id, approveStages[0].id));
      }

      // Update run status
      await fastify.db
        .update(socialRun)
        .set({ status: "running", updated_at: now })
        .where(eq(socialRun.id, id));

      return reply.send({
        run_id: id,
        draft_id: draft.id,
        decision: "approved",
        reviewer,
        notes: notes ?? "",
        reviewed_at: now,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to approve run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/:id/reject ────────────────────────────────────────
  fastify.post("/api/social/runs/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reviewer, notes } = request.body as {
      reviewer: string;
      notes: string;
    };

    if (!reviewer) {
      return reply.status(400).send({ error: "reviewer is required" });
    }
    if (!notes) {
      return reply
        .status(400)
        .send({ error: "notes are required when rejecting" });
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

      // Find drafts for this run that are ready or in review
      const drafts = await fastify.db
        .select()
        .from(socialDraft)
        .where(
          and(eq(socialDraft.run_id, id), eq(socialDraft.status, "ready"))
        );

      if (drafts.length === 0) {
        return reply
          .status(400)
          .send({ error: "No ready draft found for this run" });
      }

      const draft = drafts[0];
      const now = new Date().toISOString();

      // Create rejection record
      await fastify.db.insert(socialApproval).values({
        id: uuidv4(),
        draft_id: draft.id,
        run_id: id,
        reviewer,
        decision: "rejected",
        comments: notes,
        revision_notes: "",
        reviewed_at: now,
      });

      // Update draft status
      await fastify.db
        .update(socialDraft)
        .set({ status: "rejected", updated_at: now })
        .where(eq(socialDraft.id, draft.id));

      // Fail the approve stage
      const approveStages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(
          and(
            eq(socialRunStage.run_id, id),
            eq(socialRunStage.stage_name, "approve")
          )
        )
        .limit(1);

      if (approveStages.length > 0) {
        await fastify.db
          .update(socialRunStage)
          .set({
            status: "failed",
            completed_at: now,
            error_message: `Rejected by ${reviewer}: ${notes}`,
            output_data: JSON.stringify({
              decision: "rejected",
              reviewer,
              notes,
            }),
          })
          .where(eq(socialRunStage.id, approveStages[0].id));
      }

      // Update run status to failed
      await fastify.db
        .update(socialRun)
        .set({
          status: "failed",
          updated_at: now,
          error_message: `Rejected by ${reviewer}`,
        })
        .where(eq(socialRun.id, id));

      return reply.send({
        run_id: id,
        draft_id: draft.id,
        decision: "rejected",
        reviewer,
        notes,
        reviewed_at: now,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to reject run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/:id/request-revision ─────────────────────────────
  fastify.post(
    "/api/social/runs/:id/request-revision",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reviewer, notes, rerun_stages } = request.body as {
        reviewer: string;
        notes: string;
        rerun_stages?: string[];
      };

      if (!reviewer) {
        return reply.status(400).send({ error: "reviewer is required" });
      }
      if (!notes) {
        return reply
          .status(400)
          .send({ error: "notes are required for revision requests" });
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

        const drafts = await fastify.db
          .select()
          .from(socialDraft)
          .where(
            and(eq(socialDraft.run_id, id), eq(socialDraft.status, "ready"))
          );

        if (drafts.length === 0) {
          return reply
            .status(400)
            .send({ error: "No ready draft found for this run" });
        }

        const draft = drafts[0];
        const now = new Date().toISOString();

        // Create revision request record
        await fastify.db.insert(socialApproval).values({
          id: uuidv4(),
          draft_id: draft.id,
          run_id: id,
          reviewer,
          decision: "revision_requested",
          comments: notes,
          revision_notes: notes,
          reviewed_at: now,
        });

        // Reset draft to generating status for rework
        await fastify.db
          .update(socialDraft)
          .set({ status: "generating", updated_at: now })
          .where(eq(socialDraft.id, draft.id));

        // If specific stages should be rerun, reset them
        const stagesToRerun = rerun_stages ?? ["generate", "humanize"];
        for (const stageName of stagesToRerun) {
          const matchedStages = await fastify.db
            .select()
            .from(socialRunStage)
            .where(
              and(
                eq(socialRunStage.run_id, id),
                eq(socialRunStage.stage_name, stageName as any)
              )
            )
            .limit(1);

          if (matchedStages.length > 0) {
            await fastify.db
              .update(socialRunStage)
              .set({
                status: "pending",
                started_at: null,
                completed_at: null,
                error_message: null,
                output_data: "{}",
              })
              .where(eq(socialRunStage.id, matchedStages[0].id));
          }
        }

        // Also reset the approve stage
        const approveStages = await fastify.db
          .select()
          .from(socialRunStage)
          .where(
            and(
              eq(socialRunStage.run_id, id),
              eq(socialRunStage.stage_name, "approve")
            )
          )
          .limit(1);

        if (approveStages.length > 0) {
          await fastify.db
            .update(socialRunStage)
            .set({
              status: "pending",
              started_at: null,
              completed_at: null,
              error_message: null,
              output_data: "{}",
            })
            .where(eq(socialRunStage.id, approveStages[0].id));
        }

        // Set run back to running
        await fastify.db
          .update(socialRun)
          .set({ status: "running", updated_at: now, error_message: null })
          .where(eq(socialRun.id, id));

        return reply.send({
          run_id: id,
          draft_id: draft.id,
          decision: "revision_requested",
          reviewer,
          notes,
          rerun_stages: stagesToRerun,
          reviewed_at: now,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to request revision");
        return reply.status(500).send({ error: message });
      }
    }
  );

  done();
};

export default approvalsRoutes;
