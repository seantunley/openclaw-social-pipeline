/**
 * Runtime state — singleton key/value config the operator hot-edits from the
 * SOC. The agent runtime + call governor + inbound check all consult this.
 *
 * Known keys (string values, parsed at read time):
 *   - "kill_switch"           "on" | "off"       Hard-suspend the agent.
 *   - "spend_usd_per_hour"    float, e.g. "2.0"  Overrides env at runtime.
 *   - "calls_per_hour"        int                Overrides env at runtime.
 *   - "calls_lifetime"        int                Overrides env at runtime.
 *
 * Updates take effect on the next call — there's no caching. Cheap because
 * the table has at most a handful of rows.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { agentRuntimeState } from "../../db/schema.js";

export interface RuntimeStateRow {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string;
}

export function get(key: string): string | null {
  const db = getDb();
  const row = db
    .select()
    .from(agentRuntimeState)
    .where(eq(agentRuntimeState.key, key))
    .get();
  return row ? (row as RuntimeStateRow).value : null;
}

export function set(key: string, value: string, updatedBy = "operator"): void {
  const db = getDb();
  const existing = get(key);
  const now = new Date().toISOString();
  if (existing !== null) {
    db.update(agentRuntimeState)
      .set({ value, updated_at: now, updated_by: updatedBy })
      .where(eq(agentRuntimeState.key, key))
      .run();
  } else {
    db.insert(agentRuntimeState)
      .values({ key, value, updated_by: updatedBy })
      .run();
  }
}

export function listAll(): RuntimeStateRow[] {
  const db = getDb();
  return db.select().from(agentRuntimeState).all() as RuntimeStateRow[];
}

export function isKillSwitchOn(): boolean {
  return (get("kill_switch") ?? "off") === "on";
}

/** Read a numeric override; returns fallback when key is absent or non-finite. */
export function getNumber(key: string, fallback: number): number {
  const raw = get(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
