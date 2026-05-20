/**
 * Memory recall — hybrid retriever combining FTS5 lexical and sqlite-vec
 * semantic search. Called at the start of every turn to build the agent's
 * working context.
 *
 * Strategy:
 *   1. Always include active preferences + recent active lessons + recent
 *      messages from this conversation (cheap, deterministic, never miss).
 *   2. For the user's query, run FTS5 over agent_message + agent_fact for
 *      lexical hits, and vector similarity over the same for semantic hits.
 *   3. Merge with reciprocal rank fusion (RRF) so neither method dominates.
 *   4. Render as a single context block for prompt injection.
 *
 * Failure mode: if vector recall fails (stub vectors, no API key, vec0
 * issue), we DEGRADE to FTS-only and emit a warning instead of aborting.
 */

import { getSqlite } from "../../db/index.js";
import * as messagesRepo from "./messages.js";
import * as factsRepo from "./facts.js";
import * as preferencesRepo from "./preferences.js";
import * as lessonsRepo from "./lessons.js";
import { getLatestConversationSummary } from "./summarizer.js";
import { embedText, vectorToBuffer, getEmbedDim } from "./embeddings.js";

export interface RecallOptions {
  conversationId: string;
  query: string;
  /** How many recent messages to always include. */
  recentMessages?: number;
  /** Max FTS+vec hits to include. */
  maxRetrievedMessages?: number;
  maxRetrievedFacts?: number;
  factMinConfidence?: number;
}

export interface RecalledMessageHit {
  message_id: string;
  content: string;
  role: string;
  conversation_id: string;
  created_at: string;
  fts_rank: number | null;
  vec_distance: number | null;
}

export interface RecalledFactHit {
  fact_id: string;
  content: string;
  subject: string;
  type: string;
  confidence: number;
  fts_rank: number | null;
  vec_distance: number | null;
}

export interface RecallResult {
  preferences: string;
  lessons: string;
  recent: messagesRepo.Message[];
  messageHits: RecalledMessageHit[];
  factHits: RecalledFactHit[];
  /** Latest conversation-level summary for THIS conversation, if any. */
  conversationSummary: string | null;
  /** Warnings about degraded retrieval, e.g. vector recall fell back to FTS-only. */
  warnings: string[];
}

const FTS_TOP_K = 25;
const VEC_TOP_K = 25;

/**
 * Build the agent's memory context for one turn. Always succeeds — degrades
 * vector search to FTS-only if embedding fails, and emits a warning.
 */
export async function recall(opts: RecallOptions): Promise<RecallResult> {
  const recent = messagesRepo.listForConversation(
    opts.conversationId,
    opts.recentMessages ?? 12,
  );

  const warnings: string[] = [];
  // Confidence floor 0.7 per the original brief's "manage step" rule —
  // weak inferences aren't injected into the prompt.
  const factMinConfidence = opts.factMinConfidence ?? 0.7;
  const messageHits = ftsMessages(opts.query, FTS_TOP_K);
  const factHits = ftsFacts(opts.query, FTS_TOP_K, factMinConfidence);
  const conversationSummary = getLatestConversationSummary(opts.conversationId);

  let vecMessageRows: VecHit[] = [];
  let vecFactRows: VecHit[] = [];
  try {
    const { vector, stub } = await embedText(opts.query);
    if (stub) {
      warnings.push(
        "Vector recall skipped: no OPENAI_API_KEY (using stub vectors only useful for tests).",
      );
    } else {
      vecMessageRows = vecMessages(vector, VEC_TOP_K);
      vecFactRows = vecFacts(vector, VEC_TOP_K, factMinConfidence);
    }
  } catch (err) {
    warnings.push(
      `Vector recall failed: ${(err as Error).message}. Falling back to FTS-only.`,
    );
  }

  // Merge FTS + vec via reciprocal rank fusion.
  const fusedMessages = fuseMessages(
    messageHits,
    vecMessageRows,
  ).slice(0, opts.maxRetrievedMessages ?? 8);
  const fusedFacts = fuseFacts(
    factHits,
    vecFactRows,
  ).slice(0, opts.maxRetrievedFacts ?? 12);

  // Active conversation messages are already in `recent`; exclude them from
  // the retrieved set to avoid duplication.
  const recentIds = new Set(recent.map((r) => r.id));
  const messageHitsDedup = fusedMessages.filter((h) => !recentIds.has(h.message_id));

  return {
    preferences: preferencesRepo.renderForPrompt(),
    lessons: lessonsRepo.renderForPrompt(),
    recent,
    messageHits: messageHitsDedup,
    factHits: fusedFacts,
    conversationSummary,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// FTS helpers
// ---------------------------------------------------------------------------

function ftsMessages(query: string, k: number): RecalledMessageHit[] {
  const q = toFtsQuery(query);
  if (!q) return [];
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare(
      `SELECT m.id AS message_id, m.content, m.role, m.conversation_id, m.created_at,
              fts.rank AS fts_rank
         FROM agent_message_fts fts
         JOIN agent_message m ON m.rowid = fts.rowid
        WHERE agent_message_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ?`,
    )
    .all(q, k) as Array<RecalledMessageHit>;
  return rows.map((r) => ({ ...r, vec_distance: null }));
}

function ftsFacts(
  query: string,
  k: number,
  minConfidence: number,
): RecalledFactHit[] {
  const q = toFtsQuery(query);
  if (!q) return [];
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare(
      `SELECT f.id AS fact_id, f.content, f.subject, f.type, f.confidence,
              fts.rank AS fts_rank
         FROM agent_fact_fts fts
         JOIN agent_fact f ON f.rowid = fts.rowid
        WHERE agent_fact_fts MATCH ?
          AND f.active = 1
          AND f.confidence >= ?
        ORDER BY fts.rank
        LIMIT ?`,
    )
    .all(q, minConfidence, k) as Array<RecalledFactHit>;
  return rows.map((r) => ({ ...r, vec_distance: null }));
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

interface VecHit {
  id: string;
  distance: number;
}

function vecMessages(vector: Float32Array, k: number): VecHit[] {
  if (vector.length !== getEmbedDim()) return [];
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare(
      `SELECT message_id AS id, distance
         FROM agent_message_vec
        WHERE embedding MATCH ?
          AND k = ?
        ORDER BY distance`,
    )
    .all(vectorToBuffer(vector), k) as VecHit[];
  return rows;
}

function vecFacts(
  vector: Float32Array,
  k: number,
  minConfidence: number,
): VecHit[] {
  if (vector.length !== getEmbedDim()) return [];
  const sqlite = getSqlite();
  // Pull more from vec then filter by active/confidence via join.
  const rows = sqlite
    .prepare(
      `SELECT v.fact_id AS id, v.distance AS distance
         FROM agent_fact_vec v
         JOIN agent_fact f ON f.id = v.fact_id
        WHERE v.embedding MATCH ?
          AND v.k = ?
          AND f.active = 1
          AND f.confidence >= ?
        ORDER BY v.distance`,
    )
    .all(vectorToBuffer(vector), k * 2, minConfidence) as VecHit[];
  return rows.slice(0, k);
}

// ---------------------------------------------------------------------------
// Fusion + helpers
// ---------------------------------------------------------------------------

const RRF_K = 60;

function fuseMessages(
  fts: RecalledMessageHit[],
  vec: VecHit[],
): RecalledMessageHit[] {
  const ftsRanks = new Map<string, number>();
  fts.forEach((r, i) => ftsRanks.set(r.message_id, i + 1));

  const vecRanks = new Map<string, number>();
  vec.forEach((r, i) => vecRanks.set(r.id, i + 1));

  const ids = new Set<string>([...ftsRanks.keys(), ...vecRanks.keys()]);
  const scored = Array.from(ids).map((id) => {
    const r1 = ftsRanks.get(id);
    const r2 = vecRanks.get(id);
    const score = (r1 ? 1 / (RRF_K + r1) : 0) + (r2 ? 1 / (RRF_K + r2) : 0);
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);

  // Re-hydrate FTS hits and stitch in vector hits not present in FTS.
  const ftsById = new Map(fts.map((r) => [r.message_id, r]));
  const result: RecalledMessageHit[] = [];
  const sqlite = getSqlite();
  for (const { id } of scored) {
    const hit = ftsById.get(id);
    if (hit) {
      const vecRow = vec.find((v) => v.id === id);
      result.push({ ...hit, vec_distance: vecRow?.distance ?? null });
      continue;
    }
    // Pulled in from vec only — need to fetch the row.
    const row = sqlite
      .prepare(
        `SELECT id AS message_id, content, role, conversation_id, created_at
           FROM agent_message WHERE id = ?`,
      )
      .get(id) as
      | (Omit<RecalledMessageHit, "fts_rank" | "vec_distance">)
      | undefined;
    if (!row) continue;
    const vecRow = vec.find((v) => v.id === id);
    result.push({
      ...row,
      fts_rank: null,
      vec_distance: vecRow?.distance ?? null,
    });
  }
  return result;
}

function fuseFacts(
  fts: RecalledFactHit[],
  vec: VecHit[],
): RecalledFactHit[] {
  const ftsRanks = new Map<string, number>();
  fts.forEach((r, i) => ftsRanks.set(r.fact_id, i + 1));
  const vecRanks = new Map<string, number>();
  vec.forEach((r, i) => vecRanks.set(r.id, i + 1));

  const ids = new Set<string>([...ftsRanks.keys(), ...vecRanks.keys()]);
  const scored = Array.from(ids).map((id) => {
    const r1 = ftsRanks.get(id);
    const r2 = vecRanks.get(id);
    const score = (r1 ? 1 / (RRF_K + r1) : 0) + (r2 ? 1 / (RRF_K + r2) : 0);
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const ftsById = new Map(fts.map((r) => [r.fact_id, r]));
  const result: RecalledFactHit[] = [];
  const sqlite = getSqlite();
  for (const { id } of scored) {
    const hit = ftsById.get(id);
    if (hit) {
      const vecRow = vec.find((v) => v.id === id);
      result.push({ ...hit, vec_distance: vecRow?.distance ?? null });
      continue;
    }
    const row = sqlite
      .prepare(
        `SELECT id AS fact_id, content, subject, type, confidence
           FROM agent_fact WHERE id = ? AND active = 1`,
      )
      .get(id) as
      | (Omit<RecalledFactHit, "fts_rank" | "vec_distance">)
      | undefined;
    if (!row) continue;
    const vecRow = vec.find((v) => v.id === id);
    result.push({
      ...row,
      fts_rank: null,
      vec_distance: vecRow?.distance ?? null,
    });
  }
  return result;
}

/**
 * Convert free-form user input into an FTS5 MATCH query. We escape double
 * quotes, split on whitespace, drop empty tokens, and OR them together.
 * Phrase matching isn't worth the complexity for short chat queries.
 */
function toFtsQuery(q: string): string {
  const tokens = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

/** Render the recall result as a system-prompt-injectable block. */
export function renderForPrompt(r: RecallResult): string {
  const parts: string[] = [];
  if (r.preferences) parts.push(r.preferences);
  if (r.lessons) parts.push(r.lessons);
  // Read-path step 4 from the original brief: load the most recent
  // conversation-level summary so the agent has procedural context without
  // paying for every past turn of an old thread.
  if (r.conversationSummary) {
    parts.push(`Summary of this conversation so far:\n  ${r.conversationSummary}`);
  }
  if (r.factHits.length > 0) {
    parts.push(
      "Recalled facts relevant to this turn:\n" +
        r.factHits
          .map(
            (f) =>
              `  - [${f.type}/${f.subject}] ${f.content} (conf ${f.confidence.toFixed(2)})`,
          )
          .join("\n"),
    );
  }
  if (r.messageHits.length > 0) {
    parts.push(
      "Recalled snippets from past conversations:\n" +
        r.messageHits
          .map(
            (m) =>
              `  - [${m.role} @ ${m.created_at.slice(0, 19)}] ${m.content.slice(0, 280)}`,
          )
          .join("\n"),
    );
  }
  // WORKING MEMORY — the recent turns of THIS conversation. Without this the
  // model has no context across turns even when called with a conversationId.
  // We exclude the most-recent user turn (it's already the LLM's actual
  // user message), and we exclude tool/system rows from the rendered prompt
  // (they're internal scaffolding).
  if (r.recent.length > 1) {
    const history = r.recent.slice(0, -1).filter((m) => m.role === "user" || m.role === "assistant");
    if (history.length > 0) {
      parts.push(
        "Conversation so far (this thread):\n" +
          history
            .map((m) => {
              const label = m.role === "user" ? "Operator" : "You";
              return `  ${label}: ${m.content.slice(0, 600)}`;
            })
            .join("\n"),
      );
    }
  }
  return parts.join("\n\n");
}
