import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  socialSchedule,
  socialScheduleFire,
} from "../../src/db/schema.js";
import {
  computeNextFire,
  describeCadence,
  validateCadence,
  type CadenceKind,
  type CadencePayload,
} from "../../src/services/scheduler/cadence.js";
import {
  dispatchScheduleAction,
  type ScheduleActionKind,
} from "../../src/services/scheduler/dispatch.js";
import { notifyFire } from "../../src/services/scheduler/notifier.js";

/**
 * Dashboard REST routes for recurring schedules. Mirrors the agent's tool
 * surface so the operator can manage schedules from either the chat or the
 * /schedules page.
 */
const schedulesRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done,
) => {
  // ── GET /api/social/schedules ──────────────────────────────────────────────
  fastify.get("/api/social/schedules", async (request, reply) => {
    const { status } = request.query as { status?: string };
    const rows = await fastify.db
      .select()
      .from(socialSchedule)
      .where(status ? eq(socialSchedule.status, status as never) : undefined as never)
      .orderBy(desc(socialSchedule.updated_at));
    const enriched = rows.map((r) => {
      let cad: CadencePayload = {};
      try {
        cad = JSON.parse(r.cadence_payload);
      } catch {
        /* keep empty */
      }
      let action: Record<string, unknown> = {};
      try {
        action = JSON.parse(r.action_payload);
      } catch {
        /* keep empty */
      }
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        status: r.status,
        cadence_kind: r.cadence_kind,
        cadence_payload: cad,
        cadence_source: r.cadence_source,
        cadence_summary: describeCadence(r.cadence_kind as CadenceKind, cad),
        action_kind: r.action_kind,
        action_payload: action,
        next_fire_at: r.next_fire_at,
        last_fire_at: r.last_fire_at,
        last_fire_status: r.last_fire_status,
        last_fire_message: r.last_fire_message,
        fire_count: r.fire_count,
        notify_chat: r.notify_chat,
        notify_telegram: r.notify_telegram,
        created_by: r.created_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
    return reply.send({ schedules: enriched, total: enriched.length });
  });

  // ── POST /api/social/schedules ─────────────────────────────────────────────
  fastify.post("/api/social/schedules", async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: string;
      description?: string;
      cadence?: CadencePayload & { kind?: CadenceKind };
      action?: { kind?: ScheduleActionKind; payload?: Record<string, unknown> };
      cadence_source?: string;
      notify_chat?: boolean;
      notify_telegram?: boolean;
    };
    if (!body.name || !body.cadence?.kind || !body.action?.kind) {
      return reply
        .status(400)
        .send({ error: "name, cadence.kind, and action.kind are required" });
    }
    try {
      validateCadence(body.cadence.kind, body.cadence);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    let nextFire: string;
    try {
      nextFire = computeNextFire(body.cadence.kind, body.cadence);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    const id = uuidv4();
    const now = new Date().toISOString();
    await fastify.db.insert(socialSchedule).values({
      id,
      name: body.name,
      description: body.description ?? "",
      status: "active" as never,
      cadence_kind: body.cadence.kind as never,
      cadence_payload: JSON.stringify(body.cadence),
      cadence_source: body.cadence_source ?? "",
      action_kind: body.action.kind as never,
      action_payload: JSON.stringify(body.action.payload ?? {}),
      next_fire_at: nextFire,
      notify_chat: body.notify_chat ?? true,
      notify_telegram: body.notify_telegram ?? false,
      fire_count: 0,
      created_by: "operator",
      created_at: now,
      updated_at: now,
    });
    return reply.send({
      ok: true,
      schedule_id: id,
      next_fire_at: nextFire,
      cadence_summary: describeCadence(body.cadence.kind, body.cadence),
    });
  });

  // ── PUT /api/social/schedules/:id ──────────────────────────────────────────
  fastify.put("/api/social/schedules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Partial<{
      name: string;
      description: string;
      cadence: CadencePayload & { kind: CadenceKind };
      action: { kind: ScheduleActionKind; payload: Record<string, unknown> };
      notify_chat: boolean;
      notify_telegram: boolean;
    }>;
    const existing = await fastify.db
      .select()
      .from(socialSchedule)
      .where(eq(socialSchedule.id, id))
      .limit(1);
    if (existing.length === 0) {
      return reply.status(404).send({ error: `Schedule ${id} not found` });
    }
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.notify_chat !== undefined) updates.notify_chat = body.notify_chat;
    if (body.notify_telegram !== undefined) {
      updates.notify_telegram = body.notify_telegram;
    }
    if (body.cadence) {
      try {
        validateCadence(body.cadence.kind, body.cadence);
        updates.cadence_kind = body.cadence.kind;
        updates.cadence_payload = JSON.stringify(body.cadence);
        updates.next_fire_at = computeNextFire(body.cadence.kind, body.cadence);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
    }
    if (body.action) {
      updates.action_kind = body.action.kind;
      updates.action_payload = JSON.stringify(body.action.payload ?? {});
    }
    await fastify.db
      .update(socialSchedule)
      .set(updates)
      .where(eq(socialSchedule.id, id));
    return reply.send({ ok: true });
  });

  // ── DELETE /api/social/schedules/:id ───────────────────────────────────────
  fastify.delete("/api/social/schedules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const r = await fastify.db
      .delete(socialSchedule)
      .where(eq(socialSchedule.id, id))
      .run();
    if ((r as { changes?: number }).changes === 0) {
      return reply.status(404).send({ error: `Schedule ${id} not found` });
    }
    return reply.send({ ok: true });
  });

  // ── POST /api/social/schedules/:id/pause ───────────────────────────────────
  fastify.post("/api/social/schedules/:id/pause", async (request, reply) => {
    const { id } = request.params as { id: string };
    const r = await fastify.db
      .update(socialSchedule)
      .set({
        status: "paused" as never,
        updated_at: new Date().toISOString(),
      })
      .where(eq(socialSchedule.id, id))
      .run();
    if ((r as { changes?: number }).changes === 0) {
      return reply.status(404).send({ error: `Schedule ${id} not found` });
    }
    return reply.send({ ok: true });
  });

  // ── POST /api/social/schedules/:id/resume ──────────────────────────────────
  fastify.post("/api/social/schedules/:id/resume", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await fastify.db
      .select()
      .from(socialSchedule)
      .where(eq(socialSchedule.id, id))
      .limit(1);
    if (row.length === 0) {
      return reply.status(404).send({ error: `Schedule ${id} not found` });
    }
    let cad: CadencePayload = {};
    try {
      cad = JSON.parse(row[0].cadence_payload);
    } catch {
      /* keep empty */
    }
    const nextFire = computeNextFire(row[0].cadence_kind as CadenceKind, cad);
    await fastify.db
      .update(socialSchedule)
      .set({
        status: "active" as never,
        next_fire_at: nextFire,
        updated_at: new Date().toISOString(),
      })
      .where(eq(socialSchedule.id, id));
    return reply.send({ ok: true, next_fire_at: nextFire });
  });

  // ── POST /api/social/schedules/:id/run-now ─────────────────────────────────
  fastify.post("/api/social/schedules/:id/run-now", async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await fastify.db
      .select()
      .from(socialSchedule)
      .where(eq(socialSchedule.id, id))
      .limit(1);
    if (rows.length === 0) {
      return reply.status(404).send({ error: `Schedule ${id} not found` });
    }
    const sched = rows[0];
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(sched.action_payload);
    } catch (err) {
      return reply
        .status(400)
        .send({ error: `action_payload malformed: ${(err as Error).message}` });
    }

    const firedAt = new Date().toISOString();
    const result = await dispatchScheduleAction(
      sched.action_kind as ScheduleActionKind,
      payload,
    );

    await fastify.db.insert(socialScheduleFire).values({
      id: uuidv4(),
      schedule_id: sched.id,
      fired_at: firedAt,
      status: result.ok ? "ok" : "failed",
      message: result.summary.slice(0, 1000),
      run_id: result.runId,
      result_payload: JSON.stringify(result.raw ?? {}),
    });

    await fastify.db
      .update(socialSchedule)
      .set({
        last_fire_at: firedAt,
        last_fire_status: result.ok ? "ok" : "failed",
        last_fire_message: result.summary.slice(0, 500),
        fire_count: sched.fire_count + 1,
        updated_at: new Date().toISOString(),
      })
      .where(eq(socialSchedule.id, sched.id));

    await notifyFire({
      scheduleId: sched.id,
      scheduleName: sched.name,
      summary: result.summary,
      ok: result.ok,
      runId: result.runId,
      notifyChat: sched.notify_chat,
      notifyTelegram: sched.notify_telegram,
    });

    return reply.send({
      ok: result.ok,
      summary: result.summary,
      run_id: result.runId,
    });
  });

  // ── GET /api/social/schedules/:id/fires ────────────────────────────────────
  fastify.get("/api/social/schedules/:id/fires", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit = 50 } = request.query as { limit?: number };
    const rows = await fastify.db
      .select()
      .from(socialScheduleFire)
      .where(eq(socialScheduleFire.schedule_id, id))
      .orderBy(desc(socialScheduleFire.fired_at))
      .limit(Number(limit));
    void and; // import retained for future filtering
    return reply.send({ fires: rows, total: rows.length });
  });

  done();
};

export default schedulesRoutes;
