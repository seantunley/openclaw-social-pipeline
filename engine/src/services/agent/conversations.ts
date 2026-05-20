/**
 * Conversation CRUD. One row per Telegram chat / dashboard session.
 * Conversations are NEVER hard-deleted — `archived_at` soft-archives so
 * memory recall can still reach the messages.
 */

import { randomUUID } from "node:crypto";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { agentConversation } from "../../db/schema.js";

export type Surface = "telegram" | "dashboard" | "system";

export interface Conversation {
  id: string;
  surface: Surface;
  surface_ref: string;
  title: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get the existing active conversation for (surface, surfaceRef) or create
 * one. Used by both the bot (one conversation per Telegram chatId) and the
 * dashboard (one per browser session). Idempotent and cheap.
 */
export function getOrCreateConversation(
  surface: Surface,
  surfaceRef: string,
  title = "",
): Conversation {
  const db = getDb();
  const existing = db
    .select()
    .from(agentConversation)
    .where(
      and(
        eq(agentConversation.surface, surface),
        eq(agentConversation.surface_ref, surfaceRef),
        isNull(agentConversation.archived_at),
      ),
    )
    .orderBy(desc(agentConversation.updated_at))
    .limit(1)
    .all();

  if (existing.length > 0) return existing[0] as Conversation;

  const id = randomUUID();
  db.insert(agentConversation)
    .values({ id, surface, surface_ref: surfaceRef, title })
    .run();
  return getById(id);
}

export function getById(id: string): Conversation {
  const db = getDb();
  const row = db
    .select()
    .from(agentConversation)
    .where(eq(agentConversation.id, id))
    .get();
  if (!row) throw new Error(`Conversation not found: ${id}`);
  return row as Conversation;
}

export function listRecent(surface?: Surface, limit = 25): Conversation[] {
  const db = getDb();
  const q = db
    .select()
    .from(agentConversation)
    .orderBy(desc(agentConversation.updated_at))
    .limit(limit);
  const rows = surface
    ? q.where(eq(agentConversation.surface, surface)).all()
    : q.all();
  return rows as Conversation[];
}

export function archive(id: string): void {
  const db = getDb();
  db.update(agentConversation)
    .set({ archived_at: new Date().toISOString() })
    .where(eq(agentConversation.id, id))
    .run();
}

export function setTitle(id: string, title: string): void {
  const db = getDb();
  db.update(agentConversation)
    .set({ title, updated_at: new Date().toISOString() })
    .where(eq(agentConversation.id, id))
    .run();
}

/** Bump updated_at so listRecent() sorts active conversations to the top. */
export function touch(id: string): void {
  const db = getDb();
  db.update(agentConversation)
    .set({ updated_at: new Date().toISOString() })
    .where(eq(agentConversation.id, id))
    .run();
}
