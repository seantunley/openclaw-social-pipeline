/**
 * Procedural / reflective memory — behavioural rules the agent extracted
 * by self-reviewing past conversations. Different from facts: lessons are
 * imperatives ("next time the operator asks X, do Y first") not statements.
 */

import { randomUUID } from "node:crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { agentLesson } from "../../db/schema.js";

export interface Lesson {
  id: string;
  content: string;
  source_conversation_id: string | null;
  confidence: number;
  reinforcement_count: number;
  active: boolean;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface AddLessonInput {
  content: string;
  sourceConversationId?: string;
  confidence?: number;
  tags?: string[];
}

export function addLesson(input: AddLessonInput): Lesson {
  const db = getDb();
  // Reinforce if an active lesson with the same content already exists.
  const existing = db
    .select()
    .from(agentLesson)
    .where(
      and(
        eq(agentLesson.active, true),
        sql`lower(${agentLesson.content}) = lower(${input.content})`,
      ),
    )
    .get() as Lesson | undefined;

  if (existing) {
    db.update(agentLesson)
      .set({
        reinforcement_count: existing.reinforcement_count + 1,
        confidence: Math.min(1, existing.confidence + 0.05),
        updated_at: new Date().toISOString(),
      })
      .where(eq(agentLesson.id, existing.id))
      .run();
    return getById(existing.id);
  }

  const id = randomUUID();
  db.insert(agentLesson)
    .values({
      id,
      content: input.content,
      source_conversation_id: input.sourceConversationId ?? null,
      confidence: input.confidence ?? 0.6,
      tags: JSON.stringify(input.tags ?? []),
    })
    .run();
  return getById(id);
}

export function getById(id: string): Lesson {
  const db = getDb();
  const row = db
    .select()
    .from(agentLesson)
    .where(eq(agentLesson.id, id))
    .get();
  if (!row) throw new Error(`Lesson not found: ${id}`);
  return row as Lesson;
}

export function listActive(limit = 50, minConfidence = 0.5): Lesson[] {
  const db = getDb();
  return db
    .select()
    .from(agentLesson)
    .where(
      and(
        eq(agentLesson.active, true),
        sql`${agentLesson.confidence} >= ${minConfidence}`,
      ),
    )
    .orderBy(desc(agentLesson.confidence), desc(agentLesson.reinforcement_count))
    .limit(limit)
    .all() as Lesson[];
}

export function deactivate(id: string): void {
  const db = getDb();
  db.update(agentLesson)
    .set({ active: false, updated_at: new Date().toISOString() })
    .where(eq(agentLesson.id, id))
    .run();
}

export function renderForPrompt(limit = 12): string {
  const lessons = listActive(limit);
  if (lessons.length === 0) return "";
  const lines = lessons.map((l) => `  - ${l.content}`);
  return `Lessons from past conversations:\n${lines.join("\n")}`;
}
