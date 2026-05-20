import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
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
import brandRoutes from "./routes/brand.js";
import authRoutes from "./routes/auth.js";
import importRoutes from "./routes/import.js";
import socRoutes from "./routes/soc.js";
import agentRoutes from "./routes/agent.js";
import schedulesRoutes from "./routes/schedules.js";

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

  // ── Multipart (used by Settings → Import) ───────────────────────────────────
  // Platform exports can be large — Twitter archives ship at 50–200 MB and
  // even single tweets.js files are commonly 30+ MB. 256 MB cap covers
  // realistic uploads while still bounding memory if a corrupt request
  // streams forever.
  await fastify.register(multipart, {
    limits: {
      fileSize: 256 * 1024 * 1024,
      files: 1,
    },
  });

  // ── Database ────────────────────────────────────────────────────────────────
  // Route through the engine's initDb() so the API and the bot share one
  // schema source. Adding a CREATE TABLE to db/index.ts will now apply on
  // the next API restart instead of silently 500'ing on missing tables.
  const { initDb } = await import("../src/db/index.js");
  const db = initDb({ dbPath: DB_PATH });

  fastify.decorate("db", db);

  // ── Approval repair ─────────────────────────────────────────────────────────
  // Earlier the approve endpoint flipped run.status to 'running' instead of
  // 'approved'. That left approved runs stuck — they couldn't be scheduled
  // and the watchdog below would mark them failed. Repair: any run whose
  // draft is approved is conceptually 'approved' regardless of run.status.
  try {
    const repaired = db.$client
      .prepare(
        `UPDATE social_run
         SET status = 'approved', updated_at = ?
         WHERE status IN ('running', 'failed')
           AND id IN (SELECT run_id FROM social_draft WHERE status = 'approved')`,
      )
      .run(new Date().toISOString());
    if (repaired.changes > 0) {
      fastify.log.warn({ count: repaired.changes }, "[repair] reconciled approved-draft runs back to status=approved");
    }
  } catch (err) {
    fastify.log.error({ err }, "[repair] approval repair failed");
  }

  // ── Zombie watchdog ─────────────────────────────────────────────────────────
  // Any run still in 'running' or 'pending' state when the API process
  // restarts is orphaned — its in-memory pipeline died with the previous
  // process and there's no worker to resume it. Mark them failed with a
  // clear error so the operator knows to re-trigger, instead of leaving
  // them silently stuck on the dashboard.
  // Also catches stages that have been 'running' way too long even within
  // a single process (e.g. fal.subscribe hanging past our timeout).
  try {
    // Any 'running' row at startup is orphaned by definition: the pipeline
    // runs in-process, and that process was the one that just restarted.
    // No age cutoff — all of them get surfaced.
    const orphans = (db
      .select()
      .from(schema.socialRun)
      .all() as Array<{ id: string; status: string; started_at: string | null; created_at: string }>)
      .filter((r) => r.status === "running");
    if (orphans.length > 0) {
      const message = "Run was 'running' when the API process restarted. The in-memory pipeline died with the old process — re-trigger this run from the dashboard. (If you see this repeatedly, an external dependency is hanging; check provider keys and logs.)";
      const finishedAt = new Date().toISOString();
      const stmtRun = db.$client.prepare(
        `UPDATE social_run SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      );
      const stmtStage = db.$client.prepare(
        `UPDATE social_run_stage SET status = 'failed', error_message = ?, completed_at = ? WHERE run_id = ? AND status = 'running'`,
      );
      for (const o of orphans) {
        stmtRun.run(message, finishedAt, finishedAt, o.id);
        stmtStage.run(message, finishedAt, o.id);
      }
      fastify.log.warn({ count: orphans.length, ids: orphans.map((o) => o.id) }, "[watchdog] surfaced zombie runs as failed");
    }
  } catch (err) {
    fastify.log.error({ err }, "[watchdog] startup sweep failed");
  }

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
  await fastify.register(brandRoutes);
  await fastify.register(authRoutes);
  await fastify.register(importRoutes);
  await fastify.register(socRoutes);
  await fastify.register(agentRoutes);
  await fastify.register(schedulesRoutes);

  // ── Health check ────────────────────────────────────────────────────────────
  fastify.get("/api/social/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const { closeDb } = await import("../src/db/index.js");
  const shutdown = async (signal: string) => {
    fastify.log.info(`Received ${signal}, shutting down gracefully...`);
    await fastify.close();
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // ── Smart scheduler worker ──────────────────────────────────────────────────
  // Polls social_run for due scheduled rows and fires the pipeline.
  const { startScheduler } = await import("../src/services/scheduler/index.js");
  const stopScheduler = startScheduler(db, {
    info: (...args: unknown[]) => fastify.log.info(args[0] as object, args[1] as string),
    error: (...args: unknown[]) => fastify.log.error(args[0] as object, args[1] as string),
  });
  process.on("SIGINT", stopScheduler);
  process.on("SIGTERM", stopScheduler);

  // ── Recurring scheduler worker ──────────────────────────────────────────────
  // Polls social_schedule for due rows and fires the bound action via the
  // dispatcher. Separate from the smart scheduler above so each can poll
  // at its own cadence without contention.
  const { startRecurringScheduler } = await import(
    "../src/services/scheduler/recurring.js"
  );
  const stopRecurringScheduler = startRecurringScheduler(db, {
    info: (...args: unknown[]) =>
      fastify.log.info(args[0] as object, args[1] as string),
    error: (...args: unknown[]) =>
      fastify.log.error(args[0] as object, args[1] as string),
    warn: (...args: unknown[]) =>
      fastify.log.warn(args[0] as object, args[1] as string),
  });
  process.on("SIGINT", stopRecurringScheduler);
  process.on("SIGTERM", stopRecurringScheduler);

  // ── Memory maintenance worker ──────────────────────────────────────────────
  // Runs extractor + embedder + summarizer + reflector against the agent's
  // backlog tables. Cheap when there's nothing to do. See the original brief's
  // "Write path per turn" — cron rollup of the day's messages.
  const { startMemoryWorker } = await import("../src/services/agent/memory-worker.js");
  const stopMemoryWorker = startMemoryWorker(db as never, {
    info: (...args: unknown[]) => fastify.log.info(args[0] as object, args[1] as string),
    error: (...args: unknown[]) => fastify.log.error(args[0] as object, args[1] as string),
  });
  process.on("SIGINT", stopMemoryWorker);
  process.on("SIGTERM", stopMemoryWorker);

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
