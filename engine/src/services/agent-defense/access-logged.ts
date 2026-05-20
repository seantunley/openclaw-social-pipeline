/**
 * Layer 6 (access control) with SOC persistence.
 *
 * The pure `guardPath` / `guardUrl` in access-control.ts return verdicts
 * with no side effects — they're easy to unit test. These wrappers add
 * the missing piece for the SOC: every DENIED check writes a
 * security_event row so the operator can see L6 activity in real time.
 *
 * Use the *Logged variants at every external call site that touches files
 * or URLs on the agent's behalf. Pure guards remain for tests + library code.
 */

import { randomUUID, createHash } from "node:crypto";
import { getDb } from "../../db/index.js";
import { securityEvent } from "../../db/schema.js";
import { guardPath, guardUrl, type PathGuardOptions, type PathGuardResult, type UrlGuardResult } from "./access-control.js";

export interface AccessLogContext {
  /** Component that requested the access — e.g. "skill.web-search.fetch". */
  caller: string;
  conversationId?: string;
  messageId?: string;
}

export interface LoggedPathResult {
  guard: PathGuardResult;
  securityEventId: string | null;
}

export interface LoggedUrlResult {
  guard: UrlGuardResult;
  securityEventId: string | null;
}

export function guardPathLogged(
  candidate: string,
  opts: PathGuardOptions,
  ctx: AccessLogContext,
): LoggedPathResult {
  const guard = guardPath(candidate, opts);
  if (guard.ok) return { guard, securityEventId: null };
  const securityEventId = persistL6Event({
    direction: "outbound",
    category: `l6_path/${guard.reason}`,
    reason: guard.detail,
    evidence: candidate,
    fullInput: candidate,
    ctx,
  });
  return { guard, securityEventId };
}

export async function guardUrlLogged(
  url: string,
  ctx: AccessLogContext,
): Promise<LoggedUrlResult> {
  const guard = await guardUrl(url);
  if (guard.ok) return { guard, securityEventId: null };
  const securityEventId = persistL6Event({
    direction: "outbound",
    category: `l6_url/${guard.reason}`,
    reason: guard.detail,
    evidence: url,
    fullInput: url,
    ctx,
  });
  return { guard, securityEventId };
}

interface L6EventArgs {
  direction: "inbound" | "outbound";
  category: string;
  reason: string;
  evidence: string;
  fullInput: string;
  ctx: AccessLogContext;
}

function persistL6Event(args: L6EventArgs): string | null {
  try {
    const db = getDb();
    const id = randomUUID();
    const inputHash = createHash("sha256").update(args.fullInput).digest("hex");
    db.insert(securityEvent)
      .values({
        id,
        input_source: "internal",
        direction: args.direction,
        verdict: "block",
        severity: "high",
        risk_score: 0.9,
        attack_categories: JSON.stringify([args.category]),
        reason: args.reason.slice(0, 800),
        evidence: args.evidence.slice(0, 500),
        input_hash: inputHash,
        full_input: args.fullInput.slice(0, 8192),
        conversation_id: args.ctx.conversationId ?? null,
        message_id: args.ctx.messageId ?? null,
        layer1_detections: JSON.stringify([{ category: args.category, source: args.ctx.caller }]),
        duration_ms: 0,
      })
      .run();
    return id;
  } catch (err) {
    console.error(
      `[agent-defense] failed to persist L6 event: ${(err as Error).message}`,
    );
    return null;
  }
}
