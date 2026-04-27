import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { socialCampaign, socialRun } from "../../src/db/schema.js";

const campaignsRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── GET /api/social/campaigns ───────────────────────────────────────────────
  fastify.get("/api/social/campaigns", async (_request, reply) => {
    try {
      const campaigns = await fastify.db
        .select()
        .from(socialCampaign)
        .orderBy(desc(socialCampaign.created_at));

      return reply.send(
        campaigns.map((c) => ({
          ...c,
          target_platforms: JSON.parse(c.target_platforms),
          goals: JSON.parse(c.goals),
          tags: JSON.parse(c.tags),
        }))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to list campaigns");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/campaigns ──────────────────────────────────────────────
  fastify.post("/api/social/campaigns", async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      status?: string;
      target_platforms: string[];
      target_audience?: string;
      brand_voice_notes?: string;
      goals?: string[];
      tags?: string[];
      start_date?: string;
      end_date?: string;
    };

    if (!body.name || typeof body.name !== "string") {
      return reply
        .status(400)
        .send({ error: "name is required and must be a string" });
    }

    if (
      !Array.isArray(body.target_platforms) ||
      body.target_platforms.length === 0
    ) {
      return reply
        .status(400)
        .send({ error: "target_platforms must be a non-empty array" });
    }

    try {
      const id = uuidv4();
      const now = new Date().toISOString();

      await fastify.db.insert(socialCampaign).values({
        id,
        name: body.name,
        description: body.description ?? "",
        status: (body.status as any) ?? "draft",
        target_platforms: JSON.stringify(body.target_platforms),
        target_audience: body.target_audience ?? "",
        brand_voice_notes: body.brand_voice_notes ?? "",
        goals: JSON.stringify(body.goals ?? []),
        tags: JSON.stringify(body.tags ?? []),
        start_date: body.start_date ?? null,
        end_date: body.end_date ?? null,
        created_at: now,
        updated_at: now,
      });

      const created = await fastify.db
        .select()
        .from(socialCampaign)
        .where(eq(socialCampaign.id, id))
        .limit(1);

      return reply.status(201).send({
        ...created[0],
        target_platforms: JSON.parse(created[0].target_platforms),
        goals: JSON.parse(created[0].goals),
        tags: JSON.parse(created[0].tags),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to create campaign");
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /api/social/campaigns/:id ───────────────────────────────────────────
  fastify.get("/api/social/campaigns/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const campaigns = await fastify.db
        .select()
        .from(socialCampaign)
        .where(eq(socialCampaign.id, id))
        .limit(1);

      if (campaigns.length === 0) {
        return reply
          .status(404)
          .send({ error: `Campaign ${id} not found` });
      }

      const campaign = campaigns[0];

      // Get associated runs
      const runs = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.campaign_id, id))
        .orderBy(desc(socialRun.created_at));

      return reply.send({
        ...campaign,
        target_platforms: JSON.parse(campaign.target_platforms),
        goals: JSON.parse(campaign.goals),
        tags: JSON.parse(campaign.tags),
        runs: runs.map((r) => ({
          ...r,
          config_snapshot: JSON.parse(r.config_snapshot),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to get campaign");
      return reply.status(500).send({ error: message });
    }
  });

  // ── PUT /api/social/campaigns/:id ───────────────────────────────────────────
  fastify.put("/api/social/campaigns/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      description?: string;
      status?: string;
      target_platforms?: string[];
      target_audience?: string;
      brand_voice_notes?: string;
      goals?: string[];
      tags?: string[];
      start_date?: string | null;
      end_date?: string | null;
    };

    try {
      const existing = await fastify.db
        .select()
        .from(socialCampaign)
        .where(eq(socialCampaign.id, id))
        .limit(1);

      if (existing.length === 0) {
        return reply
          .status(404)
          .send({ error: `Campaign ${id} not found` });
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (body.name !== undefined) updates.name = body.name;
      if (body.description !== undefined) updates.description = body.description;
      if (body.status !== undefined) updates.status = body.status;
      if (body.target_platforms !== undefined)
        updates.target_platforms = JSON.stringify(body.target_platforms);
      if (body.target_audience !== undefined)
        updates.target_audience = body.target_audience;
      if (body.brand_voice_notes !== undefined)
        updates.brand_voice_notes = body.brand_voice_notes;
      if (body.goals !== undefined) updates.goals = JSON.stringify(body.goals);
      if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags);
      if (body.start_date !== undefined) updates.start_date = body.start_date;
      if (body.end_date !== undefined) updates.end_date = body.end_date;

      await fastify.db
        .update(socialCampaign)
        .set(updates)
        .where(eq(socialCampaign.id, id));

      const updated = await fastify.db
        .select()
        .from(socialCampaign)
        .where(eq(socialCampaign.id, id))
        .limit(1);

      return reply.send({
        ...updated[0],
        target_platforms: JSON.parse(updated[0].target_platforms),
        goals: JSON.parse(updated[0].goals),
        tags: JSON.parse(updated[0].tags),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to update campaign");
      return reply.status(500).send({ error: message });
    }
  });

  done();
};

export default campaignsRoutes;
