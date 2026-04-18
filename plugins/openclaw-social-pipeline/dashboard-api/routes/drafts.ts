import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  socialRun,
  socialRunStage,
  socialDraft,
  socialMediaAsset,
} from "../../src/db/schema.js";

const draftsRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── POST /api/social/runs/:id/regenerate-draft ──────────────────────────────
  fastify.post(
    "/api/social/runs/:id/regenerate-draft",
    async (request, reply) => {
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

        const now = new Date().toISOString();

        // Reset the generate stage to pending so the pipeline re-runs it
        const generateStages = await fastify.db
          .select()
          .from(socialRunStage)
          .where(
            and(
              eq(socialRunStage.run_id, id),
              eq(socialRunStage.stage_name, "generate")
            )
          )
          .limit(1);

        if (generateStages.length === 0) {
          return reply
            .status(404)
            .send({ error: "Generate stage not found for this run" });
        }

        await fastify.db
          .update(socialRunStage)
          .set({
            status: "pending",
            attempts: generateStages[0].attempts + 1,
            started_at: null,
            completed_at: null,
            error_message: null,
            output_data: "{}",
          })
          .where(eq(socialRunStage.id, generateStages[0].id));

        // Also reset downstream stages (humanize, psychology, approve)
        const downstreamStages = ["humanize", "psychology", "approve"] as const;
        for (const stageName of downstreamStages) {
          const matched = await fastify.db
            .select()
            .from(socialRunStage)
            .where(
              and(
                eq(socialRunStage.run_id, id),
                eq(socialRunStage.stage_name, stageName)
              )
            )
            .limit(1);

          if (matched.length > 0 && matched[0].status !== "pending") {
            await fastify.db
              .update(socialRunStage)
              .set({
                status: "pending",
                started_at: null,
                completed_at: null,
                error_message: null,
                output_data: "{}",
              })
              .where(eq(socialRunStage.id, matched[0].id));
          }
        }

        // Mark existing drafts as superseded by setting status to failed
        await fastify.db
          .update(socialDraft)
          .set({ status: "failed", updated_at: now })
          .where(
            and(
              eq(socialDraft.run_id, id),
              eq(socialDraft.status, "ready")
            )
          );

        // Set run to running
        await fastify.db
          .update(socialRun)
          .set({ status: "running", updated_at: now })
          .where(eq(socialRun.id, id));

        return reply.send({
          run_id: id,
          action: "regenerate_draft",
          status: "pending",
          message: "Draft regeneration initiated. Generate stage reset to pending.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to regenerate draft");
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── POST /api/social/runs/:id/regenerate-media ──────────────────────────────
  fastify.post(
    "/api/social/runs/:id/regenerate-media",
    async (request, reply) => {
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

        const now = new Date().toISOString();

        // Reset the media stage
        const mediaStages = await fastify.db
          .select()
          .from(socialRunStage)
          .where(
            and(
              eq(socialRunStage.run_id, id),
              eq(socialRunStage.stage_name, "media")
            )
          )
          .limit(1);

        if (mediaStages.length === 0) {
          return reply
            .status(404)
            .send({ error: "Media stage not found for this run" });
        }

        await fastify.db
          .update(socialRunStage)
          .set({
            status: "pending",
            attempts: mediaStages[0].attempts + 1,
            started_at: null,
            completed_at: null,
            error_message: null,
            output_data: "{}",
          })
          .where(eq(socialRunStage.id, mediaStages[0].id));

        // Mark existing media assets for this run's drafts as failed
        const drafts = await fastify.db
          .select()
          .from(socialDraft)
          .where(eq(socialDraft.run_id, id));

        for (const draft of drafts) {
          await fastify.db
            .update(socialMediaAsset)
            .set({ status: "failed" })
            .where(
              and(
                eq(socialMediaAsset.draft_id, draft.id),
                eq(socialMediaAsset.status, "hosted")
              )
            );

          // Reset draft from media_pending if needed
          if (draft.status === "media_pending") {
            await fastify.db
              .update(socialDraft)
              .set({ status: "enhancing", updated_at: now })
              .where(eq(socialDraft.id, draft.id));
          }
        }

        // Set run to running
        await fastify.db
          .update(socialRun)
          .set({ status: "running", updated_at: now })
          .where(eq(socialRun.id, id));

        return reply.send({
          run_id: id,
          action: "regenerate_media",
          status: "pending",
          message: "Media regeneration initiated. Media stage reset to pending.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to regenerate media");
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── POST /api/social/runs/:id/select-draft ─────────────────────────────────
  fastify.post(
    "/api/social/runs/:id/select-draft",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { draft_id } = request.body as { draft_id: string };

      if (!draft_id) {
        return reply.status(400).send({ error: "draft_id is required" });
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
            and(eq(socialDraft.id, draft_id), eq(socialDraft.run_id, id))
          )
          .limit(1);

        if (drafts.length === 0) {
          return reply.status(404).send({
            error: `Draft ${draft_id} not found in run ${id}`,
          });
        }

        const now = new Date().toISOString();

        // Update run config_snapshot to record the selected draft
        const currentConfig = JSON.parse(runs[0].config_snapshot);
        currentConfig.selected_draft_id = draft_id;

        await fastify.db
          .update(socialRun)
          .set({
            config_snapshot: JSON.stringify(currentConfig),
            updated_at: now,
          })
          .where(eq(socialRun.id, id));

        return reply.send({
          run_id: id,
          selected_draft_id: draft_id,
          message: "Draft selected successfully",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to select draft");
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── POST /api/social/runs/:id/select-media ─────────────────────────────────
  fastify.post(
    "/api/social/runs/:id/select-media",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { asset_id } = request.body as { asset_id: string };

      if (!asset_id) {
        return reply.status(400).send({ error: "asset_id is required" });
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

        // Verify the asset belongs to a draft in this run
        const asset = await fastify.db
          .select()
          .from(socialMediaAsset)
          .where(eq(socialMediaAsset.id, asset_id))
          .limit(1);

        if (asset.length === 0) {
          return reply
            .status(404)
            .send({ error: `Asset ${asset_id} not found` });
        }

        // Check asset's draft belongs to this run
        const draft = await fastify.db
          .select()
          .from(socialDraft)
          .where(
            and(
              eq(socialDraft.id, asset[0].draft_id),
              eq(socialDraft.run_id, id)
            )
          )
          .limit(1);

        if (draft.length === 0) {
          return reply.status(400).send({
            error: `Asset ${asset_id} does not belong to run ${id}`,
          });
        }

        const now = new Date().toISOString();

        // Update run config_snapshot to record the selected media
        const currentConfig = JSON.parse(runs[0].config_snapshot);
        currentConfig.selected_asset_id = asset_id;

        await fastify.db
          .update(socialRun)
          .set({
            config_snapshot: JSON.stringify(currentConfig),
            updated_at: now,
          })
          .where(eq(socialRun.id, id));

        return reply.send({
          run_id: id,
          selected_asset_id: asset_id,
          message: "Media asset selected successfully",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to select media");
        return reply.status(500).send({ error: message });
      }
    }
  );

  done();
};

export default draftsRoutes;
