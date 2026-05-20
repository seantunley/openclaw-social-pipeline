/**
 * Attack signatures + decoded-content patterns used by Layer 1 (sanitizer)
 * and Layer 3 (outbound gate). All data; no logic. Easier to review +
 * extend in one place than spread across the layers.
 *
 * Sources:
 *  - github.com/elder-plinius/L1B3RT4S — jailbreak catalog ("jailbreak prompts" + chat-format spoofing)
 *  - github.com/elder-plinius/P4RS3LT0NGV3 — encoding/steganography techniques
 *  - github.com/TOKEN80M8 / TOKENADE — wallet-drainer payload patterns
 *
 * Every signature carries a category that maps to the SOC's
 * attack_categories field. Categories MUST stay stable — the dashboard and
 * trend analysis filter on them.
 */

export type AttackCategory =
  | "role_override"             // "ignore previous instructions", "you are DAN"
  | "chat_format_spoof"         // <|im_start|>, [INST], <s>[INST]
  | "system_tag_injection"      // <system>, <<SYS>>, ###system, #SYSTEM
  | "instruction_disregard"     // "disregard", "forget", "new instructions"
  | "policy_dissolution"        // "no restrictions", "uncensored", "bypass guidelines"
  | "developer_mode"            // "developer mode", "god mode", "jailbreak"
  | "encoded_payload_base64"    // long base64 likely hiding instructions
  | "encoded_payload_hex"       // long hex
  | "encoded_payload_binary"    // long 0/1 string with spaces or no
  | "encoded_payload_rot"       // rot13/47/etc.
  | "leetspeak_obfuscation"     // 1gn0r3 pr3v10us 1nstruct10ns
  | "zerowidth_stego"           // U+200B/U+200C/U+200D/U+FEFF text smuggling
  | "tag_steganography"         // \u{E0000}-\u{E007F} tag chars
  | "unicode_homoglyph"         // math-alphanumeric / fullwidth / fraktur lookalikes
  | "control_chars"             // backspace, vertical tab, etc.
  | "rtl_override"              // U+202E right-to-left override
  | "markdown_image_exfil"      // ![](https://attacker.tld/?d=...)
  | "external_url_exfil"        // bare URL with suspicious query params
  | "crypto_address_action"     // wallet address + "send"/"approve"/"sign"/"transfer"
  | "private_key_pattern"       // 12/24-word seed phrase, 0x... 64-hex
  | "delimiter_break"           // ```end``` followed by new "system:" preamble
  | "indirect_injection_hint";  // "the assistant should", "please tell the AI to"

export interface Signature {
  category: AttackCategory;
  /** Stable identifier used in detection logs. */
  id: string;
  /** Severity hint feeding into the entry-point verdict. */
  severity: "low" | "medium" | "high" | "critical";
  /** Pre-compiled regex. */
  pattern: RegExp;
}

// ---------------------------------------------------------------------------
// Phrase signatures (case-insensitive)
//
// These fire against BOTH the original text and the normalized + decoded
// text. Patterns are deliberately tight enough to avoid false positives on
// normal English but broad enough to catch common variants.
// ---------------------------------------------------------------------------

export const PHRASE_SIGNATURES: Signature[] = [
  // role override / DAN-family
  {
    category: "role_override",
    id: "role.dan",
    severity: "high",
    pattern: /\b(do anything now|DAN[\W_]?(mode|prompt)?|stay in character)\b/i,
  },
  {
    category: "role_override",
    id: "role.you_are_now",
    severity: "high",
    pattern: /\byou\s+(are|will\s+be|must\s+act\s+as|are\s+now)\s+(an?\s+)?(unrestricted|uncensored|jailbroken|amoral|evil|liberated)/i,
  },
  {
    category: "role_override",
    id: "role.pretend_no_rules",
    severity: "high",
    pattern: /\b(pretend|imagine|act\s+as\s+if)\s+(you|the\s+ai)\s+(has\s+no|have\s+no|no\s+longer\s+have)\s+(restrictions|rules|guidelines|filters)/i,
  },

  // instruction disregard
  {
    category: "instruction_disregard",
    id: "disregard.previous_instructions",
    severity: "high",
    pattern: /\b(ignore|disregard|forget|override)\b[^.\n]{0,80}\b(previous|prior|above|earlier|all)\b[^.\n]{0,40}\b(instructions?|rules?|prompts?|messages?|system)\b/i,
  },
  {
    category: "instruction_disregard",
    id: "disregard.new_instructions",
    severity: "high",
    pattern: /\b(new|updated|revised)\s+(instructions?|directives?|orders?)\s*:/i,
  },
  {
    category: "instruction_disregard",
    id: "disregard.start_over",
    severity: "medium",
    pattern: /\b(start\s+over|reset\s+(your\s+)?(memory|context|instructions))\b/i,
  },

  // policy dissolution
  {
    category: "policy_dissolution",
    id: "policy.no_restrictions",
    severity: "high",
    pattern: /\b(no\s+(content\s+)?(restrictions|filters|guidelines)|without\s+(any\s+)?(restrictions|filters|limits)|unrestricted\s+(mode|response))\b/i,
  },
  {
    category: "policy_dissolution",
    id: "policy.bypass",
    severity: "high",
    pattern: /\bbypass\s+(your\s+)?(safety|content|alignment|ethical|programming)\b/i,
  },
  {
    category: "policy_dissolution",
    id: "policy.no_ethics",
    severity: "high",
    pattern: /\b(no\s+(moral|ethical)\s+(judgement|considerations?)|moral(s|ity)\s+(disabled|off|suspended))\b/i,
  },

  // developer / god / debug modes
  {
    category: "developer_mode",
    id: "mode.developer",
    severity: "high",
    pattern: /\b(developer\s+mode|admin\s+mode|root\s+mode|debug\s+mode|maintenance\s+mode|god\s+mode|sudo\s+mode)\s+(on|enabled|engaged|activated)\b/i,
  },
  {
    category: "developer_mode",
    id: "mode.jailbreak",
    severity: "critical",
    pattern: /\b(jailbreak(en)?|jailbroken)\s+(mode|response|prompt|version)\b/i,
  },

  // chat-format spoofing
  {
    category: "chat_format_spoof",
    id: "spoof.im_start",
    severity: "critical",
    pattern: /<\|im_start\|>|<\|im_end\|>|<\|system\|>|<\|user\|>|<\|assistant\|>/i,
  },
  {
    category: "chat_format_spoof",
    id: "spoof.llama_inst",
    severity: "critical",
    pattern: /\[\/?INST\]|<<SYS>>|<<\/SYS>>/,
  },
  {
    category: "chat_format_spoof",
    id: "spoof.claude_human",
    severity: "high",
    pattern: /\n\s*(Human|Assistant)\s*:\s*$/m,
  },
  {
    category: "chat_format_spoof",
    id: "spoof.openai_message",
    severity: "high",
    pattern: /<\|endoftext\|>|<\|fim_(prefix|middle|suffix)\|>/i,
  },

  // system-tag injection
  {
    category: "system_tag_injection",
    id: "tag.system_xml",
    severity: "high",
    pattern: /<\s*system\s*>[\s\S]{0,500}<\s*\/\s*system\s*>/i,
  },
  {
    category: "system_tag_injection",
    id: "tag.markdown_system",
    severity: "medium",
    pattern: /^[#\s]*system\s*[:\-]\s/im,
  },

  // delimiter break ("---END---") followed by new preamble
  {
    category: "delimiter_break",
    id: "delim.end_marker",
    severity: "medium",
    pattern: /(```|---|===|\*\*\*)\s*end[^\n]{0,40}(```|---|===|\*\*\*)\s*\n[\s\S]{0,200}(system|new instructions|fresh prompt)/i,
  },

  // indirect-injection hints (content saying "tell the AI...")
  {
    category: "indirect_injection_hint",
    id: "indirect.tell_the_ai",
    severity: "medium",
    pattern: /\b(tell|instruct|direct|order)\s+(the\s+)?(assistant|ai|model|chatbot)\s+to\b/i,
  },
  {
    category: "indirect_injection_hint",
    id: "indirect.when_summarizing",
    severity: "medium",
    pattern: /\bwhen\s+(you|the\s+ai)\s+(summari[sz]e|read|process|encounter)\s+this/i,
  },

  // markdown image exfiltration: ![any](http(s)://host/?...)
  {
    category: "markdown_image_exfil",
    id: "exfil.markdown_image",
    severity: "high",
    pattern: /!\[[^\]]*\]\(\s*https?:\/\/[^\s)]+\?[^\s)]+\)/i,
  },

  // wallet-drainer signatures
  {
    category: "crypto_address_action",
    id: "wallet.evm_action",
    severity: "critical",
    pattern: /\b(send|approve|sign|transfer|drain|forward|move)\b[^.\n]{0,100}\b0x[a-f0-9]{40}\b/i,
  },
  {
    category: "crypto_address_action",
    id: "wallet.btc_action",
    severity: "critical",
    pattern: /\b(send|approve|sign|transfer|drain|forward|move)\b[^.\n]{0,100}\b([13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,89})\b/,
  },
  {
    category: "crypto_address_action",
    id: "wallet.sol_action",
    severity: "critical",
    pattern: /\b(send|approve|sign|transfer|drain|forward|move)\b[^.\n]{0,100}\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/,
  },
  {
    category: "private_key_pattern",
    id: "key.seed_phrase",
    severity: "critical",
    // 12 or 24 lowercase BIP-39-style words PRECEDED by an explicit label
    // like "seed phrase", "mnemonic", "recovery phrase", or "wallet seed".
    // The label is required because the bare regex (12+ short lowercase
    // words in a row) matches almost every casual English sentence — e.g.
    // "can you take the last run and create instagram and facebook posts"
    // was getting hard-blocked. Real seed-phrase exfiltration attempts
    // virtually always include the label, and the actual loss vector
    // (wallet drainer + EVM/BTC/SOL action signatures) is covered
    // separately above.
    pattern:
      /(?:seed\s*phrase|mnemonic(?:\s+phrase)?|recovery\s*phrase|wallet\s*seed|secret\s*phrase)[^.\n]{0,80}\b(?:[a-z]{3,10}\s+){11,23}[a-z]{3,10}\b/i,
  },
  {
    category: "private_key_pattern",
    id: "key.evm_priv",
    severity: "critical",
    pattern: /\b0x[a-f0-9]{64}\b/i,
  },
];

// ---------------------------------------------------------------------------
// Bulk-decoder triggers
//
// Used by the sanitizer to detect runs of suspiciously-encoded content. The
// payload length thresholds are tuned to avoid false-positives on short
// hex/base64 strings (file hashes, UUIDs, small URLs) while catching anything
// long enough to plausibly hide a prompt-injection instruction.
// ---------------------------------------------------------------------------

export const ENCODING_TRIGGERS = {
  /** Long unbroken base64 run (≥ 80 chars). */
  base64: /[A-Za-z0-9+/]{80,}={0,2}/g,
  /** Long unbroken hex run (≥ 120 chars). */
  hex: /(?:[0-9a-f]{2}\s?){60,}/gi,
  /** Long binary run (≥ 240 bits — covers 30+ ASCII chars). */
  binary: /(?:[01]{8}\s?){30,}/g,
  /** ROT13-encoded "ignore previous" or similar — the cipher inverts the
   *  attack phrases. Matched on decoded text rather than via regex on raw
   *  input, but we keep a marker phrase here for the sanitizer to spot. */
  rotMarker: /\b(vtaber\s+cerivbhf|vasbeznyl|cerivbhfyl)\b/i,
} as const;

// ---------------------------------------------------------------------------
// Invisible characters used for steganography. Stripped wholesale during
// normalization; counted toward the zerowidth_stego category if any were
// present.
// ---------------------------------------------------------------------------

export const INVISIBLE_CHARS_RE =
  /[​-‏‪-‮⁠-⁯﻿­͏ᅟᅠ឴឵᠋-᠎ㅤ]/g;

export const TAG_CHARS_RE = /[\u{E0000}-\u{E007F}]/gu;

export const CONTROL_CHARS_RE = /[ --]/g;

/** Unicode RTL override character — used to disguise text. */
export const RTL_OVERRIDE_RE = /[‮‭]/g;

// ---------------------------------------------------------------------------
// Homoglyph normalization map. Maps Unicode math-alphanumeric / fullwidth /
// regional-indicator / fraktur etc. ranges back to ASCII. Used after NFKC
// normalization to catch anything NFKC missed.
// ---------------------------------------------------------------------------

export function buildHomoglyphMap(): Map<number, string> {
  const m = new Map<number, string>();
  // Math alphanumeric letters (U+1D400..U+1D7FF) — most of these are folded
  // by NFKC, but a few are not. We map only the gaps via a small explicit
  // list rather than hand-rolling 1024 entries.
  // (Most ranges fold via NFKC; the explicit cases below survive it.)
  const extras: Array<[string, string]> = [
    // Mathematical italic small h (U+210E) is hand-out from NFKC.
    ["ℎ", "h"],
    // Letterlike Symbols block holdovers
    ["ℓ", "l"], ["ℯ", "e"], ["ℴ", "o"], ["ⅈ", "i"], ["ⅉ", "j"],
    ["ℰ", "E"], ["ℱ", "F"], ["ℳ", "M"], ["ℒ", "L"], ["ℛ", "R"],
    ["ℬ", "B"], ["ℋ", "H"], ["ℐ", "I"], ["ℙ", "P"], ["ℕ", "N"],
    ["ℝ", "R"], ["ℚ", "Q"], ["ℤ", "Z"],
    // Common Cyrillic homoglyphs (visually identical Latin letters in
    // English text are almost certainly disguise)
    ["а", "a"], ["е", "e"], ["о", "o"], ["р", "p"], ["с", "c"],
    ["х", "x"], ["у", "y"], ["А", "A"], ["В", "B"], ["Е", "E"],
    ["К", "K"], ["М", "M"], ["Н", "H"], ["О", "O"], ["Р", "P"],
    ["С", "C"], ["Т", "T"], ["Х", "X"],
    // Greek look-alikes
    ["Α", "A"], ["Β", "B"], ["Ε", "E"], ["Ζ", "Z"], ["Η", "H"],
    ["Ι", "I"], ["Κ", "K"], ["Μ", "M"], ["Ν", "N"], ["Ο", "O"],
    ["Ρ", "P"], ["Τ", "T"], ["Υ", "Y"], ["Χ", "X"],
    ["α", "a"], ["ε", "e"], ["ν", "v"], ["ο", "o"], ["ρ", "p"], ["τ", "t"], ["υ", "u"],
  ];
  for (const [src, dst] of extras) {
    m.set(src.codePointAt(0)!, dst);
  }
  return m;
}

export const HOMOGLYPH_MAP: Map<number, string> = buildHomoglyphMap();

// ---------------------------------------------------------------------------
// Leetspeak normalization. We collapse runs of digit-letter substitutions
// back to their letter form before running phrase signatures, so
// `1gn0r3 pr3v10us 1nstruct10ns` matches `ignore previous instructions`.
// ---------------------------------------------------------------------------

export const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "i",
  "+": "t",
};
