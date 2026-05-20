/**
 * Recurring scheduler worker. Polls social_schedule for rows where
 * status='active' AND next_fire_at <= now, then fires each one's action
 * via the dispatcher, logs the outcome to social_schedule_fire, updates
 * next_fire_at via the cadence helper, and notifies the operator via
 * chat + optional Telegram.
 *
 * Concurrency: like the publish scheduler, we atomic-claim each row by
 * stamping next_fire_at forward in the same UPDATE that reads it. That
 * guards against duplicate fires when two ticks overlap.
 *
 * Failure model: a failed fire stays at the new next_fire_at — i.e. we
 * don't reschedule retries. The fire log captures the error and the
 * operator can run-now from the dashboard to retry. Auto-retries land
 * later when we have a clearer back-off policy.
 */

import { v4 as uuidv4 } from "uuid";
import { and, eq, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { socialSchedule, socialScheduleFire } from "../../db/schema.js";
import {
  computeNextFire,
  type CadencePayload,
  type CadenceKind,
} from "./cadence.js";
import {
  dispatchScheduleAction,
  type ScheduleActionKind,
} from "./dispatch.js";
import { notifyFire } from "./notifier.js";

type Db = BetterSQLite3Database<Record<string, unknown>>;

const POLL_INTERVAL_MS =
  Number(process.env.RECURRING_SCHEDULER_POLL_MS) || 30_000;

let stopHandle: NodeJS.Timeout | null = null;

interface Logger {
  info: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
}

export function startRecurringScheduler(db: Db, log: Logger): () => void {
  log.info({ pollMs: POLL_INTERVAL_MS }, "[recurring-scheduler] worker started");

  const tick = async () => {
    try {
      const now = new Date().toISOString();
      const due = (await db
        .select()
        .from(socialSchedule)
        .where(
          and(
            eq(socialSchedule.status, "active" as never),
            lte(socialSchedule.next_fire_at, now),
          ),
        )) as Array<{
        id: string;
        name: string;
        cadence_kind: string;
        cadence_payload: string;
        action_kind: string;
        action_payload: string;
        next_fire_at: string;
        notify_chat: boolean;
        notify_telegram: boolean;
        fire_count: number;
      }>;

      for (const sched of due) {
        // Parse cadence + action payloads up front; reject the fire if
        // either is malformed so it doesn't loop on bad data.
        let cadencePayload: CadencePayload;
        let actionPayload: Record<string, unknown>;
        try {
          cadencePayload = JSON.parse(sched.cadence_payload);
        } catch (err) {
          await markFireFailed(
            db,
            sched.id,
            sched.next_fire_at,
            `cadence_payload not valid JSON: ${(err as Error).message}`,
            log,
          );
          continue;
        }
        try {
          actionPayload = JSON.parse(sched.action_payload);
        } catch (err) {
          await markFireFailed(
            db,
            sched.id,
            sched.next_fire_at,
            `action_payload not valid JSON: ${(err as Error).message}`,
            log,
          );
          continue;
        }

        // Atomic claim: advance next_fire_at in the same UPDATE that
        // reads the row. Two ticks racing on the same schedule both
        // try to flip next_fire_at; only the first changes any rows.
        let nextFire: string;
        try {
          nextFire = computeNextFire(
            sched.cadence_kind as CadenceKind,
            cadencePayload,
            new Date(Date.now() + 1_000), // anchor 1s in the future to avoid same-second loop
          );
        } catch (err) {
          await markFireFailed(
            db,
            sched.id,
            sched.next_fire_at,
            `couldn't compute next fire: ${(err as Error).message}`,
            log,
          );
          continue;
        }

        const claim = (await db
          .update(socialSchedule)
          .set({
            next_fire_at: nextFire,
            updated_at: new Date().toISOString(),
          })
          .where(
            and(
              eq(socialSchedule.id, sched.id),
              eq(socialSchedule.next_fire_at, sched.next_fire_at),
            ),
          )
          .run()) as { changes?: number };

        if ((claim.changes ?? 0) === 0) {
          // Another tick beat us to it. Move on.
          continue;
        }

        log.info(
          {
            scheduleId: sched.id,
            action: sched.action_kind,
            nextFire,
          },
          "[recurring-scheduler] firing schedule",
        );

        const firedAt = new Date().toISOString();
        const result = await dispatchScheduleAction(
          sched.action_kind as ScheduleActionKind,
          actionPayload,
        );

        // Persist fire record + update aggregate fields on the schedule row.
        await db.insert(socialScheduleFire).values({
          id: uuidv4(),
          schedule_id: sched.id,
          fired_at: firedAt,
          status: result.ok ? "ok" : "failed",
          message: result.summary.slice(0, 1000),
          run_id: result.runId,
          result_payload: JSON.stringify(result.raw ?? {}),
        });

        await db
          .update(socialSchedule)
          .set({
            last_fire_at: firedAt,
            last_fire_status: result.ok ? "ok" : "failed",
            last_fire_message: result.summary.slice(0, 500),
            fire_count: sched.fire_count + 1,
            updated_at: new Date().toISOString(),
          })
          .where(eq(socialSchedule.id, sched.id));

        // Notify chat + (optional) Telegram. notifyFire never throws.
        await notifyFire({
          scheduleId: sched.id,
          scheduleName: sched.name,
          summary: result.summary,
          ok: result.ok,
          runId: result.runId,
          notifyChat: sched.notify_chat,
          notifyTelegram: sched.notify_telegram,
          log,
        });
      }
    } catch (err) {
      log.error({ err }, "[recurring-scheduler] tick failed");
    } finally {
      stopHandle = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  stopHandle = setTimeout(tick, POLL_INTERVAL_MS);

  return () => {
    if (stopHandle) clearTimeout(stopHandle);
    stopHandle = null;
    log.info("[recurring-scheduler] worker stopped");
  };
}

/**
 * When a schedule has unfixable data (bad JSON, bad cadence), log a
 * 'failed' fire so the dashboard surfaces the problem, then push
 * next_fire_at one hour out so we don't loop on it every 30s.
 */
async function markFireFailed(
  db: Db,
  scheduleId: string,
  oldNextFireAt: string,
  reason: string,
  log: Logger,
): Promise<void> {
  const now = new Date();
  const reschedule = new Date(now.getTime() + 60 * 60_000).toISOString();
  await db.insert(socialScheduleFire).values({
    id: uuidv4(),
    schedule_id: scheduleId,
    fired_at: now.toISOString(),
    status: "failed",
    message: reason.slice(0, 1000),
    result_payload: "{}",
  });
  await db
    .update(socialSchedule)
    .set({
      next_fire_at: reschedule,
      last_fire_at: now.toISOString(),
      last_fire_status: "failed",
      last_fire_message: reason.slice(0, 500),
      updated_at: now.toISOString(),
    })
    .where(
      and(
        eq(socialSchedule.id, scheduleId),
        eq(socialSchedule.next_fire_at, oldNextFireAt),
      ),
    );
  log.error({ scheduleId, reason }, "[recurring-scheduler] schedule marked failed");
}
