/**
 * Layer 4 — redaction pipeline.
 *
 * Synchronous, no LLM calls, no network. Runs before any outbound message
 * leaves the system. Each rule has a `name`, a `match` regex, and a
 * `replacement` value or function. Rules run in order; first match wins
 * per character span. Output is the original text with sensitive spans
 * replaced + a `redactions` array describing what was removed.
 *
 * Pipeline order:
 *   1. API keys / tokens (most specific patterns first)
 *   2. JWTs
 *   3. AWS access keys + secrets
 *   4. Generic high-entropy bearer tokens (after named patterns)
 *   5. Personal email addresses (allowlist work domains through)
 *   6. Phone numbers
 *   7. Dollar amounts
 *
 * Tunable knobs (RedactOptions):
 *   - workEmailAllowlist: domains the operator considers "work" — emails to
 *     these domains pass through unredacted. Defaults pull from
 *     AGENT_WORK_EMAIL_DOMAINS env var (comma-separated).
 *   - redactDollarAmounts: default true; turn off if outputs legitimately
 *     contain quoted prices the operator wants the recipient to see.
 */

export type RedactionCategory =
  | "api_key.openai"
  | "api_key.anthropic"
  | "api_key.stripe"
  | "api_key.github"
  | "api_key.slack"
  | "api_key.google"
  | "api_key.aws_access"
  | "api_key.aws_secret"
  | "api_key.private_pem"
  | "api_key.jwt"
  | "api_key.bearer_generic"
  | "email.personal"
  | "phone.number"
  | "money.amount";

export interface Redaction {
  category: RedactionCategory;
  start: number;
  end: number;
  /** What was redacted, hashed for SOC display. Never the raw secret. */
  hash: string;
  /** A short non-sensitive label like "openai sk-...AbCd" (last 4 only). */
  label: string;
}

export interface RedactionResult {
  redacted: string;
  redactions: Redaction[];
}

export interface RedactOptions {
  /** Email domains considered "work" — these emails are NOT redacted. */
  workEmailAllowlist?: Set<string>;
  /** When false, money amounts pass through unredacted. */
  redactDollarAmounts?: boolean;
  /** When false, phone numbers pass through unredacted. */
  redactPhoneNumbers?: boolean;
}

const PERSONAL_EMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.co.jp",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "outlook.com",
  "outlook.co.uk",
  "live.com",
  "live.co.uk",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aim.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "tutanota.com",
  "tutanota.de",
  "tutamail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "fastmail.com",
  "fastmail.fm",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "qq.com",
  "163.com",
  "126.com",
  "zoho.com",
  "duck.com",
  "hey.com",
  "rediffmail.com",
  "btinternet.com",
  "sky.com",
  "talktalk.net",
  "virginmedia.com",
  "ntlworld.com",
  "blueyonder.co.uk",
  "rogers.com",
  "bell.net",
  "sympatico.ca",
  "shaw.ca",
  "comcast.net",
  "verizon.net",
  "att.net",
  "cox.net",
  "earthlink.net",
  "frontier.com",
  "centurylink.net",
  "telstra.com.au",
  "bigpond.com",
  "optusnet.com.au",
  "iinet.net.au",
  "free.fr",
  "orange.fr",
  "laposte.net",
  "wanadoo.fr",
  "sfr.fr",
  "web.de",
  "t-online.de",
  "freenet.de",
  "arcor.de",
  "libero.it",
  "tiscali.it",
  "virgilio.it",
]);

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface PatternRule {
  category: RedactionCategory;
  re: RegExp;
  /** Number of trailing chars to keep in the label (e.g. last 4 of an API key). */
  tailChars?: number;
  /** Label prefix shown in SOC. */
  labelPrefix: string;
  /** Replacement template; `…` placeholder ends up in the redacted string. */
  redacted: (raw: string) => string;
}

const PATTERNS: PatternRule[] = [
  // ── named API key patterns ─────────────────────────────────────────
  {
    category: "api_key.openai",
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g,
    tailChars: 4,
    labelPrefix: "openai",
    redacted: (raw) => `[REDACTED openai sk-…${raw.slice(-4)}]`,
  },
  {
    category: "api_key.anthropic",
    re: /\bsk-ant-[a-zA-Z0-9_-]{60,}\b/g,
    tailChars: 4,
    labelPrefix: "anthropic",
    redacted: (raw) => `[REDACTED anthropic sk-ant-…${raw.slice(-4)}]`,
  },
  {
    category: "api_key.stripe",
    re: /\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{20,}\b/g,
    tailChars: 4,
    labelPrefix: "stripe",
    redacted: (raw) => `[REDACTED stripe …${raw.slice(-4)}]`,
  },
  {
    category: "api_key.github",
    re: /\b(?:ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g,
    tailChars: 4,
    labelPrefix: "github",
    redacted: (raw) => `[REDACTED github …${raw.slice(-4)}]`,
  },
  {
    category: "api_key.slack",
    re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    tailChars: 4,
    labelPrefix: "slack",
    redacted: (raw) => `[REDACTED slack …${raw.slice(-4)}]`,
  },
  {
    category: "api_key.google",
    re: /\bAIza[0-9A-Za-z-_]{30,40}\b/g,
    tailChars: 4,
    labelPrefix: "google",
    redacted: (raw) => `[REDACTED google …${raw.slice(-4)}]`,
  },
  // ── AWS ───────────────────────────────────────────────────────────
  {
    category: "api_key.aws_access",
    re: /\b(?:AKIA|ASIA|AIDA|AGPA|AROA|AIPA|ANPA|ANVA|AKID)[A-Z0-9]{16}\b/g,
    tailChars: 4,
    labelPrefix: "aws access",
    redacted: (raw) => `[REDACTED aws-access …${raw.slice(-4)}]`,
  },
  {
    // AWS secret access keys are 40 chars of base64-alike. Need to be careful
    // not to match unrelated 40-char strings — require the word "secret" or
    // "aws_secret" nearby, or the well-known AWS access-key pair pattern.
    category: "api_key.aws_secret",
    re: /\baws[_-]?secret[_-]?(?:access[_-]?)?key\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    tailChars: 4,
    labelPrefix: "aws secret",
    redacted: (raw) => `[REDACTED aws-secret …]`,
  },
  // ── PEM / private keys ─────────────────────────────────────────────
  {
    category: "api_key.private_pem",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
    labelPrefix: "PEM private key",
    redacted: () => `[REDACTED PEM-PRIVATE-KEY]`,
  },
  // ── JWT ───────────────────────────────────────────────────────────
  {
    category: "api_key.jwt",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    tailChars: 4,
    labelPrefix: "JWT",
    redacted: (raw) => `[REDACTED jwt …${raw.slice(-4)}]`,
  },
  // ── Generic bearer tokens preceded by an auth keyword ────────────
  {
    category: "api_key.bearer_generic",
    re: /\b(?:Bearer|token|api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{24,})["']?/gi,
    tailChars: 4,
    labelPrefix: "bearer",
    redacted: (raw) => raw.replace(/[A-Za-z0-9_\-./+=]{24,}/, (m) => `[REDACTED bearer …${m.slice(-4)}]`),
  },
];

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

function shouldRedactEmail(domain: string, workAllowlist: Set<string>): boolean {
  const d = domain.toLowerCase();
  if (workAllowlist.has(d)) return false;
  if (PERSONAL_EMAIL_DOMAINS.has(d)) return true;
  // For unknown domains, default to passing through (treat as work).
  return false;
}

// ---------------------------------------------------------------------------
// Phone numbers — international + common US formats.
// Designed to avoid matching 4-digit years or generic numbers. We require
// either a + country prefix or a recognizable area-code pattern.
// ---------------------------------------------------------------------------

const PHONE_RES: RegExp[] = [
  // E.164 with explicit +
  /\+[1-9]\d{6,14}\b/g,
  // North American with parens: `(415) 555-1234`, `(415)555-1234`
  // No leading `\b` because `(` is non-word and `\b` can't sit between two
  // non-word chars (e.g. between space and `(` at the start of a sentence).
  /\(\d{3}\)\s?\d{3}[-.\s]\d{4}\b/g,
  // North American without parens: `415-555-1234`, `415.555.1234`, `415 555 1234`
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
  // International with at least TWO separators between groups — i.e. three+
  // digit clusters joined by space/dot/dash. This deliberately excludes
  // patterns like `20260519-1212` (date+time embedded in our run IDs) that
  // only have one separator. Real phone numbers in non-NA formats always
  // break into 3+ chunks: `020 7946 0958`, `+44 20 7946 0958`, etc.
  /\b\d{2,4}(?:[-.\s]\d{2,5}){2,}\b/g,
];

// ---------------------------------------------------------------------------
// Dollar amounts. Conservative — require currency symbol or trailing
// USD/EUR/GBP/etc. to avoid eating every number.
// ---------------------------------------------------------------------------

const MONEY_RES: RegExp[] = [
  // $1,234.56 / $1234 / £200 / €1.5k
  /(?:[$£€¥₹]\s?)\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?(?:\s?[km])?\b/gi,
  // 1,234.56 USD / 200 EUR / 1.5M GBP
  /\b\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?\s?(?:USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|CNY|INR|ZAR|BRL|MXN|SGD|HKD|KRW)\b/gi,
];

// ---------------------------------------------------------------------------
// Hashing helper (FNV-1a 32-bit) — fast non-cryptographic fingerprint for
// SOC labels. We never want to log the raw secret, but we DO want the
// operator to recognize "this same key was redacted 5 times today".
// ---------------------------------------------------------------------------

function fingerprint(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash = (hash ^ s.charCodeAt(i)) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function redact(input: string, opts: RedactOptions = {}): RedactionResult {
  const workAllowlist = opts.workEmailAllowlist ?? readWorkAllowlistFromEnv();
  const redactDollar = opts.redactDollarAmounts ?? true;
  const redactPhone = opts.redactPhoneNumbers ?? true;

  const redactions: Redaction[] = [];
  // We carry around an array of "kept" character indices to detect overlap;
  // simpler approach: build a mask. The string is rebuilt via splice list.
  type Span = { start: number; end: number; replacement: string; redaction: Redaction };
  const spans: Span[] = [];

  // pass 1: named patterns
  for (const rule of PATTERNS) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(input)) !== null) {
      const raw = m[0];
      const start = m.index;
      const end = start + raw.length;
      if (overlaps(spans, start, end)) continue;
      const replacement = rule.redacted(raw);
      const r: Redaction = {
        category: rule.category,
        start,
        end,
        hash: fingerprint(raw),
        label: `${rule.labelPrefix}${rule.tailChars ? ` …${raw.slice(-rule.tailChars)}` : ""}`,
      };
      spans.push({ start, end, replacement, redaction: r });
    }
  }

  // pass 2: personal emails
  {
    EMAIL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EMAIL_RE.exec(input)) !== null) {
      const raw = m[0];
      const domain = m[1];
      const start = m.index;
      const end = start + raw.length;
      if (overlaps(spans, start, end)) continue;
      if (!shouldRedactEmail(domain, workAllowlist)) continue;
      const replacement = `[REDACTED personal-email @${domain}]`;
      spans.push({
        start,
        end,
        replacement,
        redaction: {
          category: "email.personal",
          start,
          end,
          hash: fingerprint(raw),
          label: `personal email @${domain}`,
        },
      });
    }
  }

  // pass 3: phone numbers
  if (redactPhone) {
    for (const phoneRe of PHONE_RES) {
      phoneRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = phoneRe.exec(input)) !== null) {
        const raw = m[0];
        const start = m.index;
        const end = start + raw.length;
        if (overlaps(spans, start, end)) continue;
        // Skip if the run is entirely digits and looks like a long ID rather
        // than a phone — < 10 or > 15 digits when stripped.
        const digits = raw.replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 15) continue;
        // Skip when the digit run is embedded in a kebab-case identifier —
        // e.g. `linkedin-20260519-1212-ai-and-the-latest-trends-a77t`. We
        // look at the char immediately before / after the match: if either
        // is a `-` joining the digits to a word, this is an ID, not a phone.
        const before = start > 0 ? input[start - 1] : "";
        const after = end < input.length ? input[end] : "";
        const isKebabBefore =
          before === "-" && start >= 2 && /[a-z0-9]/i.test(input[start - 2]);
        const isKebabAfter =
          after === "-" && end + 1 < input.length && /[a-z0-9]/i.test(input[end + 1]);
        if (isKebabBefore || isKebabAfter) continue;
        spans.push({
          start,
          end,
          replacement: `[REDACTED phone …${digits.slice(-4)}]`,
          redaction: {
            category: "phone.number",
            start,
            end,
            hash: fingerprint(digits),
            label: `phone …${digits.slice(-4)}`,
          },
        });
      }
    }
  }

  // pass 4: money
  if (redactDollar) {
    for (const moneyRe of MONEY_RES) {
      moneyRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = moneyRe.exec(input)) !== null) {
        const raw = m[0];
        const start = m.index;
        const end = start + raw.length;
        if (overlaps(spans, start, end)) continue;
        spans.push({
          start,
          end,
          replacement: `[REDACTED amount]`,
          redaction: {
            category: "money.amount",
            start,
            end,
            hash: fingerprint(raw),
            label: `amount ${raw.replace(/\d/g, "#")}`,
          },
        });
      }
    }
  }

  // build output by replacing spans in order
  spans.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const s of spans) {
    out += input.slice(cursor, s.start);
    out += s.replacement;
    cursor = s.end;
    redactions.push(s.redaction);
  }
  out += input.slice(cursor);

  return { redacted: out, redactions };
}

function overlaps(spans: { start: number; end: number }[], start: number, end: number): boolean {
  for (const s of spans) {
    if (start < s.end && end > s.start) return true;
  }
  return false;
}

function readWorkAllowlistFromEnv(): Set<string> {
  const raw = process.env.AGENT_WORK_EMAIL_DOMAINS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}
