/**
 * Cadence calculator for recurring schedules. Given a structured cadence
 * payload, computes the next fire timestamp AT or AFTER a given anchor.
 *
 * Supported kinds (matches social_schedule.cadence_kind):
 *   - 'daily':   fires every day at {hour}:{minute}
 *   - 'weekly':  fires on each {day_of_week} (0=Sun..6=Sat) at {hour}:{minute}
 *   - 'monthly': fires on {day_of_month} (1..28; 31 falls back to last day) at {hour}:{minute}
 *   - 'cron':    fires according to {cron}, a 5-field cron expression
 *
 * Time zone semantics: every kind takes a {timezone} field. We compute the
 * wall-clock fire time in that zone, then convert to UTC for storage. This
 * way "every Monday 9am Europe/London" stays correct across DST.
 *
 * Why hand-roll rather than pull in node-cron / luxon: this scheduler is a
 * single binary, all the operators run in one TZ at a time, and the matrix
 * we actually support is small. Pulling in luxon for one helper is heavier
 * than maintaining ~120 lines of date math.
 */

import { CronExpressionParser } from "cron-parser";

// Thin shim to keep the call sites readable when the upstream API churned
// from parseExpression() (v4) to CronExpressionParser.parse() (v5).
function parseCron(
  expr: string,
  options?: { currentDate?: Date; tz?: string },
) {
  return CronExpressionParser.parse(expr, options);
}

export type CadenceKind = "daily" | "weekly" | "monthly" | "cron";

export interface CadencePayload {
  /** 0=Sunday … 6=Saturday. Required for weekly. */
  day_of_week?: number[];
  /** 1..31. Required for monthly. 29-31 cap to month length. */
  day_of_month?: number;
  /** 0..23. Required for daily/weekly/monthly. */
  hour?: number;
  /** 0..59. Required for daily/weekly/monthly. */
  minute?: number;
  /** IANA timezone (e.g. "Europe/London"). Defaults to UTC. */
  timezone?: string;
  /** Standard 5-field cron expression. Required when kind='cron'. */
  cron?: string;
}

/**
 * Compute the next fire timestamp AT OR AFTER `anchor` (default: now).
 * Returns an ISO string in UTC. Throws on malformed input — the caller
 * should reject the schedule rather than silently mis-fire.
 */
export function computeNextFire(
  kind: CadenceKind,
  payload: CadencePayload,
  anchor: Date = new Date(),
): string {
  const tz = payload.timezone || "UTC";

  if (kind === "cron") {
    if (!payload.cron) {
      throw new Error("cadence_kind='cron' requires payload.cron");
    }
    try {
      const it = parseCron(payload.cron, { currentDate: anchor, tz });
      const next = it.next().toISOString();
      if (!next) throw new Error("cron-parser returned null for next fire");
      return next;
    } catch (err) {
      throw new Error(
        `Invalid cron expression '${payload.cron}': ${(err as Error).message}`,
      );
    }
  }

  // For daily/weekly/monthly we delegate to cron-parser as well — it
  // supports timezones natively and saves us hand-rolling DST + month-end
  // arithmetic. We just translate the structured fields into a cron string.
  const minute = clamp(payload.minute ?? 0, 0, 59);
  const hour = clamp(payload.hour ?? 9, 0, 23);

  let cronExpr: string;
  if (kind === "daily") {
    cronExpr = `${minute} ${hour} * * *`;
  } else if (kind === "weekly") {
    const days =
      payload.day_of_week && payload.day_of_week.length > 0
        ? payload.day_of_week
            .map((d) => clamp(d, 0, 6))
            .sort((a, b) => a - b)
            .join(",")
        : "1"; // default Monday
    cronExpr = `${minute} ${hour} * * ${days}`;
  } else if (kind === "monthly") {
    // 29-31 may not exist in every month; cron-parser silently rolls
    // forward if the day doesn't exist, which is acceptable behaviour.
    const dom = clamp(payload.day_of_month ?? 1, 1, 31);
    cronExpr = `${minute} ${hour} ${dom} * *`;
  } else {
    throw new Error(`Unsupported cadence_kind '${kind as string}'`);
  }

  try {
    const it = parseCron(cronExpr, { currentDate: anchor, tz });
    const next = it.next().toISOString();
    if (!next) {
      throw new Error("cron-parser returned null for next fire");
    }
    return next;
  } catch (err) {
    throw new Error(
      `Could not compute next fire for ${kind} cadence (${cronExpr}): ${(err as Error).message}`,
    );
  }
}

/**
 * Validate a cadence payload BEFORE persisting — gives the operator
 * actionable errors at create time rather than at fire time.
 */
export function validateCadence(kind: CadenceKind, payload: CadencePayload): void {
  if (kind === "cron") {
    if (!payload.cron) throw new Error("cron cadence requires 'cron' field");
    try {
      parseCron(payload.cron);
    } catch (err) {
      throw new Error(`Invalid cron expression: ${(err as Error).message}`);
    }
    return;
  }
  if (payload.hour === undefined || payload.hour < 0 || payload.hour > 23) {
    throw new Error("cadence requires hour (0-23)");
  }
  if (payload.minute === undefined || payload.minute < 0 || payload.minute > 59) {
    throw new Error("cadence requires minute (0-59)");
  }
  if (kind === "weekly") {
    if (
      !payload.day_of_week ||
      payload.day_of_week.length === 0 ||
      payload.day_of_week.some((d) => d < 0 || d > 6)
    ) {
      throw new Error("weekly cadence requires day_of_week as 0-6 array");
    }
  }
  if (kind === "monthly") {
    if (
      payload.day_of_month === undefined ||
      payload.day_of_month < 1 ||
      payload.day_of_month > 31
    ) {
      throw new Error("monthly cadence requires day_of_month (1-31)");
    }
  }
}

/**
 * Human-readable summary of a cadence — used in agent replies + dashboard
 * table column so the operator can verify a schedule at a glance.
 */
export function describeCadence(kind: CadenceKind, payload: CadencePayload): string {
  const tz = payload.timezone || "UTC";
  const tzSuffix = tz === "UTC" ? "" : ` ${tz}`;
  if (kind === "cron") return `cron: ${payload.cron} (${tz})`;
  const hh = String(payload.hour ?? 0).padStart(2, "0");
  const mm = String(payload.minute ?? 0).padStart(2, "0");
  if (kind === "daily") return `every day at ${hh}:${mm}${tzSuffix}`;
  if (kind === "weekly") {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = (payload.day_of_week ?? [1]).map((d) => dayNames[d]).join("/");
    return `every ${days} at ${hh}:${mm}${tzSuffix}`;
  }
  if (kind === "monthly") {
    const ord = ordinal(payload.day_of_month ?? 1);
    return `monthly on the ${ord} at ${hh}:${mm}${tzSuffix}`;
  }
  return `${kind}: ${JSON.stringify(payload)}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}
