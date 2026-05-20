/**
 * Message CRUD — RAW EPISODIC store. Every turn, every tool call, every
 * tool result is one row. Never deleted, never summarized away. Summaries
 * live in conversation_summary, facts live in agent_fact — both derived,
 * never replacements for this table.
 */

import { randomUUID } from "node:crypto";
import { eq, and, asc, desc, isNull, gt, sql } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { agentMessage } from "../../db/schema.js";
import { touch as touchConversation } from "./conversations.js";

export type Role = "user" | "assistant" | "tool" | "system";

export interface Message {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  tool_calls: string; // JSON
  tool_call_id: string | null;
  tool_name: string | null;
  tool_result: string; // JSON
  extracted_at: string | null;
  embedded_at: string | null;
  created_at: string;
}

export interface AppendMessageInput {
  conversationId: string;
  role: Role;
  content: string;
  toolCalls?: unknown[];
  toolCallId?: string;
  toolName?: string;
  toolResult?: unknown;
}

export function appendMessage(input: AppendMessageInput): Message {
  const db = getDb();
  const id = randomUUID();
  db.insert(agentMessage)
    .values({
      id,
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      tool_calls: JSON.stringify(input.toolCalls ?? []),
      tool_call_id: input.toolCallId ?? null,
      tool_name: input.toolName ?? null,
      tool_result: JSON.stringify(input.toolResult ?? {}),
    })
    .run();
  touchConversation(input.conversationId);
  return getById(id);
}

export function getById(id: string): Message {
  const db = getDb();
  const row = db
    .select()
    .from(agentMessage)
    .where(eq(agentMessage.id, id))
    .get();
  if (!row) throw new Error(`Message not found: ${id}`);
  return row as Message;
}

/** Recent messages for a conversation, oldest-first (newest at end). */
export function listForConversation(
  conversationId: string,
  limit = 50,
): Message[] {
  const db = getDb();
  // Get the last `limit` rows by created_at desc, then reverse to oldest-first.
  const recent = db
    .select()
    .from(agentMessage)
    .where(eq(agentMessage.conversation_id, conversationId))
    .orderBy(desc(agentMessage.created_at))
    .limit(limit)
    .all() as Message[];
  return recent.reverse();
}

export function countForConversation(conversationId: string): number {
  const db = getDb();
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(agentMessage)
    .where(eq(agentMessage.conversation_id, conversationId))
    .get();
  return row?.n ?? 0;
}

/** Mark a message as having been processed by the fact extractor. */
export function markExtracted(id: string): void {
  const db = getDb();
  db.update(agentMessage)
    .set({ extracted_at: new Date().toISOString() })
    .where(eq(agentMessage.id, id))
    .run();
}

export function markEmbedded(id: string): void {
  const db = getDb();
  db.update(agentMessage)
    .set({ embedded_at: new Date().toISOString() })
    .where(eq(agentMessage.id, id))
    .run();
}

/**
 * Messages waiting for the fact extractor. We only extract from user +
 * assistant text turns — tool rows are mechanical, not statements.
 */
export function listUnextracted(limit = 50): Message[] {
  const db = getDb();
  return db
    .select()
    .from(agentMessage)
    .where(
      and(
        isNull(agentMessage.extracted_at),
        sql`${agentMessage.role} IN ('user', 'assistant')`,
      ),
    )
    .orderBy(asc(agentMessage.created_at))
    .limit(limit)
    .all() as Message[];
}

/** Messages waiting for embeddings. */
export function listUnembedded(limit = 100): Message[] {
  const db = getDb();
  return db
    .select()
    .from(agentMessage)
    .where(
      and(
        isNull(agentMessage.embedded_at),
        sql`${agentMessage.role} IN ('user', 'assistant')`,
        sql`length(${agentMessage.content}) > 0`,
      ),
    )
    .orderBy(asc(agentMessage.created_at))
    .limit(limit)
    .all() as Message[];
}
