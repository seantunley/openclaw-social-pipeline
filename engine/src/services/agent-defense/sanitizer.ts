/**
 * Layer 1 — deterministic input sanitizer.
 *
 * Synchronous, no LLM calls, no network. Takes untrusted text and runs it
 * through a pipeline of normalizers + decoders + signature detectors, then
 * returns:
 *   - cleaned: a normalized representation safe to forward to Layer 2
 *   - detections: every signature that fired, with category + evidence
 *   - stats: counts to inform the entry-point quarantine decision
 *
 * Pipeline order matters. Decoders run BEFORE phrase signatures so a
 * base64-encoded "ignore previous instructions" is decoded first and the
 * phrase regex sees plain text. NFKC + homoglyph map run BEFORE leetspeak
 * collapse so unicode math-italic letters fold to ASCII first.
 *
 * Hard caps are applied to every loop to prevent decode-bomb attacks:
 *  - MAX_DECODE_ITERATIONS — limits nested encoding decode passes
 *  - MAX_DECODED_LENGTH    — refuses to expand beyond a multiple of input
 *
 * Designed against attack categories observed in:
 *   github.com/elder-plinius/L1B3RT4S
 *   github.com/elder-plinius/P4RS3LT0NGV3
 *   TOKEN80M8 / TOKENADE wallet-drainer payloads
 */

import {
  PHRASE_SIGNATURES,
  ENCODING_TRIGGERS,
  INVISIBLE_CHARS_RE,
  TAG_CHARS_RE,
  CONTROL_CHARS_RE,
  RTL_OVERRIDE_RE,
  HOMOGLYPH_MAP,
  LEET_MAP,
  type AttackCategory,
  type Signature,
} from "./signatures.js";

const MAX_DECODE_ITERATIONS = 4;
const MAX_DECODED_LENGTH_MULTIPLE = 8; // refuse decoding that expands beyond 8x

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Detection {
  category: AttackCategory;
  signature: string;
  severity: "low" | "medium" | "high" | "critical";
  /** Position in the cleaned text where the match occurred, if applicable. */
  position?: { start: number; end: number };
  /** Up-to-200-char excerpt; redacted of any embedded secrets. */
  evidence: string;
  /** Where the detection happened in the pipeline. */
  stage:
    | "invisible"
    | "tag_chars"
    | "rtl_override"
    | "control_chars"
    | "homoglyph"
    | "leetspeak"
    | "decode_base64"
    | "decode_hex"
    | "decode_binary"
    | "decode_rot13"
    | "phrase";
}

export interface SanitizerResult {
  /** The text after normalization + stripping. Safe to forward to Layer 2. */
  cleaned: string;
  /** Every decoded variant we examined. Useful for the SOC drill-down. */
  decodedVariants: string[];
  /** Detections fired during this pass. */
  detections: Detection[];
  /** Aggregate stats — input to entry-point quarantine logic. */
  stats: {
    inputLength: number;
    cleanedLength: number;
    invisibleStripped: number;
    tagCharsStripped: number;
    controlCharsStripped: number;
    rtlOverrideStripped: number;
    homoglyphsReplaced: number;
    decodeIterations: number;
    highestSeverity: "none" | "low" | "medium" | "high" | "critical";
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run the full sanitizer pipeline. Pure function; safe to call concurrently.
 */
export function sanitize(input: string): SanitizerResult {
  const inputLength = input.length;
  const detections: Detection[] = [];
  const decodedVariants: string[] = [];

  let invisibleStripped = 0;
  let tagCharsStripped = 0;
  let controlCharsStripped = 0;
  let rtlOverrideStripped = 0;
  let homoglyphsReplaced = 0;

  // ── strip RTL override first; it disguises everything downstream ──────
  let working = input.replace(RTL_OVERRIDE_RE, () => {
    rtlOverrideStripped++;
    return "";
  });
  if (rtlOverrideStripped > 0) {
    detections.push({
      category: "rtl_override",
      signature: "stego.rtl_override",
      severity: "high",
      stage: "rtl_override",
      evidence: `${rtlOverrideStripped} RTL-override characters stripped`,
    });
  }

  // ── strip tag-block characters (used for invisible-prompt smuggling) ──
  working = working.replace(TAG_CHARS_RE, () => {
    tagCharsStripped++;
    return "";
  });
  if (tagCharsStripped > 0) {
    detections.push({
      category: "tag_steganography",
      signature: "stego.tag_chars",
      severity: "critical",
      stage: "tag_chars",
      evidence: `${tagCharsStripped} Unicode Tag characters stripped (U+E0000..U+E007F range — used to hide instructions invisibly)`,
    });
  }

  // ── strip zero-width / invisible spaces ───────────────────────────────
  working = working.replace(INVISIBLE_CHARS_RE, () => {
    invisibleStripped++;
    return "";
  });
  if (invisibleStripped > 8) {
    // small counts (<= 8) can be incidental from copy-paste / Apple Pages
    detections.push({
      category: "zerowidth_stego",
      signature: "stego.zero_width",
      severity: "high",
      stage: "invisible",
      evidence: `${invisibleStripped} zero-width / invisible characters stripped`,
    });
  }

  // ── strip C0/C1 control characters except tab/newline/cr ──────────────
  working = working.replace(CONTROL_CHARS_RE, (m) => {
    if (m === "\t" || m === "\n" || m === "\r") return m;
    controlCharsStripped++;
    return "";
  });
  if (controlCharsStripped > 0) {
    detections.push({
      category: "control_chars",
      signature: "stego.control_chars",
      severity: "medium",
      stage: "control_chars",
      evidence: `${controlCharsStripped} C0/C1 control characters stripped`,
    });
  }

  // ── Unicode NFKC + homoglyph map ──────────────────────────────────────
  const normalized = working.normalize("NFKC");
  let homo = "";
  for (let i = 0; i < normalized.length; ) {
    const cp = normalized.codePointAt(i)!;
    const replacement = HOMOGLYPH_MAP.get(cp);
    if (replacement !== undefined) {
      homo += replacement;
      homoglyphsReplaced++;
    } else {
      homo += String.fromCodePoint(cp);
    }
    i += cp > 0xffff ? 2 : 1;
  }
  if (homoglyphsReplaced >= 3) {
    // 1-2 homoglyphs can be legit names. >= 3 suggests deliberate disguise.
    detections.push({
      category: "unicode_homoglyph",
      signature: "stego.homoglyph",
      severity: "high",
      stage: "homoglyph",
      evidence: `${homoglyphsReplaced} homoglyph characters replaced (Cyrillic / Greek / math-alphanumeric look-alikes)`,
    });
  }

  // ── leetspeak collapse — operates on a *copy* used only for matching ──
  const collapsed = collapseLeet(homo);
  if (collapsed !== homo) {
    // we don't replace `homo` — leetspeak collapse is too lossy for forward
    // pass; we use the collapsed variant only as an extra signature surface.
    decodedVariants.push(collapsed);
  }

  // ── decode loop: peel base encodings, ROT cipher, etc. ────────────────
  const decodeResult = decodeLoop(homo, decodedVariants);
  for (const d of decodeResult.detections) detections.push(d);

  // ── phrase signatures across all variants ────────────────────────────
  const variantsToScan = [homo, collapsed, ...decodedVariants];
  for (const v of variantsToScan) {
    for (const sig of PHRASE_SIGNATURES) {
      const m = sig.pattern.exec(v);
      if (m) {
        // de-dup: if we already detected this signature, skip.
        if (detections.some((d) => d.signature === sig.id)) continue;
        detections.push({
          category: sig.category,
          signature: sig.id,
          severity: sig.severity,
          stage: "phrase",
          position: { start: m.index, end: m.index + m[0].length },
          evidence: snippet(v, m.index, m.index + m[0].length),
        });
      }
    }
  }

  // ── aggregate ─────────────────────────────────────────────────────────
  const highestSeverity = highestSev(detections);
  return {
    cleaned: homo,
    decodedVariants,
    detections,
    stats: {
      inputLength,
      cleanedLength: homo.length,
      invisibleStripped,
      tagCharsStripped,
      controlCharsStripped,
      rtlOverrideStripped,
      homoglyphsReplaced,
      decodeIterations: decodeResult.iterations,
      highestSeverity,
    },
  };
}

// ---------------------------------------------------------------------------
// Decode loop
// ---------------------------------------------------------------------------

interface DecodeResult {
  detections: Detection[];
  iterations: number;
}

function decodeLoop(text: string, sink: string[]): DecodeResult {
  const detections: Detection[] = [];
  let current = text;
  let iterations = 0;
  let didDecode = true;

  while (didDecode && iterations < MAX_DECODE_ITERATIONS) {
    didDecode = false;
    iterations++;

    for (const m of current.matchAll(ENCODING_TRIGGERS.base64)) {
      const decoded = tryBase64(m[0]);
      if (decoded && !isBinaryGarbage(decoded) && decoded.length <= current.length * MAX_DECODED_LENGTH_MULTIPLE) {
        sink.push(decoded);
        detections.push({
          category: "encoded_payload_base64",
          signature: "encoded.base64",
          severity: "medium",
          stage: "decode_base64",
          evidence: `base64-decoded ${m[0].length} chars → ${decoded.length} chars`,
        });
        didDecode = true;
        current = current.replace(m[0], decoded);
        break; // restart loop with new content
      }
    }
    if (didDecode) continue;

    for (const m of current.matchAll(ENCODING_TRIGGERS.hex)) {
      const decoded = tryHex(m[0]);
      if (decoded && !isBinaryGarbage(decoded) && decoded.length <= current.length * MAX_DECODED_LENGTH_MULTIPLE) {
        sink.push(decoded);
        detections.push({
          category: "encoded_payload_hex",
          signature: "encoded.hex",
          severity: "medium",
          stage: "decode_hex",
          evidence: `hex-decoded ${m[0].length} chars → ${decoded.length} chars`,
        });
        didDecode = true;
        current = current.replace(m[0], decoded);
        break;
      }
    }
    if (didDecode) continue;

    for (const m of current.matchAll(ENCODING_TRIGGERS.binary)) {
      const decoded = tryBinary(m[0]);
      if (decoded && !isBinaryGarbage(decoded) && decoded.length <= current.length * MAX_DECODED_LENGTH_MULTIPLE) {
        sink.push(decoded);
        detections.push({
          category: "encoded_payload_binary",
          signature: "encoded.binary",
          severity: "medium",
          stage: "decode_binary",
          evidence: `binary-decoded ${m[0].length} bits → ${decoded.length} chars`,
        });
        didDecode = true;
        current = current.replace(m[0], decoded);
        break;
      }
    }
  }

  // ROT13 / ROT47: try once at the end on the whole string. Heuristic — if
  // the ROT13-decoded form contains many more dictionary attack-phrases
  // than the original, surface a detection and add to variants.
  const rotted = rot13(current);
  if (rotted !== current) {
    let rotHits = 0;
    for (const sig of PHRASE_SIGNATURES) {
      if (sig.pattern.test(rotted)) rotHits++;
    }
    let origHits = 0;
    for (const sig of PHRASE_SIGNATURES) {
      if (sig.pattern.test(current)) origHits++;
    }
    if (rotHits > origHits) {
      sink.push(rotted);
      detections.push({
        category: "encoded_payload_rot",
        signature: "encoded.rot13",
        severity: "high",
        stage: "decode_rot13",
        evidence: `ROT13 decode surfaced ${rotHits - origHits} additional attack-phrase signature(s)`,
      });
    }
  }

  return { detections, iterations };
}

// ---------------------------------------------------------------------------
// Decoders. Each returns null on failure — never throws. The sanitizer
// treats failures as "this wasn't actually encoded data" and moves on.
// ---------------------------------------------------------------------------

function tryBase64(s: string): string | null {
  try {
    // Buffer.from(..., "base64") tolerates invalid characters silently, so we
    // sanity-check the result by re-encoding and comparing lengths.
    const buf = Buffer.from(s, "base64");
    if (buf.length === 0) return null;
    const reenc = buf.toString("base64").replace(/=+$/, "");
    const stripped = s.replace(/=+$/, "");
    if (reenc.toLowerCase() !== stripped.toLowerCase()) return null;
    const out = buf.toString("utf-8");
    return out;
  } catch {
    return null;
  }
}

function tryHex(s: string): string | null {
  const clean = s.replace(/\s/g, "");
  if (clean.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/i.test(clean)) return null;
  try {
    const out = Buffer.from(clean, "hex").toString("utf-8");
    return out;
  } catch {
    return null;
  }
}

function tryBinary(s: string): string | null {
  const clean = s.replace(/\s/g, "");
  if (clean.length % 8 !== 0) return null;
  if (!/^[01]+$/.test(clean)) return null;
  let out = "";
  for (let i = 0; i < clean.length; i += 8) {
    const byte = parseInt(clean.substring(i, i + 8), 2);
    if (byte === 0 || (byte > 0 && byte < 9) || (byte > 13 && byte < 32) || byte > 126) {
      // non-printable ASCII; abort — probably not text
      return null;
    }
    out += String.fromCharCode(byte);
  }
  return out;
}

function rot13(s: string): string {
  return s.replace(/[a-z]/gi, (c) => {
    const code = c.charCodeAt(0);
    const base = code < 91 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isBinaryGarbage(s: string): boolean {
  // Heuristic: if more than 25% of the bytes are non-printable, treat as
  // garbage (not actually text being smuggled).
  let nonPrintable = 0;
  for (let i = 0; i < s.length; i++) {
    const cc = s.charCodeAt(i);
    if (cc === 9 || cc === 10 || cc === 13) continue;
    if (cc < 32 || (cc >= 127 && cc < 160)) nonPrintable++;
  }
  return nonPrintable / Math.max(1, s.length) > 0.25;
}

function collapseLeet(s: string): string {
  let out = "";
  for (const ch of s) {
    out += LEET_MAP[ch] ?? ch;
  }
  return out;
}

function snippet(s: string, start: number, end: number, pad = 30): string {
  const a = Math.max(0, start - pad);
  const b = Math.min(s.length, end + pad);
  let ex = s.slice(a, b);
  // strip embedded private-key / EVM-addr / long secrets from evidence
  ex = ex.replace(/0x[a-f0-9]{40,}/gi, "0x…");
  ex = ex.replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}/g, "<jwt>");
  if (ex.length > 200) ex = ex.slice(0, 200) + "…";
  return ex;
}

function highestSev(detections: Detection[]): SanitizerResult["stats"]["highestSeverity"] {
  const order: Array<SanitizerResult["stats"]["highestSeverity"]> = [
    "none",
    "low",
    "medium",
    "high",
    "critical",
  ];
  let max: SanitizerResult["stats"]["highestSeverity"] = "none";
  for (const d of detections) {
    if (order.indexOf(d.severity) > order.indexOf(max)) max = d.severity;
  }
  return max;
}

// Re-export the signature type list for callers (frontier scanner uses it for
// its category enum, tests use it to assert known IDs exist).
export { PHRASE_SIGNATURES };
export type { AttackCategory, Signature };
