import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, desc, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { socialResearch, socialRun } from "../../src/db/schema.js";

const researchRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── GET /api/social/research ───────────────────────────────────────────────
  fastify.get("/api/social/research", async (request, reply) => {
    try {
      const { status, campaign_id, topic, limit = 50, offset = 0 } =
        request.query as {
          status?: string;
          campaign_id?: string;
          topic?: string;
          limit?: number;
          offset?: number;
        };

      const conditions = [];
      if (status) conditions.push(eq(socialResearch.status, status as any));
      if (campaign_id) conditions.push(eq(socialResearch.campaign_id, campaign_id));
      if (topic) conditions.push(eq(socialResearch.topic, topic));

      const query = fastify.db
        .select()
        .from(socialResearch)
        .orderBy(desc(socialResearch.researched_at))
        .limit(Number(limit))
        .offset(Number(offset));

      const rows = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      const parsed = rows.map((r) => ({
        ...r,
        platforms: JSON.parse(r.platforms),
        sources: JSON.parse(r.sources),
        tags: JSON.parse(r.tags),
        research_data: JSON.parse(r.research_data),
      }));

      return reply.send(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to list research");
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /api/social/research/:id ───────────────────────────────────────────
  fastify.get("/api/social/research/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const rows = await fastify.db
        .select()
        .from(socialResearch)
        .where(eq(socialResearch.id, id))
        .limit(1);

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Research item not found" });
      }

      const r = rows[0];
      return reply.send({
        ...r,
        platforms: JSON.parse(r.platforms),
        sources: JSON.parse(r.sources),
        tags: JSON.parse(r.tags),
        research_data: JSON.parse(r.research_data),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/research ──────────────────────────────────────────────
  // Manually add a research item (or called by pipeline after research stage)
  fastify.post("/api/social/research", async (request, reply) => {
    try {
      const body = request.body as any;
      const id = uuidv4();
      const now = new Date().toISOString();

      await fastify.db.insert(socialResearch).values({
        id,
        run_id: body.run_id ?? null,
        campaign_id: body.campaign_id ?? null,
        topic: body.topic ?? "Untitled Research",
        title: body.title ?? "",
        brief: body.brief ?? "",
        angle: body.angle ?? "",
        why_now: body.why_now ?? "",
        platforms: JSON.stringify(body.platforms ?? []),
        sources: JSON.stringify(body.sources ?? []),
        source_summary: body.source_summary ?? "",
        tags: JSON.stringify(body.tags ?? []),
        content_type: body.content_type ?? "research",
        suggested_format: body.suggested_format ?? "",
        status: "pending",
        research_data: JSON.stringify(body.research_data ?? {}),
        researched_at: now,
        created_at: now,
        updated_at: now,
      });

      const created = await fastify.db
        .select()
        .from(socialResearch)
        .where(eq(socialResearch.id, id))
        .limit(1);

      return reply.status(201).send({
        ...created[0],
        platforms: JSON.parse(created[0].platforms),
        sources: JSON.parse(created[0].sources),
        tags: JSON.parse(created[0].tags),
        research_data: JSON.parse(created[0].research_data),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  // ── PATCH /api/social/research/:id ─────────────────────────────────────────
  // Update status (approve, reject, archive)
  fastify.patch("/api/social/research/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const now = new Date().toISOString();

      const existing = await fastify.db
        .select()
        .from(socialResearch)
        .where(eq(socialResearch.id, id))
        .limit(1);

      if (existing.length === 0) {
        return reply.status(404).send({ error: "Research item not found" });
      }

      const updates: Record<string, any> = { updated_at: now };
      if (body.status) updates.status = body.status;
      if (body.title) updates.title = body.title;
      if (body.brief) updates.brief = body.brief;
      if (body.angle) updates.angle = body.angle;

      await fastify.db
        .update(socialResearch)
        .set(updates)
        .where(eq(socialResearch.id, id));

      const updated = await fastify.db
        .select()
        .from(socialResearch)
        .where(eq(socialResearch.id, id))
        .limit(1);

      return reply.send({
        ...updated[0],
        platforms: JSON.parse(updated[0].platforms),
        sources: JSON.parse(updated[0].sources),
        tags: JSON.parse(updated[0].tags),
        research_data: JSON.parse(updated[0].research_data),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/research/:id/promote ──────────────────────────────────
  // Promote a research finding to a new content run
  fastify.post("/api/social/research/:id/promote", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { platform?: string; campaign_id?: string };

      const rows = await fastify.db
        .select()
        .from(socialResearch)
        .where(eq(socialResearch.id, id))
        .limit(1);

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Research item not found" });
      }

      const research = rows[0];
      const platforms = JSON.parse(research.platforms);
      const platform = body.platform ?? platforms[0] ?? "linkedin";
      const now = new Date().toISOString();

      // Create a content run from this research
      const runId = uuidv4();
      await fastify.db.insert(socialRun).values({
        id: runId,
        campaign_id: body.campaign_id ?? research.campaign_id ?? null,
        platform,
        status: "queued",
        trigger: "promoted_research",
        config_snapshot: JSON.stringify({
          platform,
          brief: {
            topic: research.topic,
            title: research.title,
            brief: research.brief,
            angle: research.angle,
            why_now: research.why_now,
            sources: JSON.parse(research.sources),
            source_summary: research.source_summary,
            suggested_format: research.suggested_format,
            research_id: research.id,
          },
          media_mode: "image",
        }),
        created_at: now,
        updated_at: now,
      });

      // Update research status
      await fastify.db
        .update(socialResearch)
        .set({ status: "promoted", promoted_run_id: runId, updated_at: now })
        .where(eq(socialResearch.id, id));

      return reply.send({
        success: true,
        research_id: id,
        run_id: runId,
        platform,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  // ── DELETE /api/social/research/:id ────────────────────────────────────────
  fastify.delete("/api/social/research/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await fastify.db
        .delete(socialResearch)
        .where(eq(socialResearch.id, id));
      return reply.send({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  done();
};

export default researchRoutes;
