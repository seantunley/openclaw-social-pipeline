/**
 * Layer 5 — LLM call governor.
 *
 * Wraps every model call in the engine. Four mechanisms:
 *
 *   1. Spend cap (rolling window, $ cost).
 *      Default: $10 / hour aggregated across all callers.
 *      Per-caller override via `perCaller` config.
 *
 *   2. Volume cap (call count, rolling window).
 *      Default: 1000 calls / hour aggregated.
 *      Per-caller override.
 *
 *   3. Lifetime counter (kills runaway loops).
 *      Process-local counter; resets on restart. Default: 50_000.
 *
 *   4. Prompt dedupe cache.
 *      LRU keyed by sha256(model + prompt). Default size 256, TTL 5 min.
 *      Returns the cached completion instead of making a new call. Eats
 *      tight loops like the one that exhausts a runaway lifetime budget.
 *
 * All persistent counters live in `spend_window` (rolling) and
 * `llm_call_log` (per-call audit). The SOC reads from both.
 *
 * Soft-cap semantics: a call ALREADY OVER budget is blocked. A call
 * UNDER budget proceeds, even if the result tips us over — we record the
 * post-call cost and the next caller sees the new total. Hard limits at
 * the call level require pre-call token estimation we don't always have.
 */

import { randomUUID, createHash } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import type Database from "better-sqlite3";
import { getDb, getSqlite } from "../../db/index.js";
import { spendWindow, llmCallLog, agentRuntimeState } from "../../db/schema.js";

/**
 * Read a numeric override from agent_runtime_state. Returns the fallback if
 * the row is missing, empty, or non-numeric. Lookups are direct PK reads —
 * fast enough to do on every governor precheck.
 */
function readRuntimeNumber(key: string, fallback: number): number {
  try {
    const row = getDb()
      .select()
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.key, key))
      .get() as { value: string } | undefined;
    if (!row) return fallback;
    const n = Number(row.value);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CallerLimits {
  /** USD per rolling window. */
  spendUsdPerWindow?: number;
  /** Call count per rolling window. */
  callsPerWindow?: number;
}

export interface GovernorConfig {
  /** Window size in seconds. Same window applies to spend + volume. */
  windowSeconds: number;
  /** Defaults applied when a caller is not in `perCaller`. */
  defaults: Required<CallerLimits>;
  /** Per-caller overrides. Key is the `caller` field of recordCall(). */
  perCaller: Record<string, CallerLimits>;
  /** Hard cap on total calls per process. Kills runaway loops. */
  callsLifetimePerProcess: number;
  /** Max entries in the dedupe LRU. */
  dedupeCacheSize: number;
  /** Dedupe entry TTL in ms. */
  dedupeCacheTtlMs: number;
}

const DEFAULT_CONFIG: GovernorConfig = {
  windowSeconds: 3600,
  defaults: {
    spendUsdPerWindow: 10,
    callsPerWindow: 1000,
  },
  perCaller: {},
  callsLifetimePerProcess: 50_000,
  dedupeCacheSize: 256,
  dedupeCacheTtlMs: 5 * 60 * 1000,
};

/**
 * Read overrides from env vars. Each is optional; defaults apply when unset.
 *   AGENT_SPEND_USD_PER_HOUR
 *   AGENT_CALLS_PER_HOUR
 *   AGENT_CALLS_LIFETIME
 *   AGENT_DEDUPE_CACHE_SIZE
 *   AGENT_DEDUPE_CACHE_TTL_MS
 */
function readEnvOverrides(base: GovernorConfig): GovernorConfig {
  const env = (k: string) => process.env[k];
  const num = (k: string, fallback: number) => {
    const v = env(k);
    if (!v) return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    ...base,
    defaults: {
      spendUsdPerWindow: num("AGENT_SPEND_USD_PER_HOUR", base.defaults.spendUsdPerWindow),
      callsPerWindow: num("AGENT_CALLS_PER_HOUR", base.defaults.callsPerWindow),
    },
    callsLifetimePerProcess: num("AGENT_CALLS_LIFETIME", base.callsLifetimePerProcess),
    dedupeCacheSize: num("AGENT_DEDUPE_CACHE_SIZE", base.dedupeCacheSize),
    dedupeCacheTtlMs: num("AGENT_DEDUPE_CACHE_TTL_MS", base.dedupeCacheTtlMs),
  };
}

// ---------------------------------------------------------------------------
// Per-model pricing (USD per 1M tokens). Used to compute cost from token
// counts returned by the provider. Keep in sync with provider price pages.
// Models not listed here get cost = 0 (governor still tracks call count).
// ---------------------------------------------------------------------------

interface PriceEntry {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICE_TABLE: Record<string, PriceEntry> = {
  // Anthropic — Nov 2025 list prices
  "claude-opus-4-7": { inputPer1M: 15, outputPer1M: 75 },
  "claude-opus-4-6": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-4-5-20251001": { inputPer1M: 0.8, outputPer1M: 4 },
  // OpenAI hypotheticals (matches the engine's model refs)
  "gpt-5": { inputPer1M: 10, outputPer1M: 30 },
  "gpt-5-nano": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-5.5": { inputPer1M: 12, outputPer1M: 36 },
  "gpt-image-2": { inputPer1M: 5, outputPer1M: 40 },
};

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  // Allow refs like "anthropic/claude-opus-4-7" or "openai/gpt-5-nano".
  const bare = model.includes("/") ? model.split("/").slice(-1)[0] : model;
  const entry = PRICE_TABLE[bare] ?? PRICE_TABLE[model];
  if (!entry) return 0;
  return (promptTokens * entry.inputPer1M + completionTokens * entry.outputPer1M) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Dedupe cache (LRU + TTL, in-memory)
// ---------------------------------------------------------------------------

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
}

class LruCache<T = unknown> {
  private map = new Map<string, CacheEntry<T>>();

  constructor(
    private maxEntries: number,
    private ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // bump recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (!oldest) break;
      this.map.delete(oldest);
    }
  }
}

// ---------------------------------------------------------------------------
// Governor
// ---------------------------------------------------------------------------

export interface GovernedCallOpts<T> {
  caller: string;
  model: string;
  /** A stable string representation of the prompt for dedupe + audit. */
  prompt: string;
  /** Performs the actual LLM call. */
  run: () => Promise<T>;
  /** Extract (promptTokens, completionTokens) from the result for cost calc. */
  tokensFromResult?: (result: T) => { promptTokens: number; completionTokens: number };
  /** When the call site already knows the cost (e.g., fal.ai pricing), use this. */
  costUsdFromResult?: (result: T) => number;
  /** Disable dedupe for this call (streaming, time-sensitive, etc.). */
  noCache?: boolean;
}

export type GovernorDecision =
  | { allow: true; cached: false }
  | { allow: true; cached: true; value: unknown }
  | { allow: false; reason: string };

export class CallGovernor {
  private config: GovernorConfig;
  private cache: LruCache;
  private lifetimeCount = 0;

  constructor(config?: Partial<GovernorConfig>) {
    this.config = readEnvOverrides({ ...DEFAULT_CONFIG, ...config });
    this.cache = new LruCache(this.config.dedupeCacheSize, this.config.dedupeCacheTtlMs);
  }

  /**
   * Returns whether a call may proceed AND if a cached result is available.
   * Should be invoked before issuing the upstream LLM request.
   */
  precheck(caller: string, model: string, prompt: string, noCache = false): GovernorDecision {
    // 1. Lifetime cap — kill runaway loops first.
    if (this.lifetimeCount >= this.config.callsLifetimePerProcess) {
      return {
        allow: false,
        reason: `lifetime call cap reached (${this.config.callsLifetimePerProcess}) — restart the process or raise AGENT_CALLS_LIFETIME`,
      };
    }

    // 2. Dedupe cache check (unless explicitly disabled).
    if (!noCache) {
      const key = this.cacheKey(model, prompt);
      const hit = this.cache.get(key);
      if (hit !== undefined) {
        return { allow: true, cached: true, value: hit };
      }
    }

    // 3. Rolling window stats — read from DB.
    const stats = this.readWindowStats(caller);
    const limits = this.limitsFor(caller);

    if (stats.totalCostUsd >= limits.spendUsdPerWindow) {
      return {
        allow: false,
        reason: `spend cap reached for caller=${caller}: $${stats.totalCostUsd.toFixed(4)} >= $${limits.spendUsdPerWindow.toFixed(2)} per ${this.config.windowSeconds}s`,
      };
    }
    if (stats.callCount >= limits.callsPerWindow) {
      return {
        allow: false,
        reason: `volume cap reached for caller=${caller}: ${stats.callCount} >= ${limits.callsPerWindow} calls per ${this.config.windowSeconds}s`,
      };
    }

    return { allow: true, cached: false };
  }

  /**
   * Record a completed call. Updates the rolling-window aggregate and writes
   * an llm_call_log row. The dedupe cache is populated here too — only
   * successful calls are cached.
   */
  recordCall(opts: {
    caller: string;
    model: string;
    prompt: string;
    response?: unknown;
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
    durationMs: number;
    error?: string;
    cachedResponse?: boolean;
  }): void {
    this.lifetimeCount++;
    const cost = opts.costUsd ?? estimateCostUsd(
      opts.model,
      opts.promptTokens ?? 0,
      opts.completionTokens ?? 0,
    );

    // Audit row
    try {
      const db = getDb();
      db.insert(llmCallLog)
        .values({
          id: randomUUID(),
          caller: opts.caller,
          model: opts.model,
          prompt_tokens: opts.promptTokens ?? 0,
          completion_tokens: opts.completionTokens ?? 0,
          cost_usd: cost,
          prompt_hash: this.promptHash(opts.model, opts.prompt),
          cached_response: opts.cachedResponse ?? false,
          duration_ms: opts.durationMs,
          error: opts.error ?? null,
        })
        .run();
    } catch (err) {
      // Don't let logging failures kill the caller. Surface but proceed.
      // Per [feedback_no_silent_failure.md] we still log this somewhere.
      console.error("[call-governor] failed to persist llm_call_log row:", (err as Error).message);
    }

    // Rolling-window aggregate (only on non-cached calls — cached calls cost $0)
    if (!opts.cachedResponse && !opts.error) {
      this.bumpWindow(opts.caller, cost, 1);
    }

    // Cache (only on success, only non-error, only if response is captured)
    if (!opts.error && opts.response !== undefined && !opts.cachedResponse) {
      this.cache.set(this.cacheKey(opts.model, opts.prompt), opts.response);
    }
  }

  /**
   * Convenience wrapper: precheck + run + record. The block path returns
   * the reason; callers can decide whether to escalate the user.
   */
  async governed<T>(opts: GovernedCallOpts<T>): Promise<
    | { ok: true; result: T; cached: boolean }
    | { ok: false; reason: string }
  > {
    const decision = this.precheck(opts.caller, opts.model, opts.prompt, opts.noCache);
    if (!decision.allow) return { ok: false, reason: decision.reason };
    if (decision.cached) {
      this.recordCall({
        caller: opts.caller,
        model: opts.model,
        prompt: opts.prompt,
        durationMs: 0,
        cachedResponse: true,
      });
      return { ok: true, result: decision.value as T, cached: true };
    }

    const t0 = Date.now();
    try {
      const result = await opts.run();
      const duration = Date.now() - t0;
      const tokens = opts.tokensFromResult?.(result);
      const cost = opts.costUsdFromResult?.(result);
      this.recordCall({
        caller: opts.caller,
        model: opts.model,
        prompt: opts.prompt,
        response: result,
        promptTokens: tokens?.promptTokens,
        completionTokens: tokens?.completionTokens,
        costUsd: cost,
        durationMs: duration,
      });
      return { ok: true, result, cached: false };
    } catch (err) {
      const duration = Date.now() - t0;
      this.recordCall({
        caller: opts.caller,
        model: opts.model,
        prompt: opts.prompt,
        durationMs: duration,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  // ── internal helpers ────────────────────────────────────────────

  private limitsFor(caller: string): Required<CallerLimits> {
    const o = this.config.perCaller[caller] ?? {};
    // Hot overrides from agent_runtime_state (SOC operator console). These
    // take precedence over env / config defaults but NOT over per-caller
    // config. Cheap: one row each, primary-key lookups.
    const liveSpend = readRuntimeNumber("spend_usd_per_hour", NaN);
    const liveCalls = readRuntimeNumber("calls_per_hour", NaN);
    return {
      spendUsdPerWindow:
        o.spendUsdPerWindow ??
        (Number.isFinite(liveSpend) ? liveSpend : this.config.defaults.spendUsdPerWindow),
      callsPerWindow:
        o.callsPerWindow ??
        (Number.isFinite(liveCalls) ? liveCalls : this.config.defaults.callsPerWindow),
    };
  }

  private cacheKey(model: string, prompt: string): string {
    return this.promptHash(model, prompt);
  }

  private promptHash(model: string, prompt: string): string {
    return createHash("sha256").update(`${model} ${prompt}`).digest("hex");
  }

  /**
   * Read the rolling-window stats for a caller. The window is fronted by a
   * single `spend_window` row whose `window_start` we roll forward when it
   * ages out. Cheaper than scanning llm_call_log on every check.
   */
  private readWindowStats(caller: string): { totalCostUsd: number; callCount: number } {
    const db = getDb();
    const sqlite = getSqlite();
    const id = `caller:${caller}:global`;
    const nowMs = Date.now();
    const windowStartCutoff = new Date(nowMs - this.config.windowSeconds * 1000).toISOString();

    let row = db.select().from(spendWindow).where(eq(spendWindow.id, id)).get();
    if (!row) {
      // initialize
      const init = {
        id,
        caller,
        window_start: new Date(nowMs).toISOString(),
        window_seconds: this.config.windowSeconds,
        total_cost_usd: 0,
        call_count: 0,
      };
      db.insert(spendWindow).values(init).run();
      row = db.select().from(spendWindow).where(eq(spendWindow.id, id)).get()!;
    }
    if (row.window_start < windowStartCutoff) {
      // roll the window — reset counters
      sqlite
        .prepare(
          `UPDATE spend_window SET window_start = ?, total_cost_usd = 0, call_count = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        )
        .run(new Date(nowMs).toISOString(), id);
      return { totalCostUsd: 0, callCount: 0 };
    }
    return { totalCostUsd: Number(row.total_cost_usd ?? 0), callCount: Number(row.call_count ?? 0) };
  }

  private bumpWindow(caller: string, addCost: number, addCalls: number): void {
    const sqlite = getSqlite();
    const id = `caller:${caller}:global`;
    sqlite
      .prepare(
        `UPDATE spend_window SET
           total_cost_usd = total_cost_usd + ?,
           call_count = call_count + ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .run(addCost, addCalls, id);
  }
}

// ---------------------------------------------------------------------------
// Singleton — engine code grabs this rather than constructing per-call.
// Tests can construct their own instance via `new CallGovernor(...)`.
// ---------------------------------------------------------------------------

let _singleton: CallGovernor | null = null;
export function getCallGovernor(): CallGovernor {
  if (!_singleton) _singleton = new CallGovernor();
  return _singleton;
}

// Test seam: reset between tests.
export function resetCallGovernor(): void {
  _singleton = null;
}
