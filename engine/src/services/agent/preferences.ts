/**
 * User preferences — small never-forget store. Distinct from agent_fact:
 * preferences are operationally always applicable and ALWAYS loaded into
 * the prompt. Facts are retrieved situationally.
 *
 * On conflict (same key), the new value supersedes the old. The previous
 * row is NOT preserved here — preferences are operationally a single
 * key=value map. (The original message that set it stays in agent_message
 * forever, so provenance is intact.)
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { userPreference } from "../../db/schema.js";

export interface Preference {
  key: string;
  value: string;
  set_explicitly: boolean;
  set_via_message_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function listActive(): Preference[] {
  const db = getDb();
  return db
    .select()
    .from(userPreference)
    .where(eq(userPreference.active, true))
    .all() as unknown as Preference[];
}

export function get(key: string): Preference | null {
  const db = getDb();
  const row = db
    .select()
    .from(userPreference)
    .where(eq(userPreference.key, key))
    .get();
  return (row as unknown as Preference) ?? null;
}

export interface UpsertInput {
  key: string;
  value: string;
  setExplicitly?: boolean;
  setViaMessageId?: string;
}

export function upsert(input: UpsertInput): Preference {
  const db = getDb();
  const existing = get(input.key);
  const now = new Date().toISOString();
  if (existing) {
    db.update(userPreference)
      .set({
        value: input.value,
        set_explicitly: input.setExplicitly ?? existing.set_explicitly,
        set_via_message_id: input.setViaMessageId ?? existing.set_via_message_id,
        active: true,
        updated_at: now,
      })
      .where(eq(userPreference.key, input.key))
      .run();
  } else {
    db.insert(userPreference)
      .values({
        key: input.key,
        value: input.value,
        set_explicitly: input.setExplicitly ?? true,
        set_via_message_id: input.setViaMessageId ?? null,
        active: true,
      })
      .run();
  }
  return get(input.key)!;
}

export function deactivate(key: string): void {
  const db = getDb();
  db.update(userPreference)
    .set({ active: false, updated_at: new Date().toISOString() })
    .where(eq(userPreference.key, key))
    .run();
}

/** Render active preferences as a short text block for prompt injection. */
export function renderForPrompt(): string {
  const prefs = listActive();
  if (prefs.length === 0) return "";
  const lines = prefs.map((p) => `  - ${p.key}: ${p.value}`);
  return `Operator preferences (apply to every reply):\n${lines.join("\n")}`;
}
