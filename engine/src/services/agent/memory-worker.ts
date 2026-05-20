/**
 * Memory maintenance worker — runs alongside the scheduler. Every tick:
 *   1. Extract facts from unextracted user/assistant messages.
 *   2. Compute embeddings for unembedded messages and facts.
 *   3. For conversations idle past `summary_idle_minutes` and with no recent
 *      conversation-level summary, run the summarizer.
 *   4. For those same conversations, run the reflector to extract lessons.
 *
 * All four tasks run with try/catch so a failure in one doesn't stop the rest.
 * Errors are logged but never thrown back into the caller.
 *
 * Configurable via env:
 *   MEMORY_WORKER_POLL_MS              (default 60_000 = 1 minute)
 *   MEMORY_WORKER_BATCH_EXTRACT        (default 20 messages per tick)
 *   MEMORY_WORKER_BATCH_EMBED          (default 50 items per tick)
 *   MEMORY_WORKER_SUMMARY_IDLE_MIN     (default 30 minutes idle before summarize)
 *   MEMORY_WORKER_REFLECT_MIN_TURNS    (default 6 turns before reflect)
 *
 * Designed to be cheap when the system is idle — the queries are indexed
 * (`agent_message.extracted_at IS NULL`, `embedded_at IS NULL`) and return
 * zero rows when there's nothing to do.
 */

import { eq, and, sql, desc, isNull, lt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { agentConversation, agentMessage, conversationSummary, agentLesson } from "../../db/schema.js";
import { extractBacklog } from "./extractor.js";
import { embedBacklog } from "./embed-writer.js";
import { summarizeConversation } from "./summarizer.js";
import { reflectAndLearn } from "./reflector.js";

type Db = BetterSQLite3Database<Record<string, unknown>>;
type Logger = { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

const POLL_INTERVAL_MS = Number(process.env.MEMORY_WORKER_POLL_MS) || 60_000;
const BATCH_EXTRACT = Number(process.env.MEMORY_WORKER_BATCH_EXTRACT) || 20;
const BATCH_EMBED = Number(process.env.MEMORY_WORKER_BATCH_EMBED) || 50;
const SUMMARY_IDLE_MINUTES = Number(process.env.MEMORY_WORKER_SUMMARY_IDLE_MIN) || 30;
const REFLECT_MIN_TURNS = Number(process.env.MEMORY_WORKER_REFLECT_MIN_TURNS) || 6;

export function startMemoryWorker(db: Db, log: Logger): () => void {
  log.info(
    {
      pollMs: POLL_INTERVAL_MS,
      batchExtract: BATCH_EXTRACT,
      batchEmbed: BATCH_EMBED,
      summaryIdleMin: SUMMARY_IDLE_MINUTES,
    },
    "[memory-worker] started",
  );

  let stopHandle: NodeJS.Timeout | null = null;
  let running = false;

  const tick = async () => {
    if (running) {
      // Reentrancy guard — a slow tick could still be running when the
      // next setTimeout fires. Skip rather than pile up.
      stopHandle = setTimeout(tick, POLL_INTERVAL_MS);
      return;
    }
    running = true;
    try {
      const t0 = Date.now();
      const stats = { extracted: 0, embedded: 0, summarized: 0, reflected: 0 };

      // 1. Extract facts.
      try {
        stats.extracted = await extractBacklog(BATCH_EXTRACT);
      } catch (err) {
        log.error({ err: (err as Error).message }, "[memory-worker] extract pass failed");
      }

      // 2. Compute embeddings.
      try {
        const r = await embedBacklog(BATCH_EMBED);
        stats.embedded = r.messagesEmbedded + r.factsEmbedded;
      } catch (err) {
        log.error({ err: (err as Error).message }, "[memory-worker] embed pass failed");
      }

      // 3. Summarize + reflect on idle conversations.
      try {
        const idle = findIdleConversations(db, SUMMARY_IDLE_MINUTES, REFLECT_MIN_TURNS);
        for (const conv of idle) {
          try {
            await summarizeConversation(conv.id);
            stats.summarized += 1;
          } catch (err) {
            log.error(
              { err: (err as Error).message, conversationId: conv.id },
              "[memory-worker] summary failed",
            );
          }
          try {
            const r = await reflectAndLearn(conv.id);
            if (r.lessonsAdded + r.lessonsReinforced > 0) stats.reflected += 1;
          } catch (err) {
            log.error(
              { err: (err as Error).message, conversationId: conv.id },
              "[memory-worker] reflect failed",
            );
          }
        }
      } catch (err) {
        log.error({ err: (err as Error).message }, "[memory-worker] idle-conv sweep failed");
      }

      const totalActed = stats.extracted + stats.embedded + stats.summarized + stats.reflected;
      if (totalActed > 0) {
        log.info(
          { ...stats, durationMs: Date.now() - t0 },
          "[memory-worker] tick",
        );
      }
    } finally {
      running = false;
      stopHandle = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  // First tick after a short delay so we don't hammer the DB at boot.
  stopHandle = setTimeout(tick, 5_000);

  return () => {
    if (stopHandle) clearTimeout(stopHandle);
    stopHandle = null;
    log.info("[memory-worker] stopped");
  };
}

// ---------------------------------------------------------------------------
// Find conversations idle past `idleMinutes` with >= `minTurns` messages and
// no fresh conversation-level summary. Used to decide which conversations to
// summarize + reflect on this tick.
// ---------------------------------------------------------------------------

interface IdleConv {
  id: string;
  updated_at: string;
  message_count: number;
}

function findIdleConversations(db: Db, idleMinutes: number, minTurns: number): IdleConv[] {
  const cutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();
  // Conversations with messages AND last activity older than cutoff. Then we
  // exclude ones that already have a fresh conversation-level summary newer
  // than their last message (i.e., already summarized since they went idle).
  const rows = db
    .select({
      id: agentConversation.id,
      updated_at: agentConversation.updated_at,
      message_count: sql<number>`(
        SELECT count(*) FROM ${agentMessage} m
         WHERE m.conversation_id = ${agentConversation.id}
           AND m.role IN ('user', 'assistant')
      )`,
      last_summary_at: sql<string | null>`(
        SELECT max(created_at) FROM ${conversationSummary} s
         WHERE s.conversation_id = ${agentConversation.id}
           AND s.period = 'conversation'
      )`,
    })
    .from(agentConversation)
    .where(
      and(
        lt(agentConversation.updated_at, cutoff),
        isNull(agentConversation.archived_at),
      ),
    )
    .all() as Array<IdleConv & { last_summary_at: string | null }>;

  return rows
    .filter((r) => r.message_count >= minTurns)
    .filter((r) => !r.last_summary_at || r.last_summary_at < r.updated_at)
    .map(({ id, updated_at, message_count }) => ({ id, updated_at, message_count }));
}
