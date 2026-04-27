import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq } from "drizzle-orm";
import { socialConfig } from "../../src/db/schema.js";
import {
  socialPipelineConfigSchema,
  type SocialPipelineConfig,
} from "../../src/schemas/config.schema.js";

const CONFIG_KEY = "social_pipeline_config";

async function loadConfig(
  db: FastifyInstance["db"]
): Promise<SocialPipelineConfig> {
  const rows = await db
    .select()
    .from(socialConfig)
    .where(eq(socialConfig.key, CONFIG_KEY))
    .limit(1);

  if (rows.length === 0) {
    // Return defaults
    return socialPipelineConfigSchema.parse({});
  }

  const raw = JSON.parse(rows[0].value);
  return socialPipelineConfigSchema.parse(raw);
}

async function saveConfig(
  db: FastifyInstance["db"],
  config: SocialPipelineConfig
): Promise<void> {
  const now = new Date().toISOString();
  const serialized = JSON.stringify(config);

  const existing = await db
    .select()
    .from(socialConfig)
    .where(eq(socialConfig.key, CONFIG_KEY))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(socialConfig).values({
      key: CONFIG_KEY,
      value: serialized,
      updated_at: now,
    });
  } else {
    await db
      .update(socialConfig)
      .set({ value: serialized, updated_at: now })
      .where(eq(socialConfig.key, CONFIG_KEY));
  }
}

const configRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── GET /api/social/config ──────────────────────────────────────────────────
  fastify.get("/api/social/config", async (_request, reply) => {
    try {
      const config = await loadConfig(fastify.db);
      return reply.send(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to load config");
      return reply.status(500).send({ error: message });
    }
  });

  // ── PUT /api/social/config ──────────────────────────────────────────────────
  fastify.put("/api/social/config", async (request, reply) => {
    const updates = request.body as Partial<SocialPipelineConfig>;

    if (!updates || typeof updates !== "object") {
      return reply
        .status(400)
        .send({ error: "Request body must be a config object" });
    }

    try {
      // Load existing config
      const current = await loadConfig(fastify.db);

      // Deep merge the updates into the current config
      const merged = deepMerge(current, updates) as SocialPipelineConfig;

      // Validate the merged config
      const validated = socialPipelineConfigSchema.parse(merged);

      // Save
      await saveConfig(fastify.db, validated);

      return reply.send(validated);
    } catch (err) {
      if (err instanceof Error && err.name === "ZodError") {
        return reply.status(400).send({ error: "Invalid config", details: err });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to update config");
      return reply.status(500).send({ error: message });
    }
  });

  done();
};

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];

    if (
      sourceVal &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

export default configRoutes;
