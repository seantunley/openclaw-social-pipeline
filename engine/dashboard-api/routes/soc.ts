/**
 * Security Operations Console (SOC) — API surface.
 *
 * Read endpoints (Live, Layers, LLM Calls, Spend):
 *   GET /api/social/soc/summary       Top-line stat strip + 24h chart data
 *   GET /api/social/soc/events        Paginated security_event feed (filterable)
 *   GET /api/social/soc/events/:id    Single event drill-down (reviews + replay payload)
 *   GET /api/social/soc/llm-calls     Paginated llm_call_log feed
 *   GET /api/social/soc/spend         Active spend windows
 *   GET /api/social/soc/skills        Skill registry + recent audit
 *   GET /api/social/soc/settings      Runtime state (kill switch + caps) + bans + blocks
 *
 * Write endpoints (Settings tab + operator actions):
 *   POST /api/social/soc/settings/kill-switch
 *   POST /api/social/soc/settings/caps
 *   POST /api/social/soc/bans
 *   DELETE /api/social/soc/bans/:hash
 *   POST /api/social/soc/category-blocks
 *   DELETE /api/social/soc/category-blocks/:id
 *   POST /api/social/soc/events/:id/false-positive
 *   POST /api/social/soc/events/:id/reclassify
 *   POST /api/social/soc/events/:id/replay
 */

import type { FastifyPluginAsync } from "fastify";
import { randomUUID, createHash } from "node:crypto";
import { eq, desc, sql, and, gt } from "drizzle-orm";
import {
  securityEvent,
  securityEventReview,
  llmCallLog,
  spendWindow,
  agentRuntimeState,
  bannedInputHash,
  blockedCategory,
  agentSkill,
  agentSkillAudit,
} from "../../src/db/schema.js";
import { checkInbound } from "../../src/services/agent-defense/index.js";
import { getSqlite } from "../../src/db/index.js";

const socRoutes: FastifyPluginAsync = async (app) => {
  // ── Summary stat strip + 24h sparkline ────────────────────────────────
  app.get("/api/social/soc/summary", async () => {
    const db = app.db;
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

    const totalEventsRow = db
      .select({ n: sql<number>`count(*)` })
      .from(securityEvent)
      .where(sql`${securityEvent.created_at} >= ${dayAgo}`)
      .get();

    const blockedRow = db
      .select({ n: sql<number>`count(*)` })
      .from(securityEvent)
      .where(
        and(
          sql`${securityEvent.created_at} >= ${dayAgo}`,
          eq(securityEvent.verdict, "block"),
        ),
      )
      .get();

    const reviewRow = db
      .select({ n: sql<number>`count(*)` })
      .from(securityEvent)
      .where(
        and(
          sql`${securityEvent.created_at} >= ${dayAgo}`,
          eq(securityEvent.verdict, "review"),
        ),
      )
      .get();

    const callsRow = db
      .select({ n: sql<number>`count(*)` })
      .from(llmCallLog)
      .where(sql`${llmCallLog.created_at} >= ${dayAgo}`)
      .get();

    const spendRow = db
      .select({ s: sql<number>`coalesce(sum(cost_usd), 0)` })
      .from(llmCallLog)
      .where(sql`${llmCallLog.created_at} >= ${dayAgo}`)
      .get();

    // Hourly histogram for the sparkline. SQLite strftime gets the floor hour.
    const buckets = (getSqlite()
      .prepare(
        `SELECT strftime('%Y-%m-%dT%H', created_at) AS hour,
                count(*) AS total,
                sum(CASE verdict WHEN 'block' THEN 1 ELSE 0 END) AS blocks,
                sum(CASE verdict WHEN 'review' THEN 1 ELSE 0 END) AS reviews
           FROM security_event
          WHERE created_at >= ?
          GROUP BY hour
          ORDER BY hour`,
      )
      .all(dayAgo) as Array<{ hour: string; total: number; blocks: number; reviews: number }>).map(
      (r) => ({ hour: `${r.hour}:00`, total: r.total, blocks: r.blocks, reviews: r.reviews }),
    );

    const kill = db
      .select()
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.key, "kill_switch"))
      .get() as { value: string } | undefined;

    return {
      eventsLast24h: totalEventsRow?.n ?? 0,
      blocksLast24h: blockedRow?.n ?? 0,
      reviewsLast24h: reviewRow?.n ?? 0,
      llmCallsLast24h: callsRow?.n ?? 0,
      spendLast24hUsd: Number(spendRow?.s ?? 0),
      hourlyBuckets: buckets,
      killSwitch: (kill?.value ?? "off") === "on",
    };
  });

  // ── Event feed ────────────────────────────────────────────────────────
  app.get("/api/social/soc/events", async (req) => {
    const q = req.query as {
      limit?: string;
      offset?: string;
      verdict?: string;
      severity?: string;
      source?: string;
      direction?: string;
      since?: string;
    };
    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
    const offset = Math.max(Number(q.offset ?? 0), 0);

    const where: any[] = [];
    if (q.verdict) where.push(eq(securityEvent.verdict, q.verdict as any));
    if (q.severity) where.push(eq(securityEvent.severity, q.severity as any));
    if (q.source) where.push(eq(securityEvent.input_source, q.source as any));
    if (q.direction) where.push(eq(securityEvent.direction, q.direction as any));
    if (q.since) where.push(sql`${securityEvent.created_at} >= ${q.since}`);

    const db = app.db;
    const baseQuery = db.select().from(securityEvent);
    const filtered = where.length > 0 ? baseQuery.where(and(...where)) : baseQuery;
    const rows = filtered
      .orderBy(desc(securityEvent.created_at))
      .limit(limit)
      .offset(offset)
      .all();

    return { items: rows, limit, offset };
  });

  // ── Single event drill-down ───────────────────────────────────────────
  app.get("/api/social/soc/events/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = app.db
      .select()
      .from(securityEvent)
      .where(eq(securityEvent.id, id))
      .get();
    if (!event) return reply.status(404).send({ error: "event not found" });

    const reviews = app.db
      .select()
      .from(securityEventReview)
      .where(eq(securityEventReview.event_id, id))
      .orderBy(desc(securityEventReview.created_at))
      .all();

    return { event, reviews };
  });

  // ── LLM call audit feed ───────────────────────────────────────────────
  app.get("/api/social/soc/llm-calls", async (req) => {
    const q = req.query as {
      limit?: string;
      offset?: string;
      caller?: string;
      model?: string;
      errorsOnly?: string;
      since?: string;
    };
    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
    const offset = Math.max(Number(q.offset ?? 0), 0);

    const where: any[] = [];
    if (q.caller) where.push(eq(llmCallLog.caller, q.caller));
    if (q.model) where.push(eq(llmCallLog.model, q.model));
    if (q.errorsOnly === "true") where.push(sql`${llmCallLog.error} IS NOT NULL`);
    if (q.since) where.push(sql`${llmCallLog.created_at} >= ${q.since}`);

    const base = app.db.select().from(llmCallLog);
    const filtered = where.length > 0 ? base.where(and(...where)) : base;
    const rows = filtered
      .orderBy(desc(llmCallLog.created_at))
      .limit(limit)
      .offset(offset)
      .all();

    // Aggregates: per-caller cost and call count over the same filter scope.
    // For now, day-bucketed: callers summary for the last 24h regardless of filter.
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const byCaller = getSqlite()
      .prepare(
        `SELECT caller,
                count(*) AS calls,
                sum(cost_usd) AS cost,
                sum(prompt_tokens + completion_tokens) AS tokens,
                sum(CASE WHEN cached_response = 1 THEN 1 ELSE 0 END) AS cached,
                sum(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors
           FROM llm_call_log
          WHERE created_at >= ?
          GROUP BY caller
          ORDER BY cost DESC`,
      )
      .all(dayAgo);

    return { items: rows, byCallerLast24h: byCaller, limit, offset };
  });

  // ── Spend windows ─────────────────────────────────────────────────────
  app.get("/api/social/soc/spend", async () => {
    const rows = app.db.select().from(spendWindow).all();
    return { items: rows };
  });

  // ── Skills registry + recent audit ────────────────────────────────────
  app.get("/api/social/soc/skills", async () => {
    const skills = app.db.select().from(agentSkill).all();
    const recentAudit = app.db
      .select()
      .from(agentSkillAudit)
      .orderBy(desc(agentSkillAudit.created_at))
      .limit(100)
      .all();
    return { skills, recentAudit };
  });

  // ── Settings: state + bans + blocks ───────────────────────────────────
  app.get("/api/social/soc/settings", async () => {
    const state = app.db.select().from(agentRuntimeState).all();
    const bans = app.db.select().from(bannedInputHash).all();
    const now = new Date().toISOString();
    const blocks = app.db
      .select()
      .from(blockedCategory)
      .where(gt(blockedCategory.blocked_until, now))
      .all();
    return { state, bans, blocks };
  });

  // ── Mutations ─────────────────────────────────────────────────────────

  app.post("/api/social/soc/settings/kill-switch", async (req) => {
    const { on } = req.body as { on: boolean };
    upsertState("kill_switch", on ? "on" : "off");
    return { ok: true, kill_switch: on ? "on" : "off" };
  });

  app.post("/api/social/soc/settings/caps", async (req) => {
    const body = req.body as {
      spendUsdPerHour?: number | null;
      callsPerHour?: number | null;
    };
    if (body.spendUsdPerHour === null) deleteState("spend_usd_per_hour");
    else if (typeof body.spendUsdPerHour === "number")
      upsertState("spend_usd_per_hour", String(body.spendUsdPerHour));
    if (body.callsPerHour === null) deleteState("calls_per_hour");
    else if (typeof body.callsPerHour === "number")
      upsertState("calls_per_hour", String(body.callsPerHour));
    return { ok: true };
  });

  app.post("/api/social/soc/bans", async (req) => {
    const { hash, reason, expiresAt } = req.body as {
      hash: string;
      reason?: string;
      expiresAt?: string;
    };
    if (!hash) return { error: "hash required" };
    getSqlite()
      .prepare(
        `INSERT INTO banned_input_hash(hash, reason, expires_at, created_by, created_at)
         VALUES (?, ?, ?, 'operator', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(hash) DO UPDATE SET reason = excluded.reason, expires_at = excluded.expires_at`,
      )
      .run(hash, reason ?? "", expiresAt ?? null);
    return { ok: true };
  });

  app.delete("/api/social/soc/bans/:hash", async (req) => {
    const { hash } = req.params as { hash: string };
    app.db.delete(bannedInputHash).where(eq(bannedInputHash.hash, hash)).run();
    return { ok: true };
  });

  app.post("/api/social/soc/category-blocks", async (req) => {
    const { category, blockedUntil, reason } = req.body as {
      category: string;
      blockedUntil: string;
      reason?: string;
    };
    if (!category || !blockedUntil) return { error: "category and blockedUntil required" };
    app.db
      .insert(blockedCategory)
      .values({
        id: randomUUID(),
        category,
        blocked_until: blockedUntil,
        reason: reason ?? "",
      })
      .run();
    return { ok: true };
  });

  app.delete("/api/social/soc/category-blocks/:id", async (req) => {
    const { id } = req.params as { id: string };
    app.db.delete(blockedCategory).where(eq(blockedCategory.id, id)).run();
    return { ok: true };
  });

  // Mark false positive / unmark / reclassify severity / replay
  app.post("/api/social/soc/events/:id/false-positive", async (req) => {
    const { id } = req.params as { id: string };
    const { unmark, note } = (req.body ?? {}) as { unmark?: boolean; note?: string };
    app.db
      .insert(securityEventReview)
      .values({
        id: randomUUID(),
        event_id: id,
        action: unmark ? "unmark_false_positive" : "mark_false_positive",
        note: note ?? "",
      })
      .run();
    return { ok: true };
  });

  app.post("/api/social/soc/events/:id/reclassify", async (req) => {
    const { id } = req.params as { id: string };
    const { severity, note } = req.body as {
      severity: "low" | "medium" | "high" | "critical";
      note?: string;
    };
    if (!["low", "medium", "high", "critical"].includes(severity)) {
      return { error: "invalid severity" };
    }
    app.db
      .insert(securityEventReview)
      .values({
        id: randomUUID(),
        event_id: id,
        action: "reclassify_severity",
        new_severity: severity,
        note: note ?? "",
      })
      .run();
    return { ok: true };
  });

  /**
   * Replay — re-run checkInbound() on the stored full_input. A new
   * security_event is created so the operator can compare verdicts (this is
   * good for "did the defenses change, would they catch this now?").
   */
  app.post("/api/social/soc/events/:id/replay", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ev = app.db
      .select()
      .from(securityEvent)
      .where(eq(securityEvent.id, id))
      .get();
    if (!ev) return reply.status(404).send({ error: "event not found" });
    if (!ev.full_input) {
      return reply
        .status(400)
        .send({ error: "no full_input stored; replay not possible for this event" });
    }
    if (ev.direction !== "inbound") {
      return reply
        .status(400)
        .send({ error: "replay only supported for inbound events" });
    }
    const out = await checkInbound(ev.full_input, (ev.input_source ?? "chat") as any, {
      skipFrontier: false,
    });
    return {
      ok: true,
      original: { verdict: ev.verdict, severity: ev.severity, securityEventId: ev.id },
      replayed: {
        verdict: out.verdict,
        severity: out.severity,
        securityEventId: out.securityEventId,
      },
    };
  });

  // ── Helpers ───────────────────────────────────────────────────────────
  function upsertState(key: string, value: string): void {
    getSqlite()
      .prepare(
        `INSERT INTO agent_runtime_state(key, value, updated_at, updated_by)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'operator')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                         updated_at = excluded.updated_at`,
      )
      .run(key, value);
  }

  function deleteState(key: string): void {
    app.db.delete(agentRuntimeState).where(eq(agentRuntimeState.key, key)).run();
  }
};

export default socRoutes;
