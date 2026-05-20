/**
 * Agent defense — public entry points.
 *
 * Two functions:
 *   - checkInbound(text, source, ctx)   chains Layer 1 → Layer 2.
 *   - checkOutbound(text, ctx)          runs Layer 3 (which already calls
 *                                       Layer 1's signature scan + Layer 4
 *                                       redaction internally).
 *
 * Both persist a `security_event` row for the SOC and return a normalized
 * result. The agent runtime calls these around every model interaction
 * and every external tool input.
 *
 * Layer 5 (call governor) and Layer 6 (access control) are NOT chained
 * here — they're used directly at the call sites that need them
 * (governor wraps every LLM call; access control wraps file/URL ops).
 */

import { randomUUID, createHash } from "node:crypto";
import { getDb } from "../../db/index.js";
import { securityEvent } from "../../db/schema.js";
import { sanitize, type SanitizerResult } from "./sanitizer.js";
import { scan as frontierScan, type InputSource, type ScannerVerdict } from "./frontier-scanner.js";
import { scanOutbound, type OutboundGateResult } from "./outbound-gate.js";

export type {
  InputSource,
  ScannerVerdict,
  SanitizerResult,
  OutboundGateResult,
};
export { sanitize, scanOutbound };
export { guardPath, guardUrl } from "./access-control.js";
export { guardPathLogged, guardUrlLogged } from "./access-logged.js";
export { isInputHashBanned, hasCategoryBlocked } from "./operator-overrides.js";
export { getCallGovernor, CallGovernor, estimateCostUsd } from "./call-governor.js";
export { redact } from "./redaction.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InboundContext {
  conversationId?: string;
  messageId?: string;
  /** Skip Layer 2 even when L1 fires. Useful for unit tests / dev mode. */
  skipFrontier?: boolean;
}

export interface InboundResult {
  /** Final decision after combining L1 + L2. */
  verdict: "allow" | "review" | "block";
  severity: "low" | "medium" | "high" | "critical";
  /** Forward this to the agent in place of the raw input. May equal raw if L1 made no changes. */
  cleaned: string;
  /** L1 detail (decoded variants, every signature that fired). */
  layer1: SanitizerResult;
  /** L2 detail. Null when frontier was skipped or short-circuited. */
  layer2: ScannerVerdict | null;
  /** The persisted security_event row id; null if persisting failed. */
  securityEventId: string | null;
  durationMs: number;
}

/**
 * Inbound defense — chain L1 → L2. Always persists a security_event.
 *
 * Decision logic:
 *  - L1 returns detections + cleaned text.
 *  - If L1's highest severity is "critical" (e.g., chat-format spoof, tag
 *    steganography, wallet drainer), block immediately. L2 is not consulted.
 *  - Otherwise call L2 with the cleaned text + L1 detections.
 *  - Final verdict = max( L1 implied verdict, L2 verdict ).
 */
export async function checkInbound(
  text: string,
  source: InputSource,
  ctx: InboundContext = {},
): Promise<InboundResult> {
  const t0 = Date.now();
  const layer1 = sanitize(text);
  const l1Severity = layer1.stats.highestSeverity;

  let layer2: ScannerVerdict | null = null;
  let verdict: "allow" | "review" | "block";
  let severity: "low" | "medium" | "high" | "critical";

  if (l1Severity === "critical") {
    // Hard block — no point spending an LLM call.
    verdict = "block";
    severity = "critical";
  } else if (ctx.skipFrontier) {
    verdict = severityToVerdict(l1Severity);
    severity = normaliseSeverity(l1Severity);
  } else {
    layer2 = await frontierScan({
      cleaned: layer1.cleaned,
      layer1Detections: layer1.detections,
      source,
    });
    // Combine: take the stricter of (L1 implied) and (L2 returned).
    const l1Implied = severityToVerdict(l1Severity);
    verdict = stricter(l1Implied, layer2.verdict);
    severity = combineSeverity(l1Severity, scoreToSeverity(layer2.risk_score));
  }

  const durationMs = Date.now() - t0;
  const eventId = await persistEvent({
    direction: "inbound",
    source,
    verdict,
    severity,
    layer1,
    layer2,
    durationMs,
    inputText: text,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
  });

  return {
    verdict,
    severity,
    cleaned: layer1.cleaned,
    layer1,
    layer2,
    securityEventId: eventId,
    durationMs,
  };
}

export interface OutboundContext {
  conversationId?: string;
  messageId?: string;
  workEmailAllowlist?: Set<string>;
  redactDollarAmounts?: boolean;
  redactPhoneNumbers?: boolean;
}

export interface OutboundResult {
  verdict: "allow" | "review" | "block";
  severity: "low" | "medium" | "high" | "critical";
  /** The text safe to send. Redactions already applied. */
  suggested: string;
  gate: OutboundGateResult;
  securityEventId: string | null;
  durationMs: number;
}

/**
 * Outbound defense — Layer 3 + Layer 4 (redaction is invoked by L3).
 * Always persists a security_event for the SOC.
 */
export async function checkOutbound(
  text: string,
  ctx: OutboundContext = {},
): Promise<OutboundResult> {
  const t0 = Date.now();
  const gate = scanOutbound(text, {
    workEmailAllowlist: ctx.workEmailAllowlist,
    redactDollarAmounts: ctx.redactDollarAmounts,
    redactPhoneNumbers: ctx.redactPhoneNumbers,
  });
  const durationMs = Date.now() - t0;
  const severity = gate.highestSeverity === "none" ? "low" : gate.highestSeverity;
  const eventId = await persistEvent({
    direction: "outbound",
    source: "internal",
    verdict: gate.verdict,
    severity,
    layer1: null,
    layer2: null,
    outbound: gate,
    durationMs,
    inputText: text,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
  });
  return {
    verdict: gate.verdict,
    severity,
    suggested: gate.suggested,
    gate,
    securityEventId: eventId,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Verdict math
// ---------------------------------------------------------------------------

function severityToVerdict(sev: "none" | "low" | "medium" | "high" | "critical"): "allow" | "review" | "block" {
  if (sev === "critical" || sev === "high") return "block";
  if (sev === "medium" || sev === "low") return "review";
  return "allow";
}

function normaliseSeverity(
  sev: "none" | "low" | "medium" | "high" | "critical",
): "low" | "medium" | "high" | "critical" {
  return sev === "none" ? "low" : sev;
}

function stricter(a: "allow" | "review" | "block", b: "allow" | "review" | "block"): "allow" | "review" | "block" {
  const order = { allow: 0, review: 1, block: 2 } as const;
  return order[a] >= order[b] ? a : b;
}

function combineSeverity(
  l1: "none" | "low" | "medium" | "high" | "critical",
  l2: "none" | "low" | "medium" | "high" | "critical",
): "low" | "medium" | "high" | "critical" {
  const order = ["none", "low", "medium", "high", "critical"] as const;
  const max = order[Math.max(order.indexOf(l1), order.indexOf(l2))];
  return max === "none" ? "low" : max;
}

function scoreToSeverity(score: number): "none" | "low" | "medium" | "high" | "critical" {
  if (score >= 0.85) return "critical";
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  if (score >= 0.15) return "low";
  return "none";
}

// ---------------------------------------------------------------------------
// SOC event persistence
// ---------------------------------------------------------------------------

interface PersistArgs {
  direction: "inbound" | "outbound";
  source: InputSource;
  verdict: "allow" | "review" | "block";
  severity: "low" | "medium" | "high" | "critical";
  layer1: SanitizerResult | null;
  layer2: ScannerVerdict | null;
  outbound?: OutboundGateResult;
  durationMs: number;
  inputText: string;
  conversationId?: string;
  messageId?: string;
}

async function persistEvent(args: PersistArgs): Promise<string | null> {
  try {
    const db = getDb();
    const id = randomUUID();
    const inputHash = createHash("sha256").update(args.inputText).digest("hex");

    // Collect attack categories from whichever layers ran.
    const cats = new Set<string>();
    for (const d of args.layer1?.detections ?? []) cats.add(d.category);
    for (const c of args.layer2?.attack_categories ?? []) cats.add(c);
    for (const f of args.outbound?.findings ?? []) cats.add(f.category);

    // Build a redacted evidence excerpt: pick the highest-severity detection
    // and emit its evidence. Keep under 500 chars.
    const evidence = pickEvidence(args);

    const reason =
      args.layer2?.reasoning ??
      (args.layer1 && args.layer1.detections.length > 0
        ? args.layer1.detections[0].evidence
        : args.outbound && args.outbound.findings.length > 0
          ? args.outbound.findings[0].evidence
          : "");

    db.insert(securityEvent)
      .values({
        id,
        input_source: args.source,
        direction: args.direction,
        verdict: args.verdict,
        severity: args.severity,
        risk_score: args.layer2?.risk_score ?? 0,
        attack_categories: JSON.stringify(Array.from(cats)),
        reason: reason.slice(0, 800),
        evidence: evidence.slice(0, 500),
        input_hash: inputHash,
        full_input: args.inputText.slice(0, 8192),
        conversation_id: args.conversationId ?? null,
        message_id: args.messageId ?? null,
        layer1_detections: JSON.stringify(
          (args.layer1?.detections ?? []).map((d) => ({
            signature: d.signature,
            category: d.category,
            severity: d.severity,
            stage: d.stage,
          })),
        ),
        layer2_verdict: args.layer2?.verdict ?? null,
        layer2_score: args.layer2?.risk_score ?? null,
        layer2_categories: args.layer2 ? JSON.stringify(args.layer2.attack_categories) : null,
        layer2_reasoning: args.layer2?.reasoning ?? null,
        duration_ms: args.durationMs,
      })
      .run();
    return id;
  } catch (err) {
    // Don't fail the inbound/outbound check because telemetry write failed.
    console.error("[agent-defense] failed to persist security_event:", (err as Error).message);
    return null;
  }
}

function pickEvidence(args: PersistArgs): string {
  if (args.layer2?.evidence) return args.layer2.evidence;
  const l1 = args.layer1?.detections ?? [];
  if (l1.length > 0) {
    const sorted = [...l1].sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity),
    );
    return sorted[0].evidence;
  }
  const outbound = args.outbound?.findings ?? [];
  if (outbound.length > 0) {
    const sorted = [...outbound].sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity),
    );
    return sorted[0].evidence;
  }
  return "";
}

function severityRank(s: "low" | "medium" | "high" | "critical"): number {
  return s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1;
}
