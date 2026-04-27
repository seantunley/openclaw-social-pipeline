import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, and, desc, sql, isNull, isNotNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  socialRun,
  socialRunStage,
  socialDraft,
  socialMediaAsset,
  socialApproval,
  socialPublishRecord,
  socialCampaign,
} from "../../src/db/schema.js";

const runsRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── GET /api/social/runs ────────────────────────────────────────────────────
  fastify.get("/api/social/runs", async (request, reply) => {
    const {
      status,
      campaign_id,
      platform,
      limit = 50,
      offset = 0,
    } = request.query as {
      status?: string;
      campaign_id?: string;
      platform?: string;
      limit?: number;
      offset?: number;
    };

    try {
      const conditions: ReturnType<typeof eq>[] = [];

      // Always exclude trashed runs from the main list. Trash has its own
      // endpoint at /api/social/trash.
      conditions.push(isNull(socialRun.deleted_at));

      if (status) {
        conditions.push(eq(socialRun.status, status as any));
      }
      if (campaign_id) {
        conditions.push(eq(socialRun.campaign_id, campaign_id));
      }

      let query = fastify.db
        .select()
        .from(socialRun)
        .orderBy(desc(socialRun.created_at))
        .limit(Number(limit))
        .offset(Number(offset));

      if (conditions.length === 1) {
        query = query.where(conditions[0]) as typeof query;
      } else if (conditions.length > 1) {
        query = query.where(and(...conditions)) as typeof query;
      }

      const runs = await query;

      // Hydrate campaign names in one query so the rows can render the
      // dashboard's expected `campaign` column.
      const campaignIds = Array.from(new Set(runs.map((r) => r.campaign_id)));
      const campaignRows = campaignIds.length
        ? await fastify.db.select().from(socialCampaign)
        : [];
      const campaignNameById = new Map(campaignRows.map((c) => [c.id, c.name]));

      // Apply platform filter post-fetch since platform lives inside
      // config_snapshot, not as a top-level column.
      const platformFiltered = platform
        ? runs.filter((r) => {
            try {
              return JSON.parse(r.config_snapshot).platform === platform;
            } catch {
              return false;
            }
          })
        : runs;

      const result = await Promise.all(
        platformFiltered.map(async (run) => {
          const stages = await fastify.db
            .select()
            .from(socialRunStage)
            .where(eq(socialRunStage.run_id, run.id));

          const stageSummary: Record<string, string> = {};
          for (const s of stages) {
            stageSummary[s.stage_name] = s.status;
          }

          const config = (() => {
            try {
              return JSON.parse(run.config_snapshot);
            } catch {
              return {};
            }
          })();

          return {
            id: run.id,
            status: run.status,
            trigger: run.trigger,
            platform: config.platform ?? '—',
            campaign: campaignNameById.get(run.campaign_id) ?? run.campaign_id,
            campaignId: run.campaign_id,
            createdAt: run.created_at,
            updatedAt: run.updated_at,
            startedAt: run.started_at,
            completedAt: run.completed_at,
            // Prefer the typed column (set by /runs/schedule + scheduler);
            // fall back to config.scheduled_for (set by legacy /reschedule).
            scheduledAt: run.scheduled_at ?? config.scheduled_for ?? null,
            errorMessage: run.error_message,
            config_snapshot: config,
            stages: stageSummary,
          };
        }),
      );

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to list runs");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs ───────────────────────────────────────────────────
  fastify.post("/api/social/runs", async (request, reply) => {
    const { campaign_id, platform, brief, media_mode } = request.body as {
      campaign_id: string;
      platform: string;
      brief: Record<string, unknown>;
      media_mode?: string;
    };

    if (!campaign_id) {
      return reply.status(400).send({ error: "campaign_id is required" });
    }
    if (!platform) {
      return reply.status(400).send({ error: "platform is required" });
    }
    if (!brief || typeof brief !== "object") {
      return reply
        .status(400)
        .send({ error: "brief is required and must be an object" });
    }

    try {
      // Verify campaign exists
      const campaign = await fastify.db
        .select()
        .from(socialCampaign)
        .where(eq(socialCampaign.id, campaign_id))
        .limit(1);

      if (campaign.length === 0) {
        return reply
          .status(404)
          .send({ error: `Campaign ${campaign_id} not found` });
      }

      const runId = uuidv4();
      const now = new Date().toISOString();

      await fastify.db.insert(socialRun).values({
        id: runId,
        campaign_id,
        status: "pending",
        trigger: "manual",
        config_snapshot: JSON.stringify({
          platform,
          brief,
          media_mode: media_mode ?? "image",
        }),
        created_at: now,
        updated_at: now,
      });

      // Create default stage records
      const stageNames = [
        "generate",
        "humanize",
        "psychology",
        "media",
        "approve",
        "publish",
        "analytics",
      ] as const;

      for (let i = 0; i < stageNames.length; i++) {
        await fastify.db.insert(socialRunStage).values({
          id: uuidv4(),
          run_id: runId,
          stage_name: stageNames[i],
          status: "pending",
          order_index: i,
          attempts: 0,
          max_retries: 3,
          input_data: "{}",
          output_data: "{}",
        });
      }

      const created = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, runId))
        .limit(1);

      const stages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(eq(socialRunStage.run_id, runId));

      return reply.status(201).send({
        ...created[0],
        config_snapshot: JSON.parse(created[0].config_snapshot),
        stages,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to create run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/start ─────────────────────────────────────────────
  // One-shot endpoint used by the Composer's AI Generate bar. Accepts a
  // bare `{ topic, platform, format? }` and fires `runBotPipeline` async,
  // returning the runId immediately so the dashboard can navigate to the
  // run-detail page and watch progress via the existing polling there.
  fastify.post("/api/social/runs/start", async (request, reply) => {
    const { topic, platform, format } = request.body as {
      topic?: string;
      platform?: string;
      format?: string;
    };

    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return reply.status(400).send({ error: "topic is required" });
    }
    if (!platform || typeof platform !== "string") {
      return reply.status(400).send({ error: "platform is required" });
    }

    // Lazy-import to dodge the circular dependency between dashboard-api
    // and the bot pipeline.
    const { runBotPipeline } = await import(
      "../../src/bot/pipeline.js"
    );

    // Fire-and-forget. Pipeline streams its own status updates into
    // social_run / social_run_stage; the dashboard polls those tables.
    // The pipeline calls `onRunCreated` synchronously after inserting
    // the row, so we get the runId back before the long body runs.
    let runId: string | null = null;
    const ready: Promise<string> = new Promise((resolve) => {
      queueMicrotask(async () => {
        try {
          await runBotPipeline(
            fastify.db as any,
            topic.trim(),
            platform,
            {},
            {
              format: format ?? null,
              onRunCreated: (id) => { runId = id; resolve(id); },
            },
          );
        } catch (err) {
          fastify.log.error({ err, topic, platform, format }, "Async run failed");
          if (!runId) resolve(""); // unblock the response if the run never made it past creation
        }
      });
    });

    const id = await ready;
    if (!id) {
      return reply.status(500).send({ error: "Run failed before it could be persisted." });
    }
    return reply.status(202).send({
      ok: true,
      runId: id,
      message: "Run started in the background.",
    });
  });

  // ── POST /api/social/runs/schedule ──────────────────────────────────────────
  // Smart scheduler: persist a run with status='scheduled' and a future
  // `scheduled_at`. The in-process scheduler worker (see scheduler-worker.ts)
  // polls every 30s and promotes due rows to 'running' by invoking the
  // pipeline. Same {topic, platform, format} shape as /runs/start.
  fastify.post("/api/social/runs/schedule", async (request, reply) => {
    const { topic, platform, format, scheduled_at } = request.body as {
      topic?: string;
      platform?: string;
      format?: string | null;
      scheduled_at?: string;
    };

    if (!topic || !topic.trim()) {
      return reply.status(400).send({ error: "topic is required" });
    }
    if (!platform) {
      return reply.status(400).send({ error: "platform is required" });
    }
    if (!scheduled_at) {
      return reply.status(400).send({ error: "scheduled_at (ISO timestamp) is required" });
    }
    const when = new Date(scheduled_at);
    if (Number.isNaN(when.getTime())) {
      return reply.status(400).send({ error: `scheduled_at is not a valid ISO timestamp: ${scheduled_at}` });
    }
    if (when.getTime() < Date.now() - 60_000) {
      return reply.status(400).send({ error: "scheduled_at must be in the future" });
    }

    // Same default campaign the bot pipeline uses, so scheduled runs show up
    // under the same campaign filter as immediate runs.
    const DEFAULT_CAMPAIGN_ID = "telegram-default";
    // Ensure campaign row exists (it normally does, but safe-guard scheduling
    // before the first immediate run).
    const existing = await fastify.db
      .select()
      .from(socialCampaign)
      .where(eq(socialCampaign.id, DEFAULT_CAMPAIGN_ID))
      .limit(1);
    if (existing.length === 0) {
      const now = new Date().toISOString();
      await fastify.db
        .insert(socialCampaign)
        .values({
          id: DEFAULT_CAMPAIGN_ID,
          name: "Telegram Bot",
          status: "active",
          created_at: now,
          updated_at: now,
        })
        .run();
    }

    const { generateReadableRunId } = await import("../../src/bot/pipeline.js");
    const runId = generateReadableRunId(topic.trim(), platform);
    const now = new Date().toISOString();
    await fastify.db
      .insert(socialRun)
      .values({
        id: runId,
        campaign_id: DEFAULT_CAMPAIGN_ID,
        status: "scheduled" as never,
        trigger: "scheduled",
        config_snapshot: JSON.stringify({
          platform,
          format: format ?? null,
          brief: { topic: topic.trim(), platforms: [platform] },
          media_mode: "image",
          source: "smart-scheduler",
        }),
        scheduled_at: when.toISOString(),
        created_at: now,
        updated_at: now,
      })
      .run();

    return reply.status(202).send({
      ok: true,
      runId,
      scheduled_at: when.toISOString(),
    });
  });

  // ── GET /api/social/runs/:id ────────────────────────────────────────────────
  fastify.get("/api/social/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const runs = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      if (runs.length === 0) {
        return reply.status(404).send({ error: `Run ${id} not found` });
      }

      const run = runs[0];

      const stages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(eq(socialRunStage.run_id, id));

      const drafts = await fastify.db
        .select()
        .from(socialDraft)
        .where(eq(socialDraft.run_id, id));

      // Gather media assets for each draft
      const media = [];
      for (const draft of drafts) {
        const assets = await fastify.db
          .select()
          .from(socialMediaAsset)
          .where(eq(socialMediaAsset.draft_id, draft.id));
        media.push(...assets);
      }

      const approvals = await fastify.db
        .select()
        .from(socialApproval)
        .where(eq(socialApproval.run_id, id));

      const publishRecords = await fastify.db
        .select()
        .from(socialPublishRecord)
        .where(eq(socialPublishRecord.run_id, id));

      // Look up the campaign name for the header
      const campaignRow = await fastify.db
        .select()
        .from(socialCampaign)
        .where(eq(socialCampaign.id, run.campaign_id))
        .limit(1);
      const campaignName = campaignRow[0]?.name ?? run.campaign_id;

      const config = (() => {
        try {
          return JSON.parse(run.config_snapshot);
        } catch {
          return {};
        }
      })();

      const stageSummary: Record<string, string> = {};
      for (const s of stages) stageSummary[s.stage_name] = s.status;

      // Hydrate drafts with parsed JSON columns and the camelCase fields the
      // dashboard's DraftCard / RunDetail tabs read from.
      const hydratedDrafts = drafts.map((d) => {
        const meta = (() => {
          try {
            return JSON.parse(d.metadata);
          } catch {
            return {};
          }
        })();
        return {
          id: d.id,
          // DraftCard reads `.content`; render the strongest version.
          content: d.final_content || d.humanized_content || d.raw_content,
          score: typeof d.seo_score === 'number' ? d.seo_score / 100 : undefined,
          variant: `Variant ${d.variant_index + 1}`,
          platform: d.platform,
          status: d.status,
          // Raw fields preserved for tabs that need them.
          rawContent: d.raw_content,
          humanizedContent: d.humanized_content,
          finalContent: d.final_content,
          seoScore: d.seo_score,
          brandScore: d.brand_score,
          characterCount: d.character_count,
          metadata: meta,
        };
      });

      const hydratedMedia = media.map((m) => {
        const meta = (() => {
          try {
            return JSON.parse(m.metadata);
          } catch {
            return {};
          }
        })();
        return {
          id: m.id,
          // MediaCard reads `.url` and `.aspectRatio` (camelCase).
          url: m.hosted_url ?? m.source_url ?? null,
          thumbnailUrl: null,
          type: m.type,
          status: m.status,
          prompt: m.prompt,
          aspectRatio: m.aspect_ratio,
          metadata: meta,
        };
      });

      // Pull research notes out of the first draft's metadata (the bot
      // pipeline stores `research_notes` there). The Brief tab gets the
      // brief from config_snapshot.
      const research =
        hydratedDrafts[0]?.metadata?.research_notes ??
        config.research ??
        null;

      // Humanized content tab reads `run.humanized` — surface from the
      // first draft.
      const humanized = hydratedDrafts[0]?.humanizedContent ?? null;

      // Psychology + compliance live in two places: the stage `output_data`
      // and the draft's `metadata` JSON. Pull both, prefer the stage record
      // (more authoritative), fall back to the draft.
      const stageByName = new Map<string, (typeof stages)[number]>();
      for (const s of stages) stageByName.set(s.stage_name, s);

      const parseStageOutput = (name: string): Record<string, unknown> | null => {
        const s = stageByName.get(name);
        if (!s?.output_data) return null;
        try {
          return JSON.parse(s.output_data) as Record<string, unknown>;
        } catch {
          return null;
        }
      };

      // Some early runs stored the raw SEO+GEO JSON as the "before" string
      // because the SEO+GEO service didn't strip ```json fences. The LLM
      // sometimes returns `content` as a nested object too. We walk the
      // parsed JSON looking for the post text field; fall back to a
      // pretty-printed JSON if we genuinely can't find it.
      // Field names Claude uses for the post body in different contexts.
      // Order matters: prefer specific over generic.
      const TEXT_FIELDS = [
        'caption', 'post', 'post_text', 'main_text',
        'content', 'enhanced_content', 'enhanced',
        'humanized', 'humanized_content', 'rewritten',
        'text', 'body', 'draft',
      ];
      const findTextInObject = (obj: unknown): string | null => {
        if (typeof obj === 'string') return obj.length > 20 ? obj : null;
        if (!obj || typeof obj !== 'object') return null;
        const rec = obj as Record<string, unknown>;
        // Pass 1: prefer named fields, deep-first.
        for (const key of TEXT_FIELDS) {
          const v = rec[key];
          if (typeof v === 'string' && v.length > 20) return v;
          if (v && typeof v === 'object') {
            const nested = findTextInObject(v);
            if (nested) return nested;
          }
        }
        // Pass 2: fall back to the longest string anywhere in the object.
        let longest = '';
        const walk = (node: unknown) => {
          if (typeof node === 'string') {
            if (node.length > longest.length) longest = node;
            return;
          }
          if (Array.isArray(node)) {
            for (const x of node) walk(x);
            return;
          }
          if (node && typeof node === 'object') {
            for (const v of Object.values(node)) walk(v);
          }
        };
        walk(obj);
        return longest.length > 40 ? longest : null;
      };

      const repairText = (s: unknown): string | null => {
        if (s === null || s === undefined) return null;
        if (typeof s !== 'string') {
          // Already an object (the LLM-parsed shape) — walk it for text.
          return findTextInObject(s);
        }
        const trimmed = s.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('```')) return trimmed;
        // Fenced or wrapped JSON — strip and parse.
        let cleaned = trimmed.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const first = cleaned.indexOf('{');
        const last = cleaned.lastIndexOf('}');
        if (first > 0 && last > first) cleaned = cleaned.slice(first, last + 1);
        try {
          const parsed = JSON.parse(cleaned) as Record<string, unknown>;
          const text = findTextInObject(parsed);
          if (text) return text;
        } catch {
          // not parseable
        }
        // Last resort: return the trimmed original so nothing is silently
        // lost. The dashboard will at least show *something*, even if it's
        // not pretty.
        return trimmed;
      };

      const psychologyStageOut = parseStageOutput('psychology');
      const psychology = psychologyStageOut
        ? {
            before:
              repairText(psychologyStageOut.before) ??
              repairText(hydratedDrafts[0]?.rawContent) ??
              null,
            after:
              repairText(psychologyStageOut.enhanced) ??
              repairText(hydratedDrafts[0]?.metadata?.psychology_enhanced as unknown) ??
              null,
            principlesApplied: Array.isArray(psychologyStageOut.principles_applied)
              ? (psychologyStageOut.principles_applied as string[])
              : [],
            changes: Array.isArray(psychologyStageOut.changes)
              ? (psychologyStageOut.changes as string[])
              : [],
          }
        : null;

      const humanizeStageOut = parseStageOutput('humanize');
      const compliance =
        (humanizeStageOut?.compliance as { passed: boolean; issues: string[] } | undefined) ??
        (hydratedDrafts[0]?.metadata?.compliance as { passed: boolean; issues: string[] } | undefined) ??
        null;
      const humanizedDetail = humanizeStageOut
        ? {
            before:
              repairText(humanizeStageOut.before) ??
              psychology?.after ??
              null,
            after:
              repairText(humanizeStageOut.humanized) ??
              repairText(hydratedDrafts[0]?.humanizedContent as unknown) ??
              null,
            patternsRemoved: Array.isArray(humanizeStageOut.patterns_removed)
              ? (humanizeStageOut.patterns_removed as string[])
              : [],
            changes: Array.isArray(humanizeStageOut.changes)
              ? (humanizeStageOut.changes as string[])
              : [],
          }
        : null;

      return reply.send({
        id: run.id,
        status: run.status,
        trigger: run.trigger,
        platform: config.platform ?? '—',
        campaign: campaignName,
        campaignId: run.campaign_id,
        brief: config.brief ?? null,
        research,
        humanized,
        humanizedDetail,
        psychology,
        compliance,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        scheduledAt: config.scheduled_for ?? null,
        errorMessage: run.error_message,
        config_snapshot: config,
        stages: stages.map((s) => ({
          ...s,
          input_data: JSON.parse(s.input_data),
          output_data: JSON.parse(s.output_data),
        })),
        // Also expose stages as a name→status map for components that need it
        stageStatuses: stageSummary,
        drafts: hydratedDrafts,
        media: hydratedMedia,
        mediaAssets: hydratedMedia,
        approvals,
        publish_records: publishRecords.map((p) => ({
          ...p,
          metadata: JSON.parse(p.metadata),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to get run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── DELETE /api/social/runs/:id ─────────────────────────────────────────────
  // SOFT delete: set `deleted_at` and the run disappears from the main lists.
  // Recoverable via /restore. Permanent removal happens at /trash/:id (hard).
  fastify.delete("/api/social/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const now = new Date().toISOString();
      const result = await fastify.db
        .update(socialRun)
        .set({ deleted_at: now, updated_at: now })
        .where(and(eq(socialRun.id, id), isNull(socialRun.deleted_at)));
      const changes = (result as unknown as { changes?: number }).changes ?? 0;
      if (changes === 0) {
        return reply.status(404).send({ error: `Run ${id} not found or already in trash` });
      }
      return reply.send({ ok: true, trashed: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to trash run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/cleanup-cancelled ─────────────────────────────────
  // Bulk-soft-delete every run currently in `cancelled` state.
  fastify.post("/api/social/runs/cleanup-cancelled", async (_request, reply) => {
    try {
      const now = new Date().toISOString();
      const result = await fastify.db
        .update(socialRun)
        .set({ deleted_at: now, updated_at: now })
        .where(
          and(eq(socialRun.status, "cancelled"), isNull(socialRun.deleted_at)),
        );
      const changes = (result as unknown as { changes?: number }).changes ?? 0;
      return reply.send({ ok: true, trashed: changes });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to cleanup cancelled runs");
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /api/social/trash ───────────────────────────────────────────────────
  // List every soft-deleted run, newest-trashed first.
  fastify.get("/api/social/trash", async (_request, reply) => {
    try {
      const rows = await fastify.db
        .select()
        .from(socialRun)
        .where(isNotNull(socialRun.deleted_at))
        .orderBy(desc(socialRun.deleted_at as never))
        .limit(200);

      const campaigns = await fastify.db.select().from(socialCampaign);
      const campaignNameById = new Map(campaigns.map((c) => [c.id, c.name]));

      const result = rows.map((run) => {
        const config = (() => {
          try {
            return JSON.parse(run.config_snapshot) as { platform?: string };
          } catch {
            return {};
          }
        })();
        return {
          id: run.id,
          status: run.status,
          platform: config.platform ?? "—",
          campaign: campaignNameById.get(run.campaign_id) ?? run.campaign_id,
          createdAt: run.created_at,
          deletedAt: run.deleted_at,
        };
      });

      return reply.send({ runs: result, total: result.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to list trash");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/:id/restore ───────────────────────────────────────
  // Pull a run back out of the trash.
  fastify.post("/api/social/runs/:id/restore", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const now = new Date().toISOString();
      const result = await fastify.db
        .update(socialRun)
        .set({ deleted_at: null, updated_at: now })
        .where(and(eq(socialRun.id, id), isNotNull(socialRun.deleted_at)));
      const changes = (result as unknown as { changes?: number }).changes ?? 0;
      if (changes === 0) {
        return reply.status(404).send({ error: `Run ${id} not found in trash` });
      }
      return reply.send({ ok: true, restored: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to restore run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── DELETE /api/social/trash/:id ────────────────────────────────────────────
  // HARD delete a run that's already in trash. Cascades to drafts / stages /
  // media / approvals / publish records.
  fastify.delete("/api/social/trash/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await fastify.db
        .delete(socialRun)
        .where(and(eq(socialRun.id, id), isNotNull(socialRun.deleted_at)));
      const changes = (result as unknown as { changes?: number }).changes ?? 0;
      if (changes === 0) {
        return reply
          .status(404)
          .send({ error: `Run ${id} not found in trash (must be soft-deleted first)` });
      }
      return reply.send({ ok: true, purged: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to purge run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/trash/empty ────────────────────────────────────────────
  // HARD delete every run currently in trash.
  fastify.post("/api/social/trash/empty", async (_request, reply) => {
    try {
      const result = await fastify.db
        .delete(socialRun)
        .where(isNotNull(socialRun.deleted_at));
      const changes = (result as unknown as { changes?: number }).changes ?? 0;
      return reply.send({ ok: true, purged: changes });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to empty trash");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/:id/retry-stage ───────────────────────────────────
  fastify.post("/api/social/runs/:id/retry-stage", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { stage_name } = request.body as { stage_name: string };

    if (!stage_name) {
      return reply.status(400).send({ error: "stage_name is required" });
    }

    try {
      const runs = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      if (runs.length === 0) {
        return reply.status(404).send({ error: `Run ${id} not found` });
      }

      const stages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(
          and(
            eq(socialRunStage.run_id, id),
            eq(socialRunStage.stage_name, stage_name as any)
          )
        )
        .limit(1);

      if (stages.length === 0) {
        return reply
          .status(404)
          .send({
            error: `Stage ${stage_name} not found for run ${id}`,
          });
      }

      const stage = stages[0];

      if (stage.status !== "failed") {
        return reply
          .status(400)
          .send({
            error: `Cannot retry stage with status '${stage.status}'. Only failed stages can be retried.`,
          });
      }

      if (stage.attempts >= stage.max_retries) {
        return reply
          .status(400)
          .send({
            error: `Stage ${stage_name} has exhausted all ${stage.max_retries} retries`,
          });
      }

      const now = new Date().toISOString();

      await fastify.db
        .update(socialRunStage)
        .set({
          status: "retrying",
          attempts: stage.attempts + 1,
          error_message: null,
          started_at: null,
          completed_at: null,
        })
        .where(eq(socialRunStage.id, stage.id));

      // If the run was in failed state, move it back to running
      if (runs[0].status === "failed") {
        await fastify.db
          .update(socialRun)
          .set({ status: "running", updated_at: now, error_message: null })
          .where(eq(socialRun.id, id));
      }

      const updatedRun = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      const updatedStages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(eq(socialRunStage.run_id, id));

      return reply.send({
        ...updatedRun[0],
        config_snapshot: JSON.parse(updatedRun[0].config_snapshot),
        stages: updatedStages,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to retry stage");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/:id/cancel ────────────────────────────────────────
  fastify.post("/api/social/runs/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const runs = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      if (runs.length === 0) {
        return reply.status(404).send({ error: `Run ${id} not found` });
      }

      const run = runs[0];

      if (run.status === "completed" || run.status === "cancelled") {
        return reply
          .status(400)
          .send({
            error: `Cannot cancel a run with status '${run.status}'`,
          });
      }

      const now = new Date().toISOString();

      await fastify.db
        .update(socialRun)
        .set({ status: "cancelled", updated_at: now })
        .where(eq(socialRun.id, id));

      // Cancel all pending/running stages
      await fastify.db
        .update(socialRunStage)
        .set({ status: "skipped", completed_at: now })
        .where(
          and(
            eq(socialRunStage.run_id, id),
            sql`${socialRunStage.status} IN ('pending', 'running', 'retrying')`
          )
        );

      const updatedRun = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      const updatedStages = await fastify.db
        .select()
        .from(socialRunStage)
        .where(eq(socialRunStage.run_id, id));

      return reply.send({
        ...updatedRun[0],
        config_snapshot: JSON.parse(updatedRun[0].config_snapshot),
        stages: updatedStages,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to cancel run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── PATCH /api/social/runs/:id/reschedule ──────────────────────────────────
  fastify.patch("/api/social/runs/:id/reschedule", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { scheduledAt } = request.body as { scheduledAt: string };

      if (!scheduledAt) {
        return reply.status(400).send({ error: "scheduledAt is required" });
      }

      const existing = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      if (existing.length === 0) {
        return reply.status(404).send({ error: "Run not found" });
      }

      const now = new Date().toISOString();
      // Write to the typed column (read by the scheduler worker) and mirror
      // into config.scheduled_for for back-compat with older clients. Also
      // promote to status='scheduled' if the run was still pending — that's
      // the calendar's default drag-target state for un-fired runs.
      const config = JSON.parse(existing[0].config_snapshot ?? "{}");
      config.scheduled_for = scheduledAt;

      const next: Record<string, unknown> = {
        config_snapshot: JSON.stringify(config),
        scheduled_at: scheduledAt,
        updated_at: now,
      };
      if (existing[0].status === "pending") {
        next.status = "scheduled";
        next.trigger = "scheduled";
      }
      await fastify.db
        .update(socialRun)
        .set(next as never)
        .where(eq(socialRun.id, id));

      const updated = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      return reply.send({
        ...updated[0],
        config_snapshot: JSON.parse(updated[0].config_snapshot),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to reschedule run");
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /api/social/runs/:id/events ────────────────────────────────────────
  // Phase D: server-sent events stream for a single run. Server-side poll
  // checks the run row at SSE_POLL_MS and emits a `state` event whenever
  // the serialized snapshot changes. Clients consume via EventSource — see
  // useLiveRunStream on the dashboard side. Replaces per-client HTTP
  // polling so N tabs share one DB read.
  //
  // We poll the DB instead of LISTEN/NOTIFY because sqlite has no native
  // pubsub. Writes happen in the engine process (separate from this API),
  // so an in-memory event bus can't catch them either. The poll interval
  // is small (1.5s) and reads are cheap (single row by id).
  const SSE_POLL_MS = 1500;

  fastify.get("/api/social/runs/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();

    let lastSerialized = "";
    let closed = false;

    const send = (event: string, data: unknown) => {
      if (closed) return;
      try {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
    };

    // Heartbeat every 25s so proxies don't kill the connection.
    const heartbeat = setInterval(() => {
      if (closed) return;
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        closed = true;
      }
    }, 25_000);

    const tick = async () => {
      if (closed) return;
      try {
        const rows = await fastify.db
          .select()
          .from(socialRun)
          .where(eq(socialRun.id, id))
          .limit(1);
        if (rows.length === 0) {
          send("error", { message: "run not found" });
          closed = true;
          return;
        }
        const run = rows[0] as Record<string, unknown>;
        // Watch the fields that actually change over a run's lifecycle.
        // Including everything would emit on every updated_at tick.
        const snapshot = JSON.stringify({
          status: run.status,
          error: run.error_message,
          started: run.started_at,
          completed: run.completed_at,
          scheduled: run.scheduled_at,
        });
        if (snapshot !== lastSerialized) {
          lastSerialized = snapshot;
          send("state", { runId: id, snapshot: JSON.parse(snapshot) });
        }
        // Stop polling once the run is in a terminal state — the client
        // will reconnect if needed.
        const terminal = ["completed", "failed", "cancelled", "rejected"];
        if (typeof run.status === "string" && terminal.includes(run.status)) {
          send("done", { runId: id, status: run.status });
        }
      } catch (err) {
        fastify.log.error({ err, runId: id }, "[sse] poll failed");
      }
    };

    const interval = setInterval(tick, SSE_POLL_MS);
    // Emit initial snapshot immediately.
    void tick();

    request.raw.on("close", () => {
      closed = true;
      clearInterval(interval);
      clearInterval(heartbeat);
      try {
        reply.raw.end();
      } catch {
        // Already closed — fine.
      }
    });
  });

  done();
};

export default runsRoutes;
