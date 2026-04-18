import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, desc, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { socialLearning } from "../../src/db/schema.js";

const learningsRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── GET /api/social/learnings ──────────────────────────────────────────────
  fastify.get("/api/social/learnings", async (request, reply) => {
    try {
      const { category, platform, active } = request.query as {
        category?: string;
        platform?: string;
        active?: string;
      };

      const conditions = [];
      if (category) conditions.push(eq(socialLearning.category, category as any));
      if (platform) conditions.push(eq(socialLearning.platform, platform));
      if (active !== undefined) conditions.push(eq(socialLearning.active, active !== "false"));

      const query = fastify.db
        .select()
        .from(socialLearning)
        .orderBy(desc(socialLearning.confidence))
        .limit(100);

      const rows = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      return reply.send(
        rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) }))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/learnings/rule ────────────────────────────────────────
  fastify.post("/api/social/learnings/rule", async (request, reply) => {
    try {
      const body = request.body as any;
      if (!body.category || !body.content) {
        return reply.status(400).send({ error: "category and content are required" });
      }

      const id = uuidv4();
      const now = new Date().toISOString();

      await fastify.db.insert(socialLearning).values({
        id,
        category: body.category,
        platform: body.platform || null,
        campaign_id: null,
        content: body.content,
        source_type: "operator_rule",
        source_run_id: null,
        confidence: 1.0,
        reinforcement_count: 1,
        last_reinforced_at: now,
        tags: JSON.stringify(body.tags ?? []),
        active: true,
        created_at: now,
        updated_at: now,
      });

      return reply.status(201).send({ id, confidence: 1.0, source_type: "operator_rule" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  // ── DELETE /api/social/learnings/:id ───────────────────────────────────────
  fastify.delete("/api/social/learnings/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const now = new Date().toISOString();

      await fastify.db
        .update(socialLearning)
        .set({ active: false, updated_at: now })
        .where(eq(socialLearning.id, id));

      return reply.send({ success: true, id, active: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: message });
    }
  });

  done();
};

export default learningsRoutes;
