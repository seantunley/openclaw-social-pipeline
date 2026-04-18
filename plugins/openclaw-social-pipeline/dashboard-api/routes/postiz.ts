import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  socialRun,
  socialDraft,
  socialMediaAsset,
  socialPublishRecord,
  socialAnalyticsSnapshot,
} from "../../src/db/schema.js";

const postizRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── GET /api/social/postiz/auth-status ──────────────────────────────────────
  fastify.get("/api/social/postiz/auth-status", async (_request, reply) => {
    try {
      const status = await fastify.postiz.authStatus();
      return reply.send(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to get Postiz auth status");
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /api/social/postiz/integrations ─────────────────────────────────────
  fastify.get("/api/social/postiz/integrations", async (_request, reply) => {
    try {
      const integrations = await fastify.postiz.listIntegrations();
      return reply.send(integrations);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to list Postiz integrations");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/:id/postiz/upload ─────────────────────────────────
  fastify.post(
    "/api/social/runs/:id/postiz/upload",
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

        // Find all hosted media assets for this run's drafts
        const drafts = await fastify.db
          .select()
          .from(socialDraft)
          .where(eq(socialDraft.run_id, id));

        if (drafts.length === 0) {
          return reply
            .status(400)
            .send({ error: "No drafts found for this run" });
        }

        const uploadedMedia = [];

        for (const draft of drafts) {
          const assets = await fastify.db
            .select()
            .from(socialMediaAsset)
            .where(
              and(
                eq(socialMediaAsset.draft_id, draft.id),
                eq(socialMediaAsset.status, "hosted")
              )
            );

          for (const asset of assets) {
            if (!asset.hosted_url) continue;

            try {
              const uploaded = await fastify.postiz.uploadMedia({
                file_path: asset.hosted_url,
                filename: `${asset.id}.${asset.mime_type?.split("/")[1] ?? "png"}`,
              });

              // Update asset metadata with Postiz media ID
              const meta = JSON.parse(asset.metadata);
              meta.postiz_media_id = uploaded.id;
              meta.postiz_media_url = uploaded.url;

              await fastify.db
                .update(socialMediaAsset)
                .set({ metadata: JSON.stringify(meta) })
                .where(eq(socialMediaAsset.id, asset.id));

              uploadedMedia.push({
                asset_id: asset.id,
                postiz_media_id: uploaded.id,
                postiz_media_url: uploaded.url,
              });
            } catch (uploadErr) {
              const uploadMsg =
                uploadErr instanceof Error
                  ? uploadErr.message
                  : "Upload failed";
              fastify.log.warn(
                { asset_id: asset.id, err: uploadErr },
                "Failed to upload asset to Postiz"
              );
              uploadedMedia.push({
                asset_id: asset.id,
                error: uploadMsg,
              });
            }
          }
        }

        return reply.send({
          run_id: id,
          uploaded: uploadedMedia,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to upload to Postiz");
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── POST /api/social/runs/:id/postiz/create-post ────────────────────────────
  fastify.post(
    "/api/social/runs/:id/postiz/create-post",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { integration_id, content } = request.body as {
        integration_id: string;
        content?: string;
      };

      if (!integration_id) {
        return reply
          .status(400)
          .send({ error: "integration_id is required" });
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

        // Get the approved/ready draft
        const drafts = await fastify.db
          .select()
          .from(socialDraft)
          .where(
            and(
              eq(socialDraft.run_id, id),
              eq(socialDraft.status, "approved")
            )
          )
          .limit(1);

        if (drafts.length === 0) {
          return reply
            .status(400)
            .send({ error: "No approved draft found for this run" });
        }

        const draft = drafts[0];
        const postContent =
          content ?? draft.final_content || draft.humanized_content || draft.raw_content;

        // Collect Postiz media IDs from assets
        const assets = await fastify.db
          .select()
          .from(socialMediaAsset)
          .where(eq(socialMediaAsset.draft_id, draft.id));

        const mediaIds: string[] = [];
        for (const asset of assets) {
          const meta = JSON.parse(asset.metadata);
          if (meta.postiz_media_id) {
            mediaIds.push(meta.postiz_media_id);
          }
        }

        const postRecord = await fastify.postiz.createPost({
          integration_id,
          content: postContent,
          media_ids: mediaIds.length > 0 ? mediaIds : undefined,
        });

        const now = new Date().toISOString();

        // Create a publish record
        await fastify.db.insert(socialPublishRecord).values({
          id: uuidv4(),
          draft_id: draft.id,
          run_id: id,
          platform: draft.platform,
          status: "publishing",
          postiz_post_id: postRecord.id,
          postiz_integration_id: integration_id,
          metadata: JSON.stringify({ media_ids: mediaIds }),
          created_at: now,
          updated_at: now,
        });

        // Update draft status
        await fastify.db
          .update(socialDraft)
          .set({ status: "published", updated_at: now })
          .where(eq(socialDraft.id, draft.id));

        return reply.send({
          run_id: id,
          draft_id: draft.id,
          postiz_post_id: postRecord.id,
          status: postRecord.status,
          content: postContent,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to create Postiz post");
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── POST /api/social/runs/:id/postiz/schedule ──────────────────────────────
  fastify.post(
    "/api/social/runs/:id/postiz/schedule",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { scheduled_for } = request.body as { scheduled_for: string };

      if (!scheduled_for) {
        return reply
          .status(400)
          .send({ error: "scheduled_for is required (ISO 8601 datetime)" });
      }

      try {
        // Find the publish record for this run
        const publishRecords = await fastify.db
          .select()
          .from(socialPublishRecord)
          .where(eq(socialPublishRecord.run_id, id))
          .limit(1);

        if (publishRecords.length === 0) {
          return reply.status(404).send({
            error: `No publish record found for run ${id}. Create a post first.`,
          });
        }

        const record = publishRecords[0];

        if (!record.postiz_post_id) {
          return reply.status(400).send({
            error: "No Postiz post ID associated with this publish record",
          });
        }

        const result = await fastify.postiz.schedulePost({
          post_id: record.postiz_post_id,
          scheduled_for,
        });

        const now = new Date().toISOString();

        await fastify.db
          .update(socialPublishRecord)
          .set({
            status: "scheduled",
            scheduled_at: scheduled_for,
            updated_at: now,
          })
          .where(eq(socialPublishRecord.id, record.id));

        return reply.send({
          run_id: id,
          postiz_post_id: record.postiz_post_id,
          scheduled_for,
          status: "scheduled",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to schedule Postiz post");
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── GET /api/social/runs/:id/postiz/analytics ───────────────────────────────
  fastify.get(
    "/api/social/runs/:id/postiz/analytics",
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const publishRecords = await fastify.db
          .select()
          .from(socialPublishRecord)
          .where(eq(socialPublishRecord.run_id, id));

        if (publishRecords.length === 0) {
          return reply.status(404).send({
            error: `No publish records found for run ${id}`,
          });
        }

        const analyticsResults = [];

        for (const record of publishRecords) {
          if (!record.postiz_post_id) continue;

          try {
            const analytics = await fastify.postiz.getPostAnalytics(
              record.postiz_post_id
            );

            // Store a snapshot
            const now = new Date().toISOString();
            await fastify.db.insert(socialAnalyticsSnapshot).values({
              id: uuidv4(),
              publish_record_id: record.id,
              draft_id: record.draft_id,
              platform: record.platform,
              snapshot_at: now,
              impressions: analytics.impressions,
              clicks: analytics.clicks,
              likes: analytics.likes,
              shares: analytics.shares,
              comments: analytics.comments,
              engagement_rate: analytics.engagement_rate,
              raw_data: JSON.stringify(analytics),
            });

            analyticsResults.push({
              publish_record_id: record.id,
              platform: record.platform,
              postiz_post_id: record.postiz_post_id,
              analytics,
            });
          } catch (analyticsErr) {
            const analyticsMsg =
              analyticsErr instanceof Error
                ? analyticsErr.message
                : "Analytics fetch failed";
            analyticsResults.push({
              publish_record_id: record.id,
              platform: record.platform,
              postiz_post_id: record.postiz_post_id,
              error: analyticsMsg,
            });
          }
        }

        return reply.send({
          run_id: id,
          analytics: analyticsResults,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to get Postiz analytics");
        return reply.status(500).send({ error: message });
      }
    }
  );

  done();
};

export default postizRoutes;
