/**
 * Layer 6 — access control.
 *
 * Two pure-function guards used by tools that touch the filesystem or fetch
 * URLs on behalf of the agent. These run before the operation, fail closed,
 * and never make network calls themselves (except DNS for URL safety).
 *
 *   - guardPath(candidate, { roots, denyFilenames?, denyExtensions? })
 *     Ensures `candidate` resolves inside one of the allowed `roots` and
 *     does not match a sensitive filename or extension.
 *
 *   - guardUrl(url)
 *     Ensures scheme is http/https, hostname is publicly routable, and
 *     DNS resolution doesn't land on a private/internal range.
 *
 * Both return a discriminated result so callers can log and surface the
 * specific reason for any block.
 */

import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { resolve as resolvePath, normalize, sep, extname, basename } from "node:path";

// ---------------------------------------------------------------------------
// Path guard
// ---------------------------------------------------------------------------

/**
 * Filenames that should never be read or written by an agent tool — even when
 * they sit inside an allowed root. Match is case-insensitive against the full
 * basename. Extend per project.
 */
const DEFAULT_DENY_FILENAMES = new Set<string>([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".gitconfig",
  ".bash_history",
  ".zsh_history",
  ".python_history",
  ".node_repl_history",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "authorized_keys",
  "known_hosts",
  "auth.json",
  "credentials",
  "credentials.json",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "wp-config.php",
  ".gnupg",
  ".aws",
  ".ssh",
]);

/**
 * Extensions that are sensitive regardless of name. Lowercase, with leading
 * dot.
 */
const DEFAULT_DENY_EXTENSIONS = new Set<string>([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".kdbx",
  ".crt", // borderline; treat as sensitive to be safe
]);

export interface PathGuardOptions {
  /** One or more directory roots inside which the candidate must resolve. */
  roots: string[];
  /** Override / extend the default deny list of filenames. */
  denyFilenames?: Set<string>;
  /** Override / extend the default deny list of extensions. */
  denyExtensions?: Set<string>;
  /** When true, allow paths matching the deny lists if explicitly listed here. */
  allowFilenames?: Set<string>;
}

export type PathGuardResult =
  | { ok: true; resolved: string; root: string }
  | {
      ok: false;
      reason:
        | "outside_root"
        | "sensitive_filename"
        | "sensitive_extension"
        | "empty_path";
      detail: string;
    };

/**
 * Verify that `candidate` resolves inside one of `opts.roots` and isn't a
 * sensitive filename / extension. Does NOT touch the filesystem. Symlinks
 * are NOT resolved here — callers that follow links must re-verify after
 * resolving with `fs.realpath`.
 */
export function guardPath(candidate: string, opts: PathGuardOptions): PathGuardResult {
  if (!candidate || typeof candidate !== "string") {
    return { ok: false, reason: "empty_path", detail: "empty or non-string path" };
  }

  if (opts.roots.length === 0) {
    return { ok: false, reason: "outside_root", detail: "no roots configured" };
  }

  const denyFilenames = opts.denyFilenames ?? DEFAULT_DENY_FILENAMES;
  const denyExtensions = opts.denyExtensions ?? DEFAULT_DENY_EXTENSIONS;
  const allowFilenames = opts.allowFilenames ?? new Set<string>();

  const resolved = resolvePath(candidate);
  const resolvedNorm = normalize(resolved);

  // Containment: resolved path must be one of the roots or live underneath one.
  // We compare with a trailing separator on the root to avoid `/foo` matching
  // `/foo-bar` as a prefix.
  const matchedRoot = opts.roots.find((root) => {
    const r = normalize(resolvePath(root));
    if (resolvedNorm === r) return true;
    const rWithSep = r.endsWith(sep) ? r : r + sep;
    return resolvedNorm.startsWith(rWithSep);
  });

  if (!matchedRoot) {
    return {
      ok: false,
      reason: "outside_root",
      detail: `${resolvedNorm} not inside any of [${opts.roots.join(", ")}]`,
    };
  }

  const name = basename(resolvedNorm).toLowerCase();
  if (denyFilenames.has(name) && !allowFilenames.has(name)) {
    return {
      ok: false,
      reason: "sensitive_filename",
      detail: `filename '${name}' is on the deny list`,
    };
  }

  const ext = extname(resolvedNorm).toLowerCase();
  if (ext && denyExtensions.has(ext)) {
    return {
      ok: false,
      reason: "sensitive_extension",
      detail: `extension '${ext}' is on the deny list`,
    };
  }

  // Also catch any *segment* on the path that matches a sensitive directory
  // name (.ssh, .aws, .gnupg). Stops traversal into a sensitive dir tree.
  const segments = resolvedNorm.split(sep);
  for (const seg of segments) {
    const segLower = seg.toLowerCase();
    if (denyFilenames.has(segLower) && !allowFilenames.has(segLower)) {
      return {
        ok: false,
        reason: "sensitive_filename",
        detail: `path traverses sensitive directory '${seg}'`,
      };
    }
  }

  return { ok: true, resolved: resolvedNorm, root: normalize(resolvePath(matchedRoot)) };
}

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/** Hostnames that should never be reached regardless of DNS. */
const DENY_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.amazonaws.com",
  "169.254.169.254",
  "metadata.azure.com",
]);

const DENY_HOSTNAME_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa"];

export type UrlGuardResult =
  | { ok: true; url: string; resolvedAddresses: string[] }
  | {
      ok: false;
      reason:
        | "invalid_url"
        | "bad_scheme"
        | "denied_hostname"
        | "dns_failed"
        | "private_address";
      detail: string;
    };

/**
 * Validate a URL is safe for the agent to fetch. Resolves DNS and rejects
 * any answer that lands on a private / loopback / link-local / multicast
 * range. Costs one DNS lookup; suitable for per-request checks but cache
 * the result if you're about to retry.
 */
export async function guardUrl(url: string): Promise<UrlGuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    return { ok: false, reason: "invalid_url", detail: (err as Error).message };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      ok: false,
      reason: "bad_scheme",
      detail: `scheme '${parsed.protocol}' is not http or https`,
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (DENY_HOSTNAMES.has(host)) {
    return { ok: false, reason: "denied_hostname", detail: `host '${host}' is on the deny list` };
  }
  for (const suffix of DENY_HOSTNAME_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return {
        ok: false,
        reason: "denied_hostname",
        detail: `host '${host}' ends with internal suffix '${suffix}'`,
      };
    }
  }

  // If the host is already a literal IP, check it directly. Otherwise resolve.
  const literalIpVersion = isIP(host);
  let addresses: string[];
  if (literalIpVersion) {
    addresses = [host];
  } else {
    try {
      const results = await dns.lookup(host, { all: true, verbatim: false });
      addresses = results.map((r) => r.address);
      if (addresses.length === 0) {
        return { ok: false, reason: "dns_failed", detail: `no addresses for ${host}` };
      }
    } catch (err) {
      return { ok: false, reason: "dns_failed", detail: (err as Error).message };
    }
  }

  for (const addr of addresses) {
    if (isPrivateAddress(addr)) {
      return {
        ok: false,
        reason: "private_address",
        detail: `${host} resolves to private/internal address ${addr}`,
      };
    }
  }

  return { ok: true, url: parsed.toString(), resolvedAddresses: addresses };
}

// ---------------------------------------------------------------------------
// Private address detection (RFC 1918 + loopback + link-local + multicast +
// reserved + CGNAT + IPv6 equivalents)
// ---------------------------------------------------------------------------

function isPrivateAddress(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) return isPrivateV4(addr);
  if (v === 6) return isPrivateV6(addr);
  // Not a recognized IP literal — treat as suspicious (fail closed).
  return true;
}

function isPrivateV4(addr: string): boolean {
  const parts = addr.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // malformed — fail closed
  }
  const [a, b] = parts;
  // 0.0.0.0/8 — "this network"
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (includes cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 192.168.0.0/16, 198.18.0.0/15,
  // 198.51.100.0/24, 203.0.113.0/24, 240.0.0.0/4, 255.255.255.255 — collapsed:
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 192 && b === 88 && parts[2] === 99) return true; // 192.88.99.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a === 198 && b === 51 && parts[2] === 100) return true; // 198.51.100.0/24
  if (a === 203 && b === 0 && parts[2] === 113) return true; // 203.0.113.0/24
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function isPrivateV6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true; // unspecified
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
  if (lower.startsWith("fe80")) return true; // fe80::/10 link-local
  if (lower.startsWith("ff")) return true; // ff00::/8 multicast
  // ::ffff:0:0/96 — IPv4-mapped. Extract the embedded v4 and check it.
  const v4mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isPrivateV4(v4mapped[1]);
  return false;
}
