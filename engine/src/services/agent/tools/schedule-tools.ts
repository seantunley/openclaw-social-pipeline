/**
 * Schedule tools — let the agent propose, create, list, pause, resume,
 * delete, and run-now recurring schedules. Every tool returns operator-
 * actionable output so Constance can speak about the result in chat.
 *
 * Design choice: createSchedule takes structured fields, not natural
 * language. proposeSchedule parses NL → structured form and returns it
 * for the operator to confirm (typically via askOperator buttons). This
 * keeps the LLM out of the write path — the operator always sees and
 * approves the exact cadence + action before anything is persisted.
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db/index.js";
import {
  socialSchedule,
  socialScheduleFire,
} from "../../../db/schema.js";
import {
  computeNextFire,
  describeCadence,
  validateCadence,
  type CadenceKind,
  type CadencePayload,
} from "../../scheduler/cadence.js";
import {
  dispatchScheduleAction,
  type ScheduleActionKind,
} from "../../scheduler/dispatch.js";
import { notifyFire } from "../../scheduler/notifier.js";
import { llmGenerate } from "../../pipeline/llm.js";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

const cadenceSchema = z.object({
  kind: z.enum(["daily", "weekly", "monthly", "cron"]),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  day_of_week: z.array(z.number().int().min(0).max(6)).optional(),
  day_of_month: z.number().int().min(1).max(31).optional(),
  timezone: z.string().optional(),
  cron: z.string().optional(),
});

const actionSchema = z.object({
  kind: z.enum([
    "run_pipeline",
    "run_pipeline_multi",
    "research_only",
    "schedule_multi_day_campaign",
  ]),
  /** Free-form payload — shape matches the corresponding pipeline tool's input. */
  payload: z.record(z.string(), z.any()),
});

// ---------------------------------------------------------------------------
// createSchedule
// ---------------------------------------------------------------------------

export const createScheduleSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(120)
    .describe(
      "Operator-facing label, e.g. 'Monday AI research' or 'Tuesday IG carousel'.",
    ),
  description: z.string().max(500).optional(),
  cadence: cadenceSchema,
  action: actionSchema,
  cadence_source: z
    .string()
    .max(500)
    .optional()
    .describe("Operator's original natural-language phrasing if any."),
  notify_chat: z.boolean().optional(),
  notify_telegram: z.boolean().optional(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export async function createScheduleTool(
  input: CreateScheduleInput,
): Promise<{
  ok: boolean;
  schedule_id?: string;
  next_fire_at?: string;
  cadence_summary?: string;
  error?: string;
}> {
  try {
    validateCadence(input.cadence.kind, input.cadence as CadencePayload);
    const next = computeNextFire(
      input.cadence.kind,
      input.cadence as CadencePayload,
    );
    const id = uuidv4();
    const now = new Date().toISOString();
    getDb()
      .insert(socialSchedule)
      .values({
        id,
        name: input.name,
        description: input.description ?? "",
        status: "active" as never,
        cadence_kind: input.cadence.kind as never,
        cadence_payload: JSON.stringify(input.cadence),
        cadence_source: input.cadence_source ?? "",
        action_kind: input.action.kind as never,
        action_payload: JSON.stringify(input.action.payload),
        next_fire_at: next,
        notify_chat: input.notify_chat ?? true,
        notify_telegram: input.notify_telegram ?? false,
        fire_count: 0,
        created_by: "agent",
        created_at: now,
        updated_at: now,
      })
      .run();

    return {
      ok: true,
      schedule_id: id,
      next_fire_at: next,
      cadence_summary: describeCadence(
        input.cadence.kind,
        input.cadence as CadencePayload,
      ),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// listSchedules
// ---------------------------------------------------------------------------

export const listSchedulesSchema = z.object({
  status: z
    .enum(["active", "paused", "cancelled"])
    .optional()
    .describe("Filter by status."),
  limit: z.number().int().min(1).max(100).default(50),
});

export type ListSchedulesInput = z.infer<typeof listSchedulesSchema>;

export interface ScheduleSummary {
  id: string;
  name: string;
  status: string;
  cadence_summary: string;
  action_kind: string;
  action_summary: string;
  next_fire_at: string;
  last_fire_at: string | null;
  last_fire_status: string | null;
  fire_count: number;
}

export async function listSchedulesTool(
  input: ListSchedulesInput,
): Promise<{ schedules: ScheduleSummary[] }> {
  const db = getDb();
  const baseQuery = db
    .select()
    .from(socialSchedule)
    .orderBy(desc(socialSchedule.updated_at))
    .limit(input.limit);
  const rows = input.status
    ? (baseQuery
        .where(eq(socialSchedule.status, input.status as never))
        .all() as Array<{
        id: string;
        name: string;
        status: string;
        cadence_kind: string;
        cadence_payload: string;
        action_kind: string;
        action_payload: string;
        next_fire_at: string;
        last_fire_at: string | null;
        last_fire_status: string | null;
        fire_count: number;
      }>)
    : (baseQuery.all() as Array<{
        id: string;
        name: string;
        status: string;
        cadence_kind: string;
        cadence_payload: string;
        action_kind: string;
        action_payload: string;
        next_fire_at: string;
        last_fire_at: string | null;
        last_fire_status: string | null;
        fire_count: number;
      }>);

  const schedules: ScheduleSummary[] = rows.map((r) => {
    let cad: CadencePayload = {};
    try {
      cad = JSON.parse(r.cadence_payload);
    } catch {
      cad = {};
    }
    let action: Record<string, unknown> = {};
    try {
      action = JSON.parse(r.action_payload);
    } catch {
      action = {};
    }
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      cadence_summary: describeCadence(r.cadence_kind as CadenceKind, cad),
      action_kind: r.action_kind,
      action_summary: summariseAction(
        r.action_kind as ScheduleActionKind,
        action,
      ),
      next_fire_at: r.next_fire_at,
      last_fire_at: r.last_fire_at,
      last_fire_status: r.last_fire_status,
      fire_count: r.fire_count,
    };
  });

  return { schedules };
}

function summariseAction(
  kind: ScheduleActionKind,
  payload: Record<string, unknown>,
): string {
  switch (kind) {
    case "run_pipeline":
      return `run pipeline (${payload.platform ?? "?"}): "${String(payload.topic ?? "").slice(0, 60)}"`;
    case "run_pipeline_multi":
      return `multi-platform pipeline (${(payload.platforms as string[] | undefined)?.join("/") ?? "?"}): "${String(payload.topic ?? "").slice(0, 60)}"`;
    case "research_only":
      return `research only: "${String(payload.topic ?? "").slice(0, 60)}"`;
    case "schedule_multi_day_campaign":
      return `${(payload.days as unknown[] | undefined)?.length ?? "?"}-day campaign on ${payload.platform ?? "?"}: "${String(payload.topic ?? "").slice(0, 60)}"`;
    default:
      return kind;
  }
}

// ---------------------------------------------------------------------------
// pause / resume / delete / runNow
// ---------------------------------------------------------------------------

export const scheduleIdSchema = z.object({
  schedule_id: z.string().min(4).describe("Schedule id (uuid)."),
});

export type ScheduleIdInput = z.infer<typeof scheduleIdSchema>;

export async function pauseScheduleTool(
  input: ScheduleIdInput,
): Promise<{ ok: boolean; error?: string }> {
  const r = getDb()
    .update(socialSchedule)
    .set({
      status: "paused" as never,
      updated_at: new Date().toISOString(),
    })
    .where(eq(socialSchedule.id, input.schedule_id))
    .run();
  return (r as { changes?: number }).changes === 0
    ? { ok: false, error: `Schedule ${input.schedule_id} not found.` }
    : { ok: true };
}

export async function resumeScheduleTool(
  input: ScheduleIdInput,
): Promise<{ ok: boolean; next_fire_at?: string; error?: string }> {
  const db = getDb();
  const row = db
    .select()
    .from(socialSchedule)
    .where(eq(socialSchedule.id, input.schedule_id))
    .get() as
    | {
        cadence_kind: string;
        cadence_payload: string;
      }
    | undefined;
  if (!row) return { ok: false, error: `Schedule ${input.schedule_id} not found.` };

  let cad: CadencePayload = {};
  try {
    cad = JSON.parse(row.cadence_payload);
  } catch {
    cad = {};
  }
  const nextFire = computeNextFire(row.cadence_kind as CadenceKind, cad);
  db.update(socialSchedule)
    .set({
      status: "active" as never,
      next_fire_at: nextFire,
      updated_at: new Date().toISOString(),
    })
    .where(eq(socialSchedule.id, input.schedule_id))
    .run();
  return { ok: true, next_fire_at: nextFire };
}

export async function deleteScheduleTool(
  input: ScheduleIdInput,
): Promise<{ ok: boolean; error?: string }> {
  const r = getDb()
    .delete(socialSchedule)
    .where(eq(socialSchedule.id, input.schedule_id))
    .run();
  return (r as { changes?: number }).changes === 0
    ? { ok: false, error: `Schedule ${input.schedule_id} not found.` }
    : { ok: true };
}

export async function runScheduleNowTool(
  input: ScheduleIdInput,
): Promise<{
  ok: boolean;
  summary?: string;
  run_id?: string | null;
  error?: string;
}> {
  const db = getDb();
  const sched = db
    .select()
    .from(socialSchedule)
    .where(eq(socialSchedule.id, input.schedule_id))
    .get() as
    | {
        id: string;
        name: string;
        action_kind: string;
        action_payload: string;
        notify_chat: boolean;
        notify_telegram: boolean;
        fire_count: number;
      }
    | undefined;
  if (!sched) return { ok: false, error: `Schedule ${input.schedule_id} not found.` };

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(sched.action_payload);
  } catch (err) {
    return {
      ok: false,
      error: `action_payload not valid JSON: ${(err as Error).message}`,
    };
  }

  const firedAt = new Date().toISOString();
  const result = await dispatchScheduleAction(
    sched.action_kind as ScheduleActionKind,
    payload,
  );

  db.insert(socialScheduleFire)
    .values({
      id: uuidv4(),
      schedule_id: sched.id,
      fired_at: firedAt,
      status: result.ok ? "ok" : "failed",
      message: result.summary.slice(0, 1000),
      run_id: result.runId,
      result_payload: JSON.stringify(result.raw ?? {}),
    })
    .run();

  db.update(socialSchedule)
    .set({
      last_fire_at: firedAt,
      last_fire_status: result.ok ? "ok" : "failed",
      last_fire_message: result.summary.slice(0, 500),
      fire_count: sched.fire_count + 1,
      updated_at: new Date().toISOString(),
    })
    .where(eq(socialSchedule.id, sched.id))
    .run();

  await notifyFire({
    scheduleId: sched.id,
    scheduleName: sched.name,
    summary: result.summary,
    ok: result.ok,
    runId: result.runId,
    notifyChat: sched.notify_chat,
    notifyTelegram: sched.notify_telegram,
  });

  return {
    ok: result.ok,
    summary: result.summary,
    run_id: result.runId,
    error: result.ok ? undefined : result.summary,
  };
}

// ---------------------------------------------------------------------------
// proposeSchedule — natural language → structured preview.
//
// Constance calls this when the operator says "research X every Monday";
// the tool returns a structured proposal (cadence + action) WITHOUT
// persisting. Constance is then expected to confirm via askOperator
// before calling createSchedule with the same structured fields.
// ---------------------------------------------------------------------------

export const proposeScheduleSchema = z.object({
  operator_request: z
    .string()
    .min(4)
    .max(1000)
    .describe(
      "Operator's natural-language request, verbatim (e.g. 'every Monday at 9am, research the latest AI agent news').",
    ),
  default_timezone: z
    .string()
    .optional()
    .describe("Fallback IANA timezone when the request didn't include one."),
});

export type ProposeScheduleInput = z.infer<typeof proposeScheduleSchema>;

export interface ProposeScheduleOutput {
  ok: boolean;
  proposal?: {
    name: string;
    cadence: CadencePayload & { kind: CadenceKind };
    action: { kind: ScheduleActionKind; payload: Record<string, unknown> };
    cadence_summary: string;
    cadence_source: string;
  };
  error?: string;
}

export async function proposeScheduleTool(
  input: ProposeScheduleInput,
): Promise<ProposeScheduleOutput> {
  const system = `You convert a natural-language scheduling request into a structured JSON proposal. The operator will confirm before anything is persisted.

Return JSON only, no prose, matching this shape EXACTLY:

{
  "name": "short label (e.g. 'Monday AI research')",
  "cadence": {
    "kind": "daily|weekly|monthly|cron",
    "hour": 0-23,
    "minute": 0-59,
    "day_of_week": [0-6, ...],   // weekly only; 0=Sunday
    "day_of_month": 1-31,         // monthly only
    "timezone": "IANA TZ"
  },
  "action": {
    "kind": "run_pipeline|run_pipeline_multi|research_only|schedule_multi_day_campaign",
    "payload": {
      // run_pipeline: { topic, platform, format?, textOverlay? }
      // run_pipeline_multi: { topic, platforms: [], format?, textOverlay? }
      // research_only: { topic, platform? }
      // schedule_multi_day_campaign: { topic, platform, days: [{date, topicHint?}] }
    }
  }
}

Rules:
- Pick the simplest cadence kind that fits. "every Monday" → weekly, day_of_week:[1].
- If no time of day is named, default to 09:00 in the operator's timezone.
- If the operator named MULTIPLE platforms → action.kind = 'run_pipeline_multi'.
- If they said "research" without a draft → action.kind = 'research_only'.
- If they said "N posts over X days" → action.kind = 'schedule_multi_day_campaign'.
- Otherwise → action.kind = 'run_pipeline'.
- NEVER invent days, platforms, or topics. Mark uncertainty by omitting fields rather than guessing.`;

  const userPrompt = `OPERATOR REQUEST: ${input.operator_request}\n\nDefault timezone: ${input.default_timezone ?? "UTC"}`;

  let raw: string;
  try {
    raw = await llmGenerate(system, userPrompt, {
      temperature: 0.1,
      maxTokens: 800,
      caller: "agent.tool.proposeSchedule",
    });
  } catch (err) {
    return { ok: false, error: `LLM call failed: ${(err as Error).message}` };
  }

  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  let parsed: {
    name?: string;
    cadence?: CadencePayload & { kind?: CadenceKind };
    action?: { kind?: ScheduleActionKind; payload?: Record<string, unknown> };
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      ok: false,
      error: `proposal JSON malformed: ${(err as Error).message}. Raw output: ${cleaned.slice(0, 200)}`,
    };
  }

  if (!parsed.name || !parsed.cadence?.kind || !parsed.action?.kind) {
    return {
      ok: false,
      error: "proposal missing required fields (name / cadence.kind / action.kind)",
    };
  }
  parsed.cadence.timezone =
    parsed.cadence.timezone || input.default_timezone || "UTC";
  try {
    validateCadence(
      parsed.cadence.kind as CadenceKind,
      parsed.cadence as CadencePayload,
    );
  } catch (err) {
    return { ok: false, error: `proposed cadence invalid: ${(err as Error).message}` };
  }

  void and; // silence unused-import warning when conditions list stays empty
  return {
    ok: true,
    proposal: {
      name: parsed.name,
      cadence: parsed.cadence as CadencePayload & { kind: CadenceKind },
      action: {
        kind: parsed.action.kind as ScheduleActionKind,
        payload: parsed.action.payload ?? {},
      },
      cadence_summary: describeCadence(
        parsed.cadence.kind as CadenceKind,
        parsed.cadence as CadencePayload,
      ),
      cadence_source: input.operator_request,
    },
  };
}
