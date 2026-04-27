import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, isNull, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { socialBrandProfile } from "../../src/db/schema.js";

const LIST_FIELDS = [
  "banned_words",
  "required_phrases",
  "signature_phrases",
  "target_keywords",
  "target_hashtags",
  "audience_pain_points",
  "audience_aspirations",
] as const;

type ListField = (typeof LIST_FIELDS)[number];

function deserialise(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const f of LIST_FIELDS) {
    const raw = row[f];
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        out[f] = Array.isArray(parsed) ? parsed : [];
      } catch {
        out[f] = [];
      }
    }
  }
  return out;
}

function serialiseInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const stringFields = [
    "name",
    "description",
    "audience",
    "tone",
    "voice",
    "writing_guidelines",
    "archetype",
    "primary_color",
    "secondary_color",
    "accent_color",
    "logo_url",
    "mission",
  ];
  for (const f of stringFields) {
    if (typeof input[f] === "string") out[f] = input[f];
  }
  for (const f of LIST_FIELDS) {
    const v = input[f];
    if (Array.isArray(v)) {
      out[f] = JSON.stringify(v.filter((x: unknown) => typeof x === "string"));
    } else if (typeof v === "string") {
      // Allow comma-separated input for convenience.
      const list = v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      out[f] = JSON.stringify(list);
    }
  }
  return out;
}

const brandRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done,
) => {
  // ── GET /api/social/brand-profile ───────────────────────────────────────────
  // Workspace-default profile (campaign_id IS NULL). Returns the row or
  // an empty placeholder if none exists.
  fastify.get("/api/social/brand-profile", async (_request, reply) => {
    try {
      const rows = await fastify.db
        .select()
        .from(socialBrandProfile)
        .where(isNull(socialBrandProfile.campaign_id))
        .limit(1);
      if (rows.length === 0) {
        return reply.send({ profile: null });
      }
      return reply.send({ profile: deserialise(rows[0] as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to load default brand profile");
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /api/social/brand-profile/:campaignId ───────────────────────────────
  fastify.get("/api/social/brand-profile/:campaignId", async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    try {
      const rows = await fastify.db
        .select()
        .from(socialBrandProfile)
        .where(eq(socialBrandProfile.campaign_id, campaignId))
        .limit(1);
      if (rows.length === 0) {
        return reply.send({ profile: null });
      }
      return reply.send({ profile: deserialise(rows[0] as Record<string, unknown>) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to load brand profile");
      return reply.status(500).send({ error: message });
    }
  });

  // ── PUT /api/social/brand-profile (workspace default) ───────────────────────
  fastify.put("/api/social/brand-profile", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      const existing = await fastify.db
        .select()
        .from(socialBrandProfile)
        .where(isNull(socialBrandProfile.campaign_id))
        .limit(1);
      const now = new Date().toISOString();
      const data = { ...serialiseInput(body), updated_at: now };

      if (existing.length === 0) {
        const id = uuidv4();
        await fastify.db.insert(socialBrandProfile).values({
          id,
          campaign_id: null,
          ...data,
        } as Parameters<typeof fastify.db.insert>[0] extends never ? never : never);
      } else {
        await fastify.db
          .update(socialBrandProfile)
          .set(data)
          .where(eq(socialBrandProfile.id, existing[0].id));
      }
      const final = await fastify.db
        .select()
        .from(socialBrandProfile)
        .where(isNull(socialBrandProfile.campaign_id))
        .limit(1);
      return reply.send({
        ok: true,
        profile: deserialise(final[0] as Record<string, unknown>),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to save default brand profile");
      return reply.status(500).send({ error: message });
    }
  });

  // ── PUT /api/social/brand-profile/:campaignId ───────────────────────────────
  fastify.put("/api/social/brand-profile/:campaignId", async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      const existing = await fastify.db
        .select()
        .from(socialBrandProfile)
        .where(eq(socialBrandProfile.campaign_id, campaignId))
        .limit(1);
      const now = new Date().toISOString();
      const data = { ...serialiseInput(body), updated_at: now };

      if (existing.length === 0) {
        const id = uuidv4();
        await fastify.db.insert(socialBrandProfile).values({
          id,
          campaign_id: campaignId,
          ...data,
        } as Parameters<typeof fastify.db.insert>[0] extends never ? never : never);
      } else {
        await fastify.db
          .update(socialBrandProfile)
          .set(data)
          .where(
            and(
              eq(socialBrandProfile.campaign_id, campaignId),
              eq(socialBrandProfile.id, existing[0].id),
            ),
          );
      }
      const final = await fastify.db
        .select()
        .from(socialBrandProfile)
        .where(eq(socialBrandProfile.campaign_id, campaignId))
        .limit(1);
      return reply.send({
        ok: true,
        profile: deserialise(final[0] as Record<string, unknown>),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to save brand profile");
      return reply.status(500).send({ error: message });
    }
  });

  done();
};

export default brandRoutes;
