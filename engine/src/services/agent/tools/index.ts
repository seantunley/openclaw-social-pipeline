/**
 * Tools registry — object literal of zod-typed tools the agent can call.
 *
 * Per the original brief:
 *   "Each tool = name + description + zod-input + async run()."
 *   "Object literal of zod-typed functions. No registry, no SDK."
 *
 * Provider-agnostic: each tool is `{ description, schema, execute }`.
 * The runtime composes these into a prompt template that any text-completion
 * model can respond to (Anthropic via API key, OpenAI via Codex OAuth through
 * pi-ai — both routes already wired into engine/src/services/pipeline/llm.ts).
 *
 * Tool descriptions are intentionally specific (per the openclaw lesson
 * captured in the original brief: "Tool descriptions matter more than tool
 * count"). The "only use this when X" / "do not use during Y" hints belong
 * here, not in the system prompt.
 */

import type { z } from "zod";
import {
  runWebSearch,
  webSearchSchema,
} from "./web-search.js";
import {
  runPipelineTool,
  runPipelineSchema,
  runPipelineMultiTool,
  runPipelineMultiSchema,
  scheduleMultiDayCampaignTool,
  scheduleMultiDayCampaignSchema,
  rewriteForPlatformTool,
  rewriteForPlatformSchema,
  listRunsTool,
  listRunsSchema,
  getRunTool,
  getRunSchema,
  approveDraftTool,
  approveDraftSchema,
  editDraftTool,
  editDraftSchema,
} from "./pipeline-tools.js";
import { publishToPostizTool, publishToPostizSchema } from "./publish-tool.js";
import { askOperatorSchema } from "./ask-operator.js";
import {
  createScheduleTool,
  createScheduleSchema,
  listSchedulesTool,
  listSchedulesSchema,
  pauseScheduleTool,
  resumeScheduleTool,
  deleteScheduleTool,
  runScheduleNowTool,
  scheduleIdSchema,
  proposeScheduleTool,
  proposeScheduleSchema,
} from "./schedule-tools.js";

/** Sentinel tool name the runtime checks for — never executed, short-circuits to UI. */
export const ASK_OPERATOR_TOOL = "askOperator";

export interface AgentTool {
  description: string;
  schema: z.ZodTypeAny;
  execute: (input: unknown) => Promise<unknown>;
}

export type AgentToolset = Record<string, AgentTool>;

export function buildToolset(): AgentToolset {
  return {
    webSearch: {
      description:
        "Search the live web for current information. Use when the operator asks for current events, fresh stats, public people/products, or anything dated. " +
        "Do NOT use for things you can answer from operator preferences, project memory, or recent conversation. " +
        "Returns up to 5 results with title + URL + a short snippet. Always cite the URL when you use a result.",
      schema: webSearchSchema,
      execute: async (input) => runWebSearch(input as never),
    },

    runPipeline: {
      description:
        "Run the full content pipeline (research → SEO/GEO draft → humanize → image → ready-for-approval) for ONE platform. " +
        "Use ONLY when the operator explicitly asks for a new post and named exactly ONE platform. " +
        "If the operator named MULTIPLE platforms (e.g. 'instagram and facebook'), use runPipelineMulti instead — never call this tool in a loop. " +
        "If the operator wants to ADAPT an existing run for another platform (e.g. 'rewrite for instagram'), use rewriteForPlatform — it's 6-10× faster than re-running. " +
        "The `platform` argument is REQUIRED — never omit it. " +
        "Pass `format` when the operator named one: carousel (IG/FB/LinkedIn slide set, one image per slide), reel/short (vertical video, IG/TikTok/YT/FB), story (vertical, ephemeral), thread (X/Bluesky multi-post). Default is single. The tool validates platform+format and rejects invalid combinations (e.g. youtube+carousel) up front. " +
        "Pass `textOverlay: true` ONLY for carousel format AND when the operator asks for text rendered on the slides (phrases like 'text on each slide', 'text overlay', 'render the text', 'caption on the image', 'words on the picture'). Default false: images are pure visuals. " +
        "Takes 30-90 seconds; reply will block. Returns the run id, draft content, and image flag.",
      schema: runPipelineSchema,
      execute: async (input) => runPipelineTool(input as never),
    },

    runPipelineMulti: {
      description:
        "Run the full content pipeline for SEVERAL platforms in parallel. " +
        "Use when the operator names multiple platforms in one request: 'create instagram and facebook posts about X'. " +
        "Each platform gets its own run id + draft, dispatched concurrently — total time is roughly one platform's worth, not N times. " +
        "Pass `format` if the operator named one. Platforms that don't support it silently degrade to single (so 'carousel across [instagram, linkedin]' works on IG carousel and LinkedIn single without blocking the whole batch). " +
        "Returns an array of run results, one per platform. " +
        "Do NOT use to adapt an existing run; that's rewriteForPlatform. " +
        "Do NOT use for multi-day campaigns — that's scheduleMultiDayCampaign.",
      schema: runPipelineMultiSchema,
      execute: async (input) => runPipelineMultiTool(input as never),
    },

    scheduleMultiDayCampaign: {
      description:
        "Create N pipeline runs, ONE PER DAY, for a multi-day campaign. " +
        "Use when the operator asks for content across multiple days: " +
        "'a post every day next week' (7 days), 'every weekday for the next month' (20 weekdays), '5 posts over the next 2 weeks', etc. " +
        "Each day gets its own run with the date in the topic label (e.g. 'AI Trends — Mon May 25') so the operator can tell them apart in the Runs page. " +
        "Each run's scheduled_at is set so the scheduler fires it at the right time. " +
        "Pass `format` (e.g. carousel) if the operator wants every day to be the same format — validated against the platform once up front and rejected if invalid. " +
        "Optionally pass per-day topicHint to vary the angle (e.g. day 1: 'intro', day 2: 'case study', etc.). " +
        "Returns an array of {date, label, runId, status} — one per day.",
      schema: scheduleMultiDayCampaignSchema,
      execute: async (input) => scheduleMultiDayCampaignTool(input as never),
    },

    rewriteForPlatform: {
      description:
        "Adapt an EXISTING run's draft for one or more different platforms, fast (~5-10s per platform). " +
        "Use when the operator says 'rewrite the last run for X', 'adapt run abc for instagram', 'take that and make a tiktok version', etc. " +
        "Reuses the source run's research + concrete facts; only the surface copy is rewritten for the target platform's voice / length / hashtag conventions. " +
        "Pass `format` if the operator wants the adapted version in a specific format (e.g. 'turn the LinkedIn single into an Instagram carousel'). Platforms that can't take the format silently degrade to single. " +
        "Returns the new run id(s) — chain into approveDraft + publishToPostiz as needed. " +
        "Prefer this over runPipelineMulti when adapting an already-drafted post.",
      schema: rewriteForPlatformSchema,
      execute: async (input) => rewriteForPlatformTool(input as never),
    },

    listRuns: {
      description:
        "List the most recent pipeline runs with status + topic. Use to give the operator a status snapshot. " +
        "Filter by status (pending, running, completed, failed, approved, cancelled, scheduled) if asked.",
      schema: listRunsSchema,
      execute: async (input) => listRunsTool(input as never),
    },

    getRun: {
      description:
        "Fetch a single run's full detail: draft text, status, media URL, errors. Use when the operator asks about a specific run or after a runPipeline call to inspect what came out.",
      schema: getRunSchema,
      execute: async (input) => getRunTool(input as never),
    },

    approveDraft: {
      description:
        "Approve a run's draft so it becomes publishable. Use only when the operator explicitly says 'approve' or 'looks good, ship it'. " +
        "Returns ok=true with the draft id; chain into publishToPostiz to actually publish.",
      schema: approveDraftSchema,
      execute: async (input) => approveDraftTool(input as never),
    },

    editDraft: {
      description:
        "Replace the body of a run's draft. Use when the operator hands you new copy to swap in. " +
        "ALWAYS pass the operator's reason verbatim as 'notes' (e.g. 'too long, drop the hashtags') — the learning extractor uses it to derive universal house-style rules that every future run follows. Skipping notes loses that feedback. " +
        "Returns rulesLearned count; surface it briefly to the operator so they know future runs will follow. " +
        "Does NOT publish — operator still needs to approve + publish after the edit.",
      schema: editDraftSchema,
      execute: async (input) => editDraftTool(input as never),
    },

    publishToPostiz: {
      description:
        "Publish an APPROVED draft to its platform via Postiz, immediately or scheduled. " +
        "The draft must already be in status='approved' (use approveDraft first). " +
        "Pass scheduledAt as an ISO timestamp to schedule, omit to publish immediately. " +
        "Returns the Postiz post id on success.",
      schema: publishToPostizSchema,
      execute: async (input) => publishToPostizTool(input as never),
    },

    // ── Recurring scheduler tools ──────────────────────────────────────────
    proposeSchedule: {
      description:
        "Parse the operator's natural-language scheduling request into a STRUCTURED proposal (cadence + action) WITHOUT persisting. " +
        "Use when the operator says things like 'every Monday at 9am, research the latest AI agent news' or 'generate 5 posts every Tuesday'. " +
        "Returns a proposal object — you MUST then confirm with the operator (use askOperator with options like 'Yes, create it' / 'Tweak time' / 'Cancel') before calling createSchedule with the same structured fields. Never persist without explicit confirmation.",
      schema: proposeScheduleSchema,
      execute: async (input) => proposeScheduleTool(input as never),
    },

    createSchedule: {
      description:
        "Create a recurring schedule that fires an action on a cadence. " +
        "Call this ONLY after the operator has confirmed a proposal from proposeSchedule. " +
        "cadence.kind = 'daily' | 'weekly' | 'monthly' | 'cron'. Weekly takes day_of_week (0=Sun..6=Sat). Monthly takes day_of_month. " +
        "action.kind = 'run_pipeline' | 'run_pipeline_multi' | 'research_only' | 'schedule_multi_day_campaign'. " +
        "action.payload matches the corresponding pipeline tool's input. " +
        "Returns the new schedule_id + next_fire_at — surface those to the operator.",
      schema: createScheduleSchema,
      execute: async (input) => createScheduleTool(input as never),
    },

    listSchedules: {
      description:
        "List all recurring schedules with cadence + action + next/last-fire info. " +
        "Use when the operator asks 'what schedules do I have?', 'show my schedules', 'is anything scheduled?'. " +
        "Filter by status to show only active/paused/cancelled.",
      schema: listSchedulesSchema,
      execute: async (input) => listSchedulesTool(input as never),
    },

    pauseSchedule: {
      description:
        "Pause a recurring schedule so it stops firing until resumed. The schedule row is preserved. " +
        "Use when the operator says 'pause that', 'stop the Monday research', 'hold schedule X'.",
      schema: scheduleIdSchema,
      execute: async (input) => pauseScheduleTool(input as never),
    },

    resumeSchedule: {
      description:
        "Resume a paused schedule. Recomputes next_fire_at from the cadence so it fires on the next matching slot. " +
        "Use when the operator says 'turn that back on', 'resume the X schedule', 'reactivate it'.",
      schema: scheduleIdSchema,
      execute: async (input) => resumeScheduleTool(input as never),
    },

    deleteSchedule: {
      description:
        "Permanently delete a schedule + its fire history. Confirm with the operator via askOperator before calling — this is destructive. " +
        "Use when the operator says 'delete that schedule', 'remove the X schedule', 'cancel forever'.",
      schema: scheduleIdSchema,
      execute: async (input) => deleteScheduleTool(input as never),
    },

    runScheduleNow: {
      description:
        "Fire a schedule immediately, outside its cadence. Useful for testing or one-off catch-ups. " +
        "Does NOT advance next_fire_at — the next regular fire still happens as planned. " +
        "Use when the operator says 'run it now', 'fire that schedule', 'test my Monday schedule'.",
      schema: scheduleIdSchema,
      execute: async (input) => runScheduleNowTool(input as never),
    },

    [ASK_OPERATOR_TOOL]: {
      description:
        "Ask the operator a structured question with 2–8 button options. Use this INSTEAD of asking in plain text when: " +
        "(a) the operator named no platform and the tool needs one, " +
        "(b) the operator said 'all platforms' or was ambiguous about which, " +
        "(c) you'd otherwise need a yes/no confirmation, " +
        "(d) the action is destructive and you need a clear go/no-go. " +
        "Do NOT use askOperator for trivia or things you can decide yourself. " +
        "Each option has `label` (button text) and `value` (sent back as the operator's reply when tapped). " +
        "Set multiSelect=true when several options can coexist (e.g. picking multiple platforms). " +
        "The runtime short-circuits and shows your question with the buttons — you will NOT receive a tool result; the operator's choice arrives as a normal user message in the next turn.",
      schema: askOperatorSchema,
      // No `execute` — the runtime checks for this tool name and bypasses
      // dispatch. We provide a stub so TS / the toolset shape stays uniform.
      execute: async (input) => ({ pending: true, ask: input }),
    },
  };
}

/**
 * Render a tool registry as a system-prompt-injectable description block.
 * Format is intentionally simple JSON so any text-completion model (Anthropic,
 * Codex via pi-ai, OpenAI, etc.) can grok it without needing structured
 * tool-use APIs.
 */
export function renderToolsForPrompt(toolset: AgentToolset): string {
  const tools = Object.entries(toolset).map(([name, t]) => ({
    name,
    description: t.description,
    input_schema: zodShapeSummary(t.schema),
  }));
  return [
    "You have access to these tools. To call a tool, output a single JSON object on its own line:",
    '  {"tool": "<name>", "input": { ... }}',
    "After you receive the tool result, you may call another tool, or write your final reply as plain text.",
    "If no tool is needed, just write the reply.",
    "",
    "Available tools (JSON):",
    JSON.stringify(tools, null, 2),
  ].join("\n");
}

/**
 * Cheap, prompt-friendly summary of a zod schema. We're not generating a
 * full JSON Schema here — the LLM only needs to know the field names + types
 * + which are required. Falls back to "object" for anything exotic.
 */
function zodShapeSummary(schema: z.ZodTypeAny): unknown {
  const def = (schema as { _def?: { typeName?: string; shape?: () => Record<string, z.ZodTypeAny> } })._def;
  const typeName = def?.typeName ?? "";
  if (typeName === "ZodObject" && def?.shape) {
    const shape = def.shape();
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(shape)) {
      props[k] = zodLeafName(v);
    }
    return { type: "object", properties: props };
  }
  return zodLeafName(schema);
}

function zodLeafName(schema: z.ZodTypeAny): string {
  const def = (schema as { _def?: { typeName?: string; innerType?: z.ZodTypeAny; values?: string[] } })._def;
  const typeName = def?.typeName ?? "";
  if (typeName === "ZodString") return "string";
  if (typeName === "ZodNumber") return "number";
  if (typeName === "ZodBoolean") return "boolean";
  if (typeName === "ZodEnum") return `enum(${(def?.values ?? []).join("|")})`;
  if (typeName === "ZodOptional" || typeName === "ZodDefault" || typeName === "ZodNullable") {
    return def?.innerType ? `${zodLeafName(def.innerType)}?` : "any?";
  }
  if (typeName === "ZodArray") return "array";
  return "any";
}
