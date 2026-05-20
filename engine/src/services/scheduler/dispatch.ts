/**
 * Action dispatcher — given an action_kind + action_payload from a fire,
 * run the corresponding pipeline tool and return the structured result.
 *
 * Why this lives separately from the worker: the same dispatch is invoked
 * from (a) the worker tick on a scheduled fire, and (b) the `runScheduleNow`
 * agent tool when the operator says "run that schedule now". Keeping it
 * pure (no DB writes, no logging beyond the return value) means both
 * callers get identical semantics.
 */

import { runPipelineTool, runPipelineMultiTool, scheduleMultiDayCampaignTool } from "../agent/tools/pipeline-tools.js";
import { llmGenerate } from "../pipeline/llm.js";

export type ScheduleActionKind =
  | "run_pipeline"
  | "run_pipeline_multi"
  | "research_only"
  | "schedule_multi_day_campaign";

export interface DispatchResult {
  /** Operator-friendly summary line — pasted into chat/Telegram notification. */
  summary: string;
  /** Primary run id when the action produced one (single-platform fires). */
  runId: string | null;
  /** All run ids produced by this fire (multi-platform / multi-day fan-outs). */
  runIds: string[];
  /** True when the action completed without throwing. False = some failure. */
  ok: boolean;
  /** Raw structured result for the dashboard's fire-detail drilldown. */
  raw: unknown;
}

/**
 * Run the action bound to a schedule.  Never throws — translates every
 * failure into ok=false + a summary line, so the worker can log and
 * surface the error rather than crashing the tick.
 */
export async function dispatchScheduleAction(
  kind: ScheduleActionKind,
  payload: Record<string, unknown>,
): Promise<DispatchResult> {
  try {
    switch (kind) {
      case "run_pipeline": {
        const res = await runPipelineTool(payload as never);
        return {
          summary:
            res.status === "completed"
              ? `${res.platform} pipeline OK — run ${res.runId}`
              : `${res.platform} pipeline FAILED — ${res.error ?? "unknown"}`,
          runId: res.runId || null,
          runIds: res.runId ? [res.runId] : [],
          ok: res.status === "completed",
          raw: res,
        };
      }
      case "run_pipeline_multi": {
        const res = await runPipelineMultiTool(payload as never);
        const ok = res.runs.every((r) => r.status === "completed");
        const ids = res.runs.map((r) => r.runId).filter(Boolean);
        return {
          summary: `multi-platform pipeline (${res.runs.length}): ` +
            res.runs.map((r) => `${r.platform}=${r.status}`).join(", "),
          runId: ids[0] ?? null,
          runIds: ids,
          ok,
          raw: res,
        };
      }
      case "schedule_multi_day_campaign": {
        const res = await scheduleMultiDayCampaignTool(payload as never);
        const ok = res.runs.every((r) => r.status === "completed");
        const ids = res.runs.map((r) => r.runId).filter(Boolean);
        return {
          summary: `multi-day campaign on ${res.platform} (${res.runs.length} days): ` +
            `${res.runs.filter((r) => r.status === "completed").length} ok, ` +
            `${res.runs.filter((r) => r.status === "failed").length} failed`,
          runId: ids[0] ?? null,
          runIds: ids,
          ok,
          raw: res,
        };
      }
      case "research_only": {
        // No tool wraps "research only" yet — call the LLM with the
        // research prompt template directly. Returns plain text the
        // operator can read in the chat notification.
        const topic = String(payload.topic ?? "").trim();
        const platform = String(payload.platform ?? "linkedin").trim();
        if (!topic) {
          return {
            summary: "research_only skipped — missing topic in payload",
            runId: null,
            runIds: [],
            ok: false,
            raw: payload,
          };
        }
        const research = await llmGenerate(
          "You are a social media research assistant. Produce concise research notes (~250 words) covering: audience, 3-5 specific recent citable facts, 2-3 content angles. Plain text only, no preamble.",
          `Topic: ${topic}\nPlatform: ${platform}`,
          { temperature: 0.4, maxTokens: 1500, caller: "scheduler.research_only" },
        );
        return {
          summary: `research notes for "${topic}" ready (${research.length} chars)`,
          runId: null,
          runIds: [],
          ok: true,
          raw: { topic, platform, research },
        };
      }
      default: {
        return {
          summary: `unknown action_kind: ${kind as string}`,
          runId: null,
          runIds: [],
          ok: false,
          raw: { kind, payload },
        };
      }
    }
  } catch (err) {
    return {
      summary: `action ${kind} threw: ${(err as Error).message}`,
      runId: null,
      runIds: [],
      ok: false,
      raw: { error: (err as Error).message, stack: (err as Error).stack },
    };
  }
}
