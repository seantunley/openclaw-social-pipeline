import Fastify from "fastify";
import cors from "@fastify/cors";
import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import path from "node:path";

import * as schema from "../src/db/schema.js";
import { createPostizAdapter, type PostizAdapterConfig } from "../src/services/postiz/index.js";
import type { SocialPublisher } from "../src/services/postiz/types.js";

import runsRoutes from "./routes/runs.js";
import approvalsRoutes from "./routes/approvals.js";
import draftsRoutes from "./routes/drafts.js";
import postizRoutes from "./routes/postiz.js";
import configRoutes from "./routes/config.js";
import summaryRoutes from "./routes/summary.js";
import campaignsRoutes from "./routes/campaigns.js";
import { inboxRoutes } from "./routes/inbox.js";
import researchRoutes from "./routes/research.js";
import learningsRoutes from "./routes/learnings.js";

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyInstance {
    db: BetterSQLite3Database<typeof schema>;
    postiz: SocialPublisher;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.API_PORT ?? 3000);
const HOST = process.env.API_HOST ?? "0.0.0.0";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3001";

const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, "..", "data", "social-pipeline.db");

const POSTIZ_MODE = (process.env.POSTIZ_MODE ?? "api") as "cli" | "api";
const POSTIZ_API_URL = process.env.POSTIZ_API_URL ?? "http://localhost:5000";
const POSTIZ_API_KEY = process.env.POSTIZ_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  // ── CORS ────────────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
  });

  // ── Database ────────────────────────────────────────────────────────────────
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  fastify.decorate("db", db);

  // ── Postiz Adapter ──────────────────────────────────────────────────────────
  try {
    const postizConfig: PostizAdapterConfig = {
      mode: POSTIZ_MODE,
      apiBaseUrl: POSTIZ_API_URL,
      apiKey: POSTIZ_API_KEY,
    };
    const postiz = createPostizAdapter(postizConfig);
    (fastify as any).decorate("postiz", postiz);
  } catch (err) {
    fastify.log.warn("Postiz adapter init failed (missing API key?). Publishing features disabled.");
    (fastify as any).decorate("postiz", null);
  }

  // ── Routes ──────────────────────────────────────────────────────────────────
  await fastify.register(runsRoutes);
  await fastify.register(approvalsRoutes);
  await fastify.register(draftsRoutes);
  await fastify.register(postizRoutes);
  await fastify.register(configRoutes);
  await fastify.register(summaryRoutes);
  await fastify.register(campaignsRoutes);
  await fastify.register(inboxRoutes, { prefix: "/api/social/inbox" });
  await fastify.register(researchRoutes);
  await fastify.register(learningsRoutes);

  // ── Health check ────────────────────────────────────────────────────────────
  fastify.get("/api/social/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    fastify.log.info(`Received ${signal}, shutting down gracefully...`);
    await fastify.close();
    sqlite.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // ── Start ───────────────────────────────────────────────────────────────────
  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(
      `Dashboard API running at http://${HOST}:${PORT}`
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
