/**
 * Smart-scheduler worker. Polls social_run for rows where status='scheduled'
 * AND scheduled_at <= now, then promotes them to 'running' and fires the
 * pipeline using the persisted config_snapshot. In-process by design — for
 * a multi-process deploy you'd want to swap to a queue (BullMQ, Inngest).
 *
 * The promote step uses an UPDATE…WHERE status='scheduled' guard so two
 * concurrent ticks can't race the same row (SQLite's row lock means only
 * one wins; the other UPDATE returns 0 changes and we skip).
 */

import { eq, and, lte } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { socialRun } from '../../db/schema.js';

type Db = BetterSQLite3Database<Record<string, unknown>>;

const POLL_INTERVAL_MS = Number(process.env.SCHEDULER_POLL_MS) || 30_000;

let stopHandle: NodeJS.Timeout | null = null;

export function startScheduler(db: Db, log: { info: (...args: any[]) => void; error: (...args: any[]) => void }): () => void {
  log.info({ pollMs: POLL_INTERVAL_MS }, '[scheduler] worker started');
  const tick = async () => {
    try {
      const now = new Date().toISOString();
      const due = await db
        .select()
        .from(socialRun)
        .where(
          and(
            eq(socialRun.status, 'scheduled' as never),
            lte(socialRun.scheduled_at, now),
          ),
        );

      for (const run of due) {
        // Atomic claim: only the tick that flips status='scheduled' →
        // 'running' actually fires the pipeline. SQLite's UPDATE is
        // serialised on the row so duplicate-ticks are safe even if poll
        // intervals overlap.
        const claim = await db
          .update(socialRun)
          .set({ status: 'running' as never, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .where(and(eq(socialRun.id, run.id), eq(socialRun.status, 'scheduled' as never)))
          .run();

        // better-sqlite3's run() returns { changes }. If another tick
        // already claimed it, changes === 0 — skip.
        if ((claim as { changes?: number }).changes === 0) continue;

        let config: { platform?: string; brief?: { topic?: string }; format?: string | null };
        try {
          config = JSON.parse(run.config_snapshot);
        } catch {
          log.error({ runId: run.id }, '[scheduler] could not parse config_snapshot, marking failed');
          await db
            .update(socialRun)
            .set({ status: 'failed' as never, error_message: 'config_snapshot was not valid JSON', updated_at: new Date().toISOString() })
            .where(eq(socialRun.id, run.id))
            .run();
          continue;
        }

        const topic = config.brief?.topic;
        const platform = config.platform;
        if (!topic || !platform) {
          await db
            .update(socialRun)
            .set({ status: 'failed' as never, error_message: 'scheduled run missing topic or platform in config_snapshot', updated_at: new Date().toISOString() })
            .where(eq(socialRun.id, run.id))
            .run();
          continue;
        }

        log.info({ runId: run.id, topic, platform }, '[scheduler] firing scheduled run');

        // Pass the placeholder row's id through so runBotPipeline updates
        // it in place rather than inserting a new row — the runId stays
        // stable for any UI deep-link that already exists.
        const { runBotPipeline } = await import('../../bot/pipeline.js');
        runBotPipeline(db, topic, platform, {}, {
          format: config.format ?? null,
          runId: run.id,
          trigger: 'scheduled',
        }).catch((err) => log.error({ err, runId: run.id }, '[scheduler] pipeline fired async failed'));
      }
    } catch (err) {
      log.error({ err }, '[scheduler] tick failed');
    } finally {
      stopHandle = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  stopHandle = setTimeout(tick, POLL_INTERVAL_MS);

  return () => {
    if (stopHandle) clearTimeout(stopHandle);
    stopHandle = null;
    log.info('[scheduler] worker stopped');
  };
}
