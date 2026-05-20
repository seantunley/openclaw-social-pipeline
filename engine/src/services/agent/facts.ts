/**
 * Semantic memory — LLM-extracted facts about the user/agent/world.
 *
 * Dedupe strategy: on insert, look for an existing active fact with the
 * same (subject, type) and very similar content. If found, bump
 * reinforcement_count + last_seen_at instead of inserting a duplicate.
 * Similarity here is intentionally coarse (case-folded substring) — the
 * embedder + retriever handle nuanced matching at recall time.
 *
 * Contradictions are handled by the extractor: it can call `supersede()`
 * with a pointer to the message that contradicted the old fact.
 */

import { randomUUID } from "node:crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { agentFact } from "../../db/schema.js";

export type FactType =
  | "preference"
  | "fact"
  | "skill"
  | "relationship"
  | "goal"
  | "constraint";

export interface Fact {
  id: string;
  type: FactType;
  subject: string;
  content: string;
  source_message_id: string;
  extractor_model: string;
  confidence: number;
  reinforcement_count: number;
  last_seen_at: string;
  last_validated_at: string | null;
  active: boolean;
  superseded_by_message_id: string | null;
  tags: string; // JSON array
  embedded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertFactInput {
  type: FactType;
  subject: string;
  content: string;
  sourceMessageId: string;
  extractorModel?: string;
  confidence?: number;
  tags?: string[];
}

/**
 * Insert OR reinforce. Returns the fact row and whether a new row was made.
 */
export function upsertFact(
  input: UpsertFactInput,
): { fact: Fact; created: boolean } {
  const db = getDb();
  const normalized = input.content.toLowerCase().trim();
  // Coarse dedupe: same subject + type + substring overlap of normalized
  // content. Embedder will catch the nuanced cases separately.
  const existing = db
    .select()
    .from(agentFact)
    .where(
      and(
        eq(agentFact.subject, input.subject),
        eq(agentFact.type, input.type),
        eq(agentFact.active, true),
      ),
    )
    .all() as Fact[];

  const match = existing.find(
    (f) =>
      f.content.toLowerCase().trim() === normalized ||
      f.content.toLowerCase().includes(normalized) ||
      normalized.includes(f.content.toLowerCase()),
  );

  const now = new Date().toISOString();
  if (match) {
    db.update(agentFact)
      .set({
        reinforcement_count: match.reinforcement_count + 1,
        confidence: Math.min(1, match.confidence + 0.05),
        last_seen_at: now,
        updated_at: now,
      })
      .where(eq(agentFact.id, match.id))
      .run();
    return { fact: getById(match.id), created: false };
  }

  const id = randomUUID();
  db.insert(agentFact)
    .values({
      id,
      type: input.type,
      subject: input.subject,
      content: input.content,
      source_message_id: input.sourceMessageId,
      extractor_model: input.extractorModel ?? "",
      confidence: input.confidence ?? 0.6,
      tags: JSON.stringify(input.tags ?? []),
    })
    .run();
  return { fact: getById(id), created: true };
}

export function getById(id: string): Fact {
  const db = getDb();
  const row = db.select().from(agentFact).where(eq(agentFact.id, id)).get();
  if (!row) throw new Error(`Fact not found: ${id}`);
  return row as Fact;
}

export function listActive(
  opts: { type?: FactType; subject?: string; minConfidence?: number; limit?: number } = {},
): Fact[] {
  const db = getDb();
  const where = [eq(agentFact.active, true)];
  if (opts.type) where.push(eq(agentFact.type, opts.type));
  if (opts.subject) where.push(eq(agentFact.subject, opts.subject));
  if (opts.minConfidence !== undefined) {
    where.push(sql`${agentFact.confidence} >= ${opts.minConfidence}`);
  }
  return db
    .select()
    .from(agentFact)
    .where(and(...where))
    .orderBy(desc(agentFact.confidence), desc(agentFact.reinforcement_count))
    .limit(opts.limit ?? 200)
    .all() as Fact[];
}

export function listUnembedded(limit = 100): Fact[] {
  const db = getDb();
  return db
    .select()
    .from(agentFact)
    .where(and(eq(agentFact.active, true), sql`${agentFact.embedded_at} IS NULL`))
    .limit(limit)
    .all() as Fact[];
}

export function markEmbedded(id: string): void {
  const db = getDb();
  db.update(agentFact)
    .set({ embedded_at: new Date().toISOString() })
    .where(eq(agentFact.id, id))
    .run();
}

export function supersede(id: string, supersededByMessageId: string): void {
  const db = getDb();
  db.update(agentFact)
    .set({
      active: false,
      superseded_by_message_id: supersededByMessageId,
      updated_at: new Date().toISOString(),
    })
    .where(eq(agentFact.id, id))
    .run();
}

/** Render top-N highest-confidence active facts for prompt injection.
 *  Confidence floor is 0.7 per the original brief's manage-step rule —
 *  weak / inferred facts stay in the table but don't bias the prompt. */
export function renderForPrompt(limit = 25, minConfidence = 0.7): string {
  const facts = listActive({ minConfidence, limit });
  if (facts.length === 0) return "";
  const lines = facts.map(
    (f) => `  - [${f.type}/${f.subject}] ${f.content} (conf ${f.confidence.toFixed(2)})`,
  );
  return `What I remember about you and our work:\n${lines.join("\n")}`;
}
