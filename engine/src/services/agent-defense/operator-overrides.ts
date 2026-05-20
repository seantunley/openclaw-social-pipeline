/**
 * Operator-imposed overrides on top of the L1-L6 layers.
 *
 *   - isInputHashBanned(hash)        SHA-256 hash bans (no expiry or with TTL).
 *   - hasCategoryBlocked(category)   Time-bounded blocks on a specific category.
 *
 * These are the kill-table extras the SOC operator console writes to. They
 * are consulted FIRST, before L1+L2 run, so even L1-clean inputs can be
 * stopped if the operator has banned them.
 */

import { eq, and, gt, sql } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { bannedInputHash, blockedCategory } from "../../db/schema.js";

/** True if this hash has an unexpired ban row. */
export function isInputHashBanned(hash: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .select()
    .from(bannedInputHash)
    .where(
      and(
        eq(bannedInputHash.hash, hash),
        sql`(${bannedInputHash.expires_at} IS NULL OR ${bannedInputHash.expires_at} > ${now})`,
      ),
    )
    .get();
  return !!row;
}

/** True if at least one unexpired block row covers this category. */
export function hasCategoryBlocked(category: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .select()
    .from(blockedCategory)
    .where(
      and(
        eq(blockedCategory.category, category),
        gt(blockedCategory.blocked_until, now),
      ),
    )
    .get();
  return !!row;
}
