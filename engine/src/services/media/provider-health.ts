/**
 * Provider health / circuit breaker for image generation.
 *
 * Tracks consecutive failures per provider with a cooldown window. After
 * `OPEN_AFTER_FAILS` consecutive failures (default 2), the provider is
 * marked OPEN (unhealthy) and skipped for `COOLDOWN_MS` (default 5 min).
 * After cooldown it goes HALF_OPEN — the next call is allowed through to
 * probe recovery; success closes the breaker (back to healthy), failure
 * re-opens for another cooldown.
 *
 * The operator never has to know what's broken — the orchestrator just
 * skips OPEN providers. We do persist a short status string per provider
 * so the SOC / Operations page can show "fal: cooling down (3m left,
 * last error: 401 Unauthorized)".
 *
 * Failure classification — some error classes shouldn't open the breaker:
 *   - safety filter rejections → don't open (the next attempt with a
 *     softened prompt might succeed)
 *   - retryable network blips → don't open immediately
 *   - 401 / 403 / quota / auth → open fast (no point retrying with the
 *     same broken credentials in the same minute)
 */

export type ProviderName = "fal" | "openai" | "replicate" | "stability";

type BreakerState = "closed" | "open" | "half_open";

interface ProviderRecord {
  state: BreakerState;
  consecutiveFails: number;
  openedAt: number | null;
  lastError: string;
  lastErrorAt: number | null;
}

const records = new Map<ProviderName, ProviderRecord>();

const OPEN_AFTER_FAILS = Number(process.env.IMAGE_BREAKER_FAILS) || 2;
const COOLDOWN_MS = Number(process.env.IMAGE_BREAKER_COOLDOWN_MS) || 5 * 60 * 1000;

function get(name: ProviderName): ProviderRecord {
  let rec = records.get(name);
  if (!rec) {
    rec = { state: "closed", consecutiveFails: 0, openedAt: null, lastError: "", lastErrorAt: null };
    records.set(name, rec);
  }
  return rec;
}

/**
 * Decide if a provider call should even be attempted right now. Returns
 * true when healthy or when the cooldown has elapsed (HALF_OPEN probe).
 */
export function shouldAttempt(name: ProviderName): boolean {
  const rec = get(name);
  if (rec.state === "closed" || rec.state === "half_open") return true;
  if (rec.state === "open" && rec.openedAt !== null) {
    if (Date.now() - rec.openedAt >= COOLDOWN_MS) {
      rec.state = "half_open"; // allow one probe
      return true;
    }
  }
  return false;
}

/** Classification — when an error is "fatal" the breaker opens immediately. */
function isFatalError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("unauthorized") ||
    m.includes("401") ||
    m.includes("forbidden") ||
    m.includes("403") ||
    m.includes("quota") ||
    m.includes("billing") ||
    m.includes("invalid api key") ||
    m.includes("api key") ||
    m.includes("authentication")
  );
}

/** Safety filter rejections should NOT open the breaker. */
function isSafetyRejection(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("safety system") || m.includes("safety_violations");
}

export function recordSuccess(name: ProviderName): void {
  const rec = get(name);
  rec.state = "closed";
  rec.consecutiveFails = 0;
  rec.openedAt = null;
  // Keep lastError around as historical info; UI can show "last 4xx
  // 12 min ago" but state=healthy.
}

export function recordFailure(name: ProviderName, error: string): void {
  const rec = get(name);
  rec.lastError = error.slice(0, 400);
  rec.lastErrorAt = Date.now();
  if (isSafetyRejection(error)) {
    // Safety filter rejection — don't open the breaker. The retry-with-
    // softening loop in the orchestrator handles this without giving up
    // on the provider entirely.
    return;
  }
  if (isFatalError(error)) {
    // Auth / quota errors open immediately. No point burning more calls.
    rec.state = "open";
    rec.openedAt = Date.now();
    rec.consecutiveFails += 1;
    return;
  }
  rec.consecutiveFails += 1;
  if (rec.consecutiveFails >= OPEN_AFTER_FAILS) {
    rec.state = "open";
    rec.openedAt = Date.now();
  }
}

/** Snapshot for the SOC / Operations page. */
export interface ProviderHealth {
  provider: ProviderName;
  state: BreakerState;
  consecutiveFails: number;
  cooldownRemainingMs: number;
  lastError: string;
  lastErrorAt: number | null;
}

export function getHealthSnapshot(): ProviderHealth[] {
  const out: ProviderHealth[] = [];
  for (const [name, rec] of records.entries()) {
    const cooldownRemaining =
      rec.state === "open" && rec.openedAt !== null
        ? Math.max(0, COOLDOWN_MS - (Date.now() - rec.openedAt))
        : 0;
    out.push({
      provider: name,
      state: rec.state,
      consecutiveFails: rec.consecutiveFails,
      cooldownRemainingMs: cooldownRemaining,
      lastError: rec.lastError,
      lastErrorAt: rec.lastErrorAt,
    });
  }
  return out;
}

/** Test seam — reset all breakers (for unit tests / operator manual reset). */
export function resetAll(): void {
  records.clear();
}
