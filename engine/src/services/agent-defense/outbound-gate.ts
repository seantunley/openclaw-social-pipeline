/**
 * Layer 3 — outbound content gate.
 *
 * Synchronous, no LLM calls, no network. Runs on EVERY piece of text the
 * system is about to emit (chat replies, tool outputs we forward back to
 * the agent loop, webhook payloads, generated content). Catches:
 *
 *   - Leaked secrets (delegates to redaction.ts)
 *   - Internal filesystem paths
 *   - Surviving prompt-injection artifacts (delegates to sanitizer.ts
 *     phrase detection, since the agent should not be parroting attack
 *     phrases back to a user/webhook)
 *   - Data exfiltration via embedded image URLs with query params
 *   - Financial / crypto-wallet payloads (covered by redaction +
 *     sanitizer signatures)
 *
 * Returns a verdict the entry point or caller uses to decide whether to
 * send the message as-is, send the redacted version, or block.
 */

import { sanitize, type Detection } from "./sanitizer.js";
import { redact, type Redaction, type RedactionResult } from "./redaction.js";

// ---------------------------------------------------------------------------
// Internal path detection
//
// File-path leakage signals (1) the agent is being asked to exfiltrate
// internal state, or (2) an error message is leaking through unredacted.
// Either way it's a SOC-worthy outbound event.
// ---------------------------------------------------------------------------

const INTERNAL_PATH_PATTERNS: Array<{ id: string; re: RegExp; severity: "low" | "medium" | "high" | "critical" }> =
  [
    // Unix home dir paths (catches /home/foo/, /Users/foo/)
    { id: "path.unix_home", re: /\/(?:home|Users)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\-/]+/g, severity: "medium" },
    // Windows user paths (catches C:\Users\Foo\)
    { id: "path.windows_user", re: /[A-Z]:\\Users\\[A-Za-z0-9 _.-]+\\[A-Za-z0-9 _.\\-]+/g, severity: "medium" },
    // ~/ tilde-expanded home references
    { id: "path.tilde_home", re: /~\/(?:\.[\w-]+|[\w-]+\/[.\w/-]+)/g, severity: "low" },
    // System directories with sensitive contents
    { id: "path.etc", re: /\/etc\/(?:passwd|shadow|hosts|ssh\/|ssl\/|sudoers)/gi, severity: "high" },
    { id: "path.var_log", re: /\/var\/log\/[A-Za-z0-9_.-]+/g, severity: "medium" },
    { id: "path.proc", re: /\/proc\/(?:\d+\/(?:environ|cmdline|status|maps)|self\/(?:environ|cmdline))/g, severity: "high" },
    // Project-local secret-bearing files
    { id: "path.env_file", re: /(?:^|\/|\\)(\.env(?:\.[a-z]+)?)\b/g, severity: "high" },
    { id: "path.codex_auth", re: /(?:~|\$HOME|\/[Hh]ome\/[^/]+|[A-Z]:\\Users\\[^\\]+)\/?\.codex\/auth\.json/g, severity: "critical" },
    { id: "path.herenow_creds", re: /(?:~|\$HOME|\/[Hh]ome\/[^/]+|[A-Z]:\\Users\\[^\\]+)\/?\.herenow\/credentials/g, severity: "critical" },
    { id: "path.ssh_dir", re: /(?:~|\$HOME|\/[Hh]ome\/[^/]+|[A-Z]:\\Users\\[^\\]+)\/?\.ssh\/[A-Za-z0-9_.-]+/g, severity: "critical" },
    { id: "path.aws_creds", re: /(?:~|\$HOME|\/[Hh]ome\/[^/]+|[A-Z]:\\Users\\[^\\]+)\/?\.aws\/credentials/g, severity: "critical" },
  ];

// ---------------------------------------------------------------------------
// Image-URL exfiltration. Agent output forwarded to a chat surface that
// renders markdown may inadvertently fetch an attacker URL on the operator's
// behalf (browser-rendered ![]() loads images automatically). We flag any
// image whose target has query parameters or whose host is suspicious.
// ---------------------------------------------------------------------------

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi;
const HTML_IMG_RE = /<img\b[^>]*\bsrc\s*=\s*['"]?(https?:\/\/[^'"\s>]+)/gi;
const BARE_IMG_QS_RE = /https?:\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|tiff)\?[A-Za-z0-9=&%._-]+/gi;

// ---------------------------------------------------------------------------
// Categories the gate emits. Maps onto the SOC's attack_categories enum.
// ---------------------------------------------------------------------------

export type OutboundCategory =
  | "leaked_secret"
  | "internal_path"
  | "injection_artifact"
  | "image_url_exfil"
  | "financial_data";

export interface OutboundFinding {
  category: OutboundCategory;
  signature: string;
  severity: "low" | "medium" | "high" | "critical";
  position?: { start: number; end: number };
  evidence: string;
}

export interface OutboundGateResult {
  /** verdict: allow if no findings; review if low/medium findings only; block on high/critical. */
  verdict: "allow" | "review" | "block";
  /** Suggested replacement text — sanitizer-cleaned + redacted. */
  suggested: string;
  findings: OutboundFinding[];
  /** Full redaction details for SOC drill-down (already applied to `suggested`). */
  redactions: Redaction[];
  highestSeverity: "none" | "low" | "medium" | "high" | "critical";
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface OutboundGateOptions {
  /** Forwarded to redact(). Defaults to env-derived allowlist. */
  workEmailAllowlist?: Set<string>;
  redactDollarAmounts?: boolean;
  redactPhoneNumbers?: boolean;
}

export function scanOutbound(text: string, opts: OutboundGateOptions = {}): OutboundGateResult {
  const findings: OutboundFinding[] = [];

  // 1. Surviving injection artifacts. Run the sanitizer in scan mode and
  //    re-emit any high-severity detection that's "wrong" in output context
  //    (chat-format spoof, system tags, markdown image exfil, role override,
  //    delimiter break). Detections about the operator's input — leetspeak,
  //    homoglyph, control chars — are NOT outbound concerns.
  const san = sanitize(text);
  const OUTBOUND_RELEVANT_CATS = new Set([
    "chat_format_spoof",
    "system_tag_injection",
    "markdown_image_exfil",
    "delimiter_break",
    "role_override",
    "policy_dissolution",
    "developer_mode",
    "instruction_disregard",
  ]);
  for (const d of san.detections) {
    if (OUTBOUND_RELEVANT_CATS.has(d.category)) {
      findings.push({
        category: "injection_artifact",
        signature: d.signature,
        severity: d.severity,
        position: d.position,
        evidence: d.evidence,
      });
    }
  }

  // 2. Internal file paths.
  for (const rule of INTERNAL_PATH_PATTERNS) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      findings.push({
        category: "internal_path",
        signature: rule.id,
        severity: rule.severity,
        position: { start: m.index, end: m.index + m[0].length },
        evidence: m[0].length > 200 ? m[0].slice(0, 200) + "…" : m[0],
      });
    }
  }

  // 3. Image URL exfiltration. Markdown images, raw img tags, bare image
  //    URLs with query strings — all suspicious in outbound.
  const exfilHits = new Set<string>();
  collectExfil(text, MARKDOWN_IMAGE_RE, exfilHits, findings, "image.markdown");
  collectExfil(text, HTML_IMG_RE, exfilHits, findings, "image.html");
  collectExfil(text, BARE_IMG_QS_RE, exfilHits, findings, "image.bare_qs");

  // 4. Redaction pass — applies redactions to the text and gives us a list.
  const red: RedactionResult = redact(text, opts);
  for (const r of red.redactions) {
    const category: OutboundCategory =
      r.category.startsWith("api_key.") ||
      r.category === "email.personal" ||
      r.category === "phone.number"
        ? "leaked_secret"
        : "financial_data";
    findings.push({
      category,
      signature: `redact.${r.category}`,
      severity: redactionSeverity(r.category),
      position: { start: r.start, end: r.end },
      evidence: r.label,
    });
  }

  const highestSeverity = highestSev(findings);
  const verdict =
    highestSeverity === "critical" || highestSeverity === "high"
      ? "block"
      : highestSeverity === "medium" || highestSeverity === "low"
        ? "review"
        : "allow";

  return {
    verdict,
    suggested: red.redacted,
    findings,
    redactions: red.redactions,
    highestSeverity,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectExfil(
  text: string,
  re: RegExp,
  seen: Set<string>,
  findings: OutboundFinding[],
  sigId: string,
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const url = m[1] ?? m[0];
    if (seen.has(url)) continue;
    seen.add(url);
    // Severity: high if the URL has query params (active exfil); medium otherwise.
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      // ignore
    }
    const hasQuery = parsed ? parsed.search.length > 1 : false;
    findings.push({
      category: "image_url_exfil",
      signature: sigId,
      severity: hasQuery ? "high" : "medium",
      position: { start: m.index, end: m.index + m[0].length },
      evidence: url.length > 200 ? url.slice(0, 200) + "…" : url,
    });
  }
}

function redactionSeverity(category: Redaction["category"]): "low" | "medium" | "high" | "critical" {
  if (category.startsWith("api_key.")) return "critical";
  if (category === "email.personal") return "medium";
  if (category === "phone.number") return "medium";
  if (category === "money.amount") return "low";
  return "low";
}

function highestSev(findings: OutboundFinding[]): "none" | "low" | "medium" | "high" | "critical" {
  const order = ["none", "low", "medium", "high", "critical"] as const;
  let max: (typeof order)[number] = "none";
  for (const f of findings) {
    if (order.indexOf(f.severity) > order.indexOf(max)) max = f.severity;
  }
  return max;
}

// Re-exports for callers
export type { Redaction, RedactionResult, Detection };
