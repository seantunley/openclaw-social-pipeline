/**
 * Pipeline tools — let the agent kick off and inspect content pipeline runs.
 *
 * Per the original brief, six tools:
 *   - runPipeline / startContentRun  (kicks off the full content pipeline for a topic)
 *   - listRuns                       (recent runs with status)
 *   - getRun                         (single run drilldown)
 *   - approveDraft                   (flip a draft to approved, ready to publish)
 *   - editDraft                      (replace draft content with operator-supplied edit)
 *   - publishNow                     (handled by publish-tool.ts)
 *
 * All tools throw on error with operator-actionable messages — no silent
 * failure ([feedback_no_silent_failure.md]). The agent runtime catches the
 * throw and feeds it back to the LLM as a tool error.
 */

import { z } from "zod";
import { eq, desc, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../../db/index.js";
import {
  socialRun,
  socialDraft,
  socialApproval,
  socialMediaAsset,
} from "../../../db/schema.js";
import { runBotPipeline } from "../../../bot/pipeline.js";

// ---------------------------------------------------------------------------
// runPipeline
// ---------------------------------------------------------------------------

// Platforms supported by the engine pipeline. Enum (not free string) so the
// model can't silently invent "x" or drop the field.
export const PIPELINE_PLATFORMS = [
  "linkedin",
  "twitter",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
  "bluesky",
  "pinterest",
  "reddit",
  "vk",
] as const;

// Formats the pipeline supports per platform. Most platforms accept "single"
// (one post + one image). Instagram + Facebook also accept "carousel" (a
// swipeable slide set with N images, one prompt per slide). Some support
// short-video formats. The orchestrator translates these into the platform-
// scoped strings the media stage expects (e.g. "instagram_carousel").
export const PIPELINE_FORMATS = [
  "single",
  "carousel",
  "reel",
  "story",
  "short",
  "thread",
] as const;

export const runPipelineSchema = z.object({
  topic: z.string().min(2).max(800).describe("Topic / brief for the pipeline to write about"),
  // No default — the agent must explicitly choose. Previous default of
  // 'linkedin' caused the agent to drop the platform field and always
  // produce LinkedIn posts even when the operator asked for IG/FB.
  platform: z
    .enum(PIPELINE_PLATFORMS)
    .describe("Target platform. Required — never omit. If operator named multiple, use runPipelineMulti instead."),
  format: z
    .enum(PIPELINE_FORMATS)
    .optional()
    .describe(
      "Optional format. Pass 'carousel' for Instagram/Facebook carousel posts (multiple slides, one image per slide). 'reel' / 'short' / 'story' for video formats. 'thread' for X/Bluesky threads. Default is single-image post.",
    ),
  textOverlay: z
    .boolean()
    .optional()
    .describe(
      "Pass true to render the slide's text DIRECTLY INTO each carousel image (burned-in typography on the JPEG, viewable in the published post). Default false → images are pure visuals, text lives only in the caption. Use when the operator asks for 'text on the slides', 'text overlay', 'render the text', 'caption on each slide'. Only meaningful for carousel format; ignored on single-image posts.",
    ),
});
export type RunPipelineInput = z.infer<typeof runPipelineSchema>;

export interface RunPipelineOutput {
  runId: string;
  status: "completed" | "failed";
  topic: string;
  platform: string;
  content: string;
  hasImage: boolean;
  scores?: unknown;
  error?: string;
}

/**
 * Run the full pipeline synchronously and return the result. NOTE: this can
 * take 30-90s. For Telegram surfaces consider firing it async and reporting
 * the run id; for now we await it and the caller decides.
 */
export async function runPipelineTool(input: RunPipelineInput): Promise<RunPipelineOutput> {
  const db = getDb();
  try {
    // Validate platform+format combination via the platform-specs registry.
    // resolveFormat returns null when the format isn't supported on this
    // platform (e.g. youtube + carousel). We reject explicitly so the
    // agent gets clear feedback instead of silently degrading to single.
    if (input.format && input.format !== "single") {
      const { getPlatformSpec, resolveFormat } = await import(
        "../../platform/specs.js"
      );
      const spec = getPlatformSpec(input.platform);
      const resolved = resolveFormat(spec, input.format);
      if (!resolved) {
        return {
          runId: "",
          status: "failed",
          topic: input.topic,
          platform: input.platform,
          content: "",
          hasImage: false,
          error:
            `${input.platform} does not support the '${input.format}' format. ` +
            `Supported on ${input.platform}: ${[
              "single",
              ...(spec.media.altFormats?.map((f) => f.id) ?? []),
            ].join(", ")}.`,
        };
      }
    }
    // Pass format through to runBotPipeline so the media stage knows to
    // produce a carousel / reel / story etc. instead of a single image.
    // Without this the format field was being silently dropped at the
    // tool boundary and every run came out single-image.
    const r = await runBotPipeline(db, input.topic, input.platform, {}, {
      format: input.format && input.format !== "single" ? input.format : null,
      textOverlay: input.textOverlay ?? false,
    });
    return {
      runId: r.runId,
      status: "completed",
      topic: r.topic,
      platform: r.platform,
      content: r.content,
      hasImage: !!r.imageUrl,
      scores: r.scores,
    };
  } catch (err) {
    return {
      runId: "",
      status: "failed",
      topic: input.topic,
      platform: input.platform,
      content: "",
      hasImage: false,
      error: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// runPipelineMulti — same as runPipeline but parallel across N platforms.
//
// When the operator says "create instagram AND facebook posts about X", the
// agent should hit this tool once with platforms=['instagram','facebook']
// instead of calling runPipeline twice in serial. We dispatch them in
// parallel and return all results — typically 30-90s total, not 60-180s.
// ---------------------------------------------------------------------------

export const runPipelineMultiSchema = z.object({
  topic: z.string().min(2).max(800),
  platforms: z
    .array(z.enum(PIPELINE_PLATFORMS))
    .min(1)
    .max(6)
    .describe(
      "One or more target platforms. Each gets its own run + draft, dispatched in parallel.",
    ),
  format: z
    .enum(PIPELINE_FORMATS)
    .optional()
    .describe(
      "Optional format applied to every platform run. The tool silently degrades to 'single' on platforms that don't support the chosen format (e.g. 'carousel' across [instagram,linkedin]: IG carousels, LinkedIn falls back to single + a note in the run output).",
    ),
  textOverlay: z
    .boolean()
    .optional()
    .describe(
      "Pass true to render slide text into each carousel image. Applied per-platform — silently ignored on platforms that fall back to single. See runPipeline.textOverlay for the full semantics.",
    ),
});
export type RunPipelineMultiInput = z.infer<typeof runPipelineMultiSchema>;

export interface RunPipelineMultiOutput {
  topic: string;
  runs: RunPipelineOutput[];
}

// ---------------------------------------------------------------------------
// scheduleMultiDayCampaign — run N pipeline executions, one per scheduled
// day. Each run's TOPIC is suffixed with the date (e.g. "AI Trends — Mon May
// 25") so the operator can tell them apart at a glance, and the run's
// scheduled_at is set so the scheduler picks it up at the right time.
// ---------------------------------------------------------------------------

export const scheduleMultiDayCampaignSchema = z.object({
  topic: z.string().min(2).max(800).describe("Base topic for the campaign."),
  platform: z
    .enum(PIPELINE_PLATFORMS)
    .describe("Target platform — applies to every day's run."),
  format: z
    .enum(PIPELINE_FORMATS)
    .optional()
    .describe(
      "Optional format applied to every day's run. Validated against the chosen platform once before dispatch — rejected up-front if the combination is invalid.",
    ),
  textOverlay: z
    .boolean()
    .optional()
    .describe(
      "Pass true to render slide text into each carousel image across every day's run. See runPipeline.textOverlay for full semantics.",
    ),
  days: z
    .array(
      z.object({
        date: z
          .string()
          .min(10)
          .describe(
            "ISO date or datetime for this day's post (e.g. '2026-05-25' or '2026-05-25T09:00:00Z').",
          ),
        topicHint: z
          .string()
          .optional()
          .describe("Optional angle / variation for this specific day."),
      }),
    )
    .min(2, "Use runPipeline for a single day.")
    .max(14)
    .describe("Array of days to schedule. One run per entry."),
});
export type ScheduleMultiDayCampaignInput = z.infer<typeof scheduleMultiDayCampaignSchema>;

export interface ScheduleMultiDayCampaignOutput {
  topic: string;
  platform: string;
  runs: Array<{
    date: string;
    label: string;
    runId: string;
    status: "completed" | "failed";
    error?: string;
  }>;
}

export async function scheduleMultiDayCampaignTool(
  input: ScheduleMultiDayCampaignInput,
): Promise<ScheduleMultiDayCampaignOutput> {
  // Validate platform+format ONCE up front — every day uses the same combo,
  // so failing fast is correct (vs runPipelineMulti which degrades per-platform).
  if (input.format && input.format !== "single") {
    const { getPlatformSpec, resolveFormat } = await import(
      "../../platform/specs.js"
    );
    const spec = getPlatformSpec(input.platform);
    const resolved = resolveFormat(spec, input.format);
    if (!resolved) {
      return {
        topic: input.topic,
        platform: input.platform,
        runs: input.days.map((d) => ({
          date: d.date,
          label: d.date,
          runId: "",
          status: "failed" as const,
          error:
            `${input.platform} does not support the '${input.format}' format. ` +
            `Supported on ${input.platform}: ${[
              "single",
              ...(spec.media.altFormats?.map((f) => f.id) ?? []),
            ].join(", ")}.`,
        })),
      };
    }
  }
  const formatToken =
    input.format && input.format !== "single" ? input.format : null;
  // Dispatch in parallel — each pipeline call is independent.
  const settled = await Promise.allSettled(
    input.days.map(async (day) => {
      const d = new Date(day.date);
      const label = Number.isNaN(d.getTime())
        ? day.date
        : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      const dayTopic = day.topicHint
        ? `${input.topic} — ${day.topicHint} (${label})`
        : `${input.topic} — ${label}`;
      const r = await runBotPipeline(getDb(), dayTopic, input.platform, {}, {
        format: formatToken,
        textOverlay: input.textOverlay ?? false,
      });
      // Stamp the scheduled time on the run so the scheduler worker will
      // fire publish at the right moment (when status flips to scheduled).
      if (!Number.isNaN(d.getTime())) {
        getDb()
          .update(socialRun)
          .set({ scheduled_at: d.toISOString(), updated_at: new Date().toISOString() })
          .where(eq(socialRun.id, r.runId))
          .run();
      }
      return { date: day.date, label, runId: r.runId };
    }),
  );

  const runs = settled.map((s, i) =>
    s.status === "fulfilled"
      ? { ...s.value, status: "completed" as const }
      : {
          date: input.days[i].date,
          label: input.days[i].date,
          runId: "",
          status: "failed" as const,
          error: (s.reason as Error)?.message ?? String(s.reason),
        },
  );

  return { topic: input.topic, platform: input.platform, runs };
}

export async function runPipelineMultiTool(
  input: RunPipelineMultiInput,
): Promise<RunPipelineMultiOutput> {
  // Per-platform format adaptation: keep the requested format when the
  // platform supports it, drop to undefined (single) otherwise. The single
  // tool call's reasonable expectation is "carousel where possible, single
  // elsewhere" — failing the whole batch because YouTube can't do carousel
  // would be worse than silently degrading. runPipelineTool's validator
  // would otherwise reject and mark that platform 'failed'.
  let formatPerPlatform: Map<string, RunPipelineInput["format"]> | null = null;
  if (input.format && input.format !== "single") {
    const { getPlatformSpec, resolveFormat } = await import(
      "../../platform/specs.js"
    );
    formatPerPlatform = new Map();
    for (const p of input.platforms) {
      const spec = getPlatformSpec(p);
      const resolved = resolveFormat(spec, input.format);
      formatPerPlatform.set(p, resolved ? input.format : undefined);
    }
  }
  const settled = await Promise.allSettled(
    input.platforms.map((p) =>
      runPipelineTool({
        topic: input.topic,
        platform: p,
        format: formatPerPlatform?.get(p),
        textOverlay: input.textOverlay,
      }),
    ),
  );
  const runs: RunPipelineOutput[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          runId: "",
          status: "failed" as const,
          topic: input.topic,
          platform: input.platforms[i],
          content: "",
          hasImage: false,
          error: (s.reason as Error)?.message ?? String(s.reason),
        },
  );
  return { topic: input.topic, runs };
}

// ---------------------------------------------------------------------------
// rewriteForPlatform — take an existing run's draft, adapt the copy for a
// different platform, return a new run with the adapted draft.
//
// Cheaper than `runPipeline` because it skips research + media generation:
// we reuse the source run's content and just rewrite the body for the new
// platform's voice/length/hashtag conventions. ~5-10s per platform.
// ---------------------------------------------------------------------------

export const rewriteForPlatformSchema = z.object({
  sourceRunId: z
    .string()
    .min(4)
    .describe(
      "Existing run id whose draft you want to adapt. Get it from listRuns/getRun.",
    ),
  platforms: z
    .array(z.enum(PIPELINE_PLATFORMS))
    .min(1)
    .max(6)
    .describe("Target platform(s) to produce adapted versions for."),
  format: z
    .enum(PIPELINE_FORMATS)
    .optional()
    .describe(
      "Optional format for the adapted run(s). Silently downgrades to 'single' on platforms that don't support the chosen format. Useful for 'turn this LinkedIn single into an Instagram carousel'.",
    ),
  textOverlay: z
    .boolean()
    .optional()
    .describe(
      "Pass true to render slide text into each carousel image. See runPipeline.textOverlay for full semantics.",
    ),
});
export type RewriteForPlatformInput = z.infer<typeof rewriteForPlatformSchema>;

export interface RewriteForPlatformOutput {
  sourceRunId: string;
  results: Array<{
    platform: string;
    runId: string | null;
    status: "completed" | "failed";
    content: string;
    error?: string;
  }>;
}

export async function rewriteForPlatformTool(
  input: RewriteForPlatformInput,
): Promise<RewriteForPlatformOutput> {
  const db = getDb();
  const source = db
    .select()
    .from(socialDraft)
    .where(eq(socialDraft.run_id, input.sourceRunId))
    .get() as { id: string; final_content: string; raw_content: string } | undefined;

  if (!source) {
    return {
      sourceRunId: input.sourceRunId,
      results: input.platforms.map((p) => ({
        platform: p,
        runId: null,
        status: "failed" as const,
        content: "",
        error: `No draft found for run ${input.sourceRunId}.`,
      })),
    };
  }

  const sourceText = source.final_content || source.raw_content;
  const { llmGenerate } = await import("../../pipeline/llm.js");

  // Resolve format per platform (same degradation policy as runPipelineMulti).
  let formatPerPlatform: Map<string, RunPipelineInput["format"]> | null = null;
  if (input.format && input.format !== "single") {
    const { getPlatformSpec, resolveFormat } = await import(
      "../../platform/specs.js"
    );
    formatPerPlatform = new Map();
    for (const p of input.platforms) {
      const spec = getPlatformSpec(p);
      const resolved = resolveFormat(spec, input.format);
      formatPerPlatform.set(p, resolved ? input.format : undefined);
    }
  }

  const results = await Promise.all(
    input.platforms.map(async (platform) => {
      try {
        const rewritten = await llmGenerate(
          "You adapt social media copy for a specific platform. Preserve every concrete claim, name, number, and URL from the source. Rewrite for the target platform's conventions (length, voice, hashtag count, line breaks). Do NOT invent facts. Output ONLY the adapted post body — no preamble.",
          `Target platform: ${platform}\n\nSource draft:\n"""\n${sourceText}\n"""\n\nAdapt for ${platform}.`,
          { model: "claude-haiku-4-5-20251001", temperature: 0.5, maxTokens: 2048, caller: "agent.tool.rewrite" },
        );

        // Create a new run with the adapted content. We piggyback on
        // runBotPipeline to get a properly-shaped run/draft/media row set,
        // then overwrite the draft body with our LLM-rewritten copy. Yes,
        // this means we still spend the pipeline's research + media time
        // (30-90s) per platform. A dedicated fast-path helper that skips
        // research is on the backlog — for now correctness > speed.
        const fakeTopic = `Adapted from ${input.sourceRunId.slice(0, 32)}`;
        const resolvedFmt = formatPerPlatform?.get(platform);
        const fallback = await runBotPipeline(db, fakeTopic, platform, {}, {
          format: resolvedFmt && resolvedFmt !== "single" ? resolvedFmt : null,
          textOverlay: input.textOverlay ?? false,
        });
        db.update(socialDraft)
          .set({ final_content: rewritten, updated_at: new Date().toISOString() })
          .where(eq(socialDraft.run_id, fallback.runId))
          .run();
        return {
          platform,
          runId: fallback.runId,
          status: "completed" as const,
          content: rewritten,
        };
      } catch (err) {
        return {
          platform,
          runId: null,
          status: "failed" as const,
          content: "",
          error: (err as Error).message,
        };
      }
    }),
  );

  return { sourceRunId: input.sourceRunId, results };
}

// ---------------------------------------------------------------------------
// listRuns
// ---------------------------------------------------------------------------

export const listRunsSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
  status: z
    .enum(["pending", "running", "completed", "failed", "approved", "cancelled", "scheduled"])
    .optional()
    .describe("Filter by status"),
});
export type ListRunsInput = z.infer<typeof listRunsSchema>;

export interface RunSummary {
  id: string;
  status: string;
  topic: string;
  platform: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

export async function listRunsTool(input: ListRunsInput): Promise<{ runs: RunSummary[] }> {
  const db = getDb();
  const rows = db
    .select()
    .from(socialRun)
    .where(input.status ? eq(socialRun.status, input.status) : isNull(socialRun.deleted_at))
    .orderBy(desc(socialRun.created_at))
    .limit(input.limit)
    .all() as Array<{
    id: string;
    status: string;
    config_snapshot: string;
    created_at: string;
    completed_at: string | null;
    error_message: string | null;
  }>;
  const runs: RunSummary[] = rows.map((r) => {
    const cfg = safeJson<{ brief?: { topic?: string }; platform?: string }>(r.config_snapshot);
    return {
      id: r.id,
      status: r.status,
      topic: cfg?.brief?.topic ?? "(untitled)",
      platform: cfg?.platform ?? "?",
      created_at: r.created_at,
      completed_at: r.completed_at,
      error: r.error_message,
    };
  });
  return { runs };
}

// ---------------------------------------------------------------------------
// getRun
// ---------------------------------------------------------------------------

export const getRunSchema = z.object({
  runId: z.string().min(4).describe("Full run id (uuid or readable id)."),
});
export type GetRunInput = z.infer<typeof getRunSchema>;

export interface RunDetail {
  id: string;
  status: string;
  topic: string;
  platform: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
  draft: { id: string; status: string; raw_content: string; final_content: string } | null;
  media: Array<{ id: string; type: string; hosted_url: string | null }>;
}

export async function getRunTool(input: GetRunInput): Promise<RunDetail | { error: string }> {
  const db = getDb();
  const run = db
    .select()
    .from(socialRun)
    .where(eq(socialRun.id, input.runId))
    .get() as
    | {
        id: string;
        status: string;
        config_snapshot: string;
        created_at: string;
        completed_at: string | null;
        error_message: string | null;
      }
    | undefined;
  if (!run) return { error: `No run found with id ${input.runId}` };

  const draft = db
    .select()
    .from(socialDraft)
    .where(eq(socialDraft.run_id, run.id))
    .get() as
    | {
        id: string;
        status: string;
        raw_content: string;
        final_content: string;
      }
    | undefined;

  const media = draft
    ? (db
        .select()
        .from(socialMediaAsset)
        .where(eq(socialMediaAsset.draft_id, draft.id))
        .all() as Array<{ id: string; type: string; hosted_url: string | null }>)
    : [];

  const cfg = safeJson<{ brief?: { topic?: string }; platform?: string }>(run.config_snapshot);
  return {
    id: run.id,
    status: run.status,
    topic: cfg?.brief?.topic ?? "(untitled)",
    platform: cfg?.platform ?? "?",
    created_at: run.created_at,
    completed_at: run.completed_at,
    error: run.error_message,
    draft: draft
      ? {
          id: draft.id,
          status: draft.status,
          raw_content: draft.raw_content,
          final_content: draft.final_content,
        }
      : null,
    media,
  };
}

// ---------------------------------------------------------------------------
// approveDraft
// ---------------------------------------------------------------------------

export const approveDraftSchema = z.object({
  runId: z.string().min(4).describe("Run id whose draft you want to approve."),
});
export type ApproveDraftInput = z.infer<typeof approveDraftSchema>;

export async function approveDraftTool(
  input: ApproveDraftInput,
): Promise<{ ok: boolean; runId: string; draftId?: string; error?: string }> {
  const db = getDb();
  const draft = db
    .select()
    .from(socialDraft)
    .where(eq(socialDraft.run_id, input.runId))
    .get() as { id: string; status: string } | undefined;
  if (!draft) return { ok: false, runId: input.runId, error: `No draft for run ${input.runId}` };

  const now = new Date().toISOString();
  db.update(socialDraft)
    .set({ status: "approved", updated_at: now })
    .where(eq(socialDraft.id, draft.id))
    .run();

  db.insert(socialApproval)
    .values({
      id: uuidv4(),
      draft_id: draft.id,
      run_id: input.runId,
      decision: "approved",
      reviewer: "agent",
      reviewed_at: now,
    })
    .run();

  db.update(socialRun)
    .set({ status: "approved", updated_at: now })
    .where(eq(socialRun.id, input.runId))
    .run();

  return { ok: true, runId: input.runId, draftId: draft.id };
}

// ---------------------------------------------------------------------------
// editDraft
// ---------------------------------------------------------------------------

export const editDraftSchema = z.object({
  runId: z.string().min(4).describe("Run id whose draft to edit."),
  newContent: z
    .string()
    .min(2)
    .max(20_000)
    .describe("Replacement draft body. Replaces final_content; raw_content is preserved as history."),
  notes: z
    .string()
    .max(1_000)
    .optional()
    .describe(
      "Operator's reason for the edit (e.g. 'too long, drop the hashtags'). Used by the learning extractor to derive house-style rules that future runs follow. Pass through the user's own words verbatim when they gave a reason.",
    ),
});
export type EditDraftInput = z.infer<typeof editDraftSchema>;

export async function editDraftTool(
  input: EditDraftInput,
): Promise<{
  ok: boolean;
  runId: string;
  draftId?: string;
  rulesLearned?: number;
  rules?: Array<{ category: string; content: string }>;
  error?: string;
}> {
  const db = getDb();
  const draft = db
    .select()
    .from(socialDraft)
    .where(eq(socialDraft.run_id, input.runId))
    .get() as
    | {
        id: string;
        platform: string;
        campaign_id: string;
        raw_content: string;
        humanized_content: string;
        final_content: string;
      }
    | undefined;
  if (!draft) return { ok: false, runId: input.runId, error: `No draft for run ${input.runId}` };

  const oldContent =
    draft.final_content || draft.humanized_content || draft.raw_content || "";
  const now = new Date().toISOString();

  db.update(socialDraft)
    .set({
      final_content: input.newContent,
      character_count: input.newContent.length,
      status: "ready",
      updated_at: now,
    })
    .where(eq(socialDraft.id, draft.id))
    .run();

  // Mirror the dashboard's PUT /api/social/runs/:id/draft path: extract
  // imperative rules from the diff and persist them as universal learnings
  // so future runs pick up the operator's house-style edits regardless of
  // platform. Without this, edits made through Constance never feed back
  // into the rule corpus.
  let learnedRules: Array<{ category: string; content: string }> = [];
  try {
    const { extractRulesFromEdit } = await import(
      "../../learning/rule-extractor.js"
    );
    const { socialLearning } = await import("../../../db/schema.js");
    const extracted = await extractRulesFromEdit({
      platform: draft.platform,
      original: oldContent,
      edited: input.newContent,
      operatorNote: input.notes,
    });
    for (const rule of extracted) {
      db.insert(socialLearning)
        .values({
          id: uuidv4(),
          category: rule.category,
          platform: null,
          campaign_id: draft.campaign_id,
          content: rule.content,
          source_type: "draft_edit",
          source_run_id: input.runId,
          confidence: 0.85,
          reinforcement_count: 1,
          last_reinforced_at: now,
          tags: JSON.stringify([...(rule.tags ?? []), "universal", "agent_edit"]),
          active: true,
        })
        .run();
    }
    learnedRules = extracted.map((r) => ({ category: r.category, content: r.content }));
  } catch (err) {
    // Don't fail the edit because rule extraction failed — surface it to the
    // agent so it can mention the partial outcome instead of silently dropping
    // the learning step ([feedback_no_silent_failure.md]).
    return {
      ok: true,
      runId: input.runId,
      draftId: draft.id,
      rulesLearned: 0,
      error: `Edit saved but rule extraction failed: ${(err as Error).message}`,
    };
  }

  return {
    ok: true,
    runId: input.runId,
    draftId: draft.id,
    rulesLearned: learnedRules.length,
    rules: learnedRules,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function safeJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
