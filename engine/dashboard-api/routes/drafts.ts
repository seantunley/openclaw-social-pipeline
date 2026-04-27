import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, and, or, desc, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  socialRun,
  socialRunStage,
  socialDraft,
  socialMediaAsset,
  socialLearning,
} from "../../src/db/schema.js";

const draftsRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── POST /api/social/runs/:id/regenerate-draft ──────────────────────────────
  fastify.post(
    "/api/social/runs/:id/regenerate-draft",
    async (request, reply) => {
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

        const now = new Date().toISOString();

        // Reset the generate stage to pending so the pipeline re-runs it
        const generateStages = await fastify.db
          .select()
          .from(socialRunStage)
          .where(
            and(
              eq(socialRunStage.run_id, id),
              eq(socialRunStage.stage_name, "generate")
            )
          )
          .limit(1);

        if (generateStages.length === 0) {
          return reply
            .status(404)
            .send({ error: "Generate stage not found for this run" });
        }

        await fastify.db
          .update(socialRunStage)
          .set({
            status: "pending",
            attempts: generateStages[0].attempts + 1,
            started_at: null,
            completed_at: null,
            error_message: null,
            output_data: "{}",
          })
          .where(eq(socialRunStage.id, generateStages[0].id));

        // Also reset downstream stages (humanize, psychology, approve)
        const downstreamStages = ["humanize", "psychology", "approve"] as const;
        for (const stageName of downstreamStages) {
          const matched = await fastify.db
            .select()
            .from(socialRunStage)
            .where(
              and(
                eq(socialRunStage.run_id, id),
                eq(socialRunStage.stage_name, stageName)
              )
            )
            .limit(1);

          if (matched.length > 0 && matched[0].status !== "pending") {
            await fastify.db
              .update(socialRunStage)
              .set({
                status: "pending",
                started_at: null,
                completed_at: null,
                error_message: null,
                output_data: "{}",
              })
              .where(eq(socialRunStage.id, matched[0].id));
          }
        }

        // Mark existing drafts as superseded by setting status to failed
        await fastify.db
          .update(socialDraft)
          .set({ status: "failed", updated_at: now })
          .where(
            and(
              eq(socialDraft.run_id, id),
              eq(socialDraft.status, "ready")
            )
          );

        // Set run to running
        await fastify.db
          .update(socialRun)
          .set({ status: "running", updated_at: now })
          .where(eq(socialRun.id, id));

        return reply.send({
          run_id: id,
          action: "regenerate_draft",
          status: "pending",
          message: "Draft regeneration initiated. Generate stage reset to pending.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to regenerate draft");
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── POST /api/social/runs/:id/regenerate-media ──────────────────────────────
  // Re-runs the image generator for a run that already finished. Accepts an
  // optional `{ prompt }` from the dashboard's Media-tab editor so the
  // operator can tweak the editorial prompt before regenerating. When
  // `prompt` is omitted the orchestrator falls back to its LLM-driven
  // builder (same path as the original run).
  fastify.post(
    "/api/social/runs/:id/regenerate-media",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { prompt?: string };
      const customPrompt = typeof body.prompt === "string" && body.prompt.trim().length > 0
        ? body.prompt.trim()
        : undefined;

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

        const drafts = await fastify.db
          .select()
          .from(socialDraft)
          .where(eq(socialDraft.run_id, id));
        if (drafts.length === 0) {
          return reply.status(400).send({ error: "Run has no drafts to regenerate media for" });
        }
        const draft = drafts[0];

        // Reset the media stage. Increment attempts so retries are
        // visible in the timeline.
        const mediaStages = await fastify.db
          .select()
          .from(socialRunStage)
          .where(and(eq(socialRunStage.run_id, id), eq(socialRunStage.stage_name, "media")))
          .limit(1);
        if (mediaStages.length === 0) {
          return reply.status(404).send({ error: "Media stage not found for this run" });
        }
        const now = new Date().toISOString();
        await fastify.db
          .update(socialRunStage)
          .set({
            status: "running",
            attempts: mediaStages[0].attempts + 1,
            started_at: now,
            completed_at: null,
            error_message: null,
            output_data: "{}",
          })
          .where(eq(socialRunStage.id, mediaStages[0].id));

        await fastify.db
          .update(socialRun)
          .set({ status: "running", error_message: null, updated_at: now })
          .where(eq(socialRun.id, id));

        // Resolve format + topic + body from the run config and draft so
        // generateImage gets the same inputs as the original pipeline pass.
        const config = (() => {
          try { return JSON.parse(run.config_snapshot ?? "{}"); } catch { return {}; }
        })() as { platform?: string; format?: string | null; brief?: { topic?: string } };
        const platform = config.platform ?? "linkedin";
        const topic = config.brief?.topic ?? "";
        const finalContent = draft.final_content || draft.humanized_content || draft.raw_content || "";

        const { generateImage, AllImageProvidersFailed } = await import("../../src/services/media/index.js");
        const { getPlatformSpec, resolveFormat } = await import("../../src/services/platform/specs.js");

        const spec = getPlatformSpec(platform);
        const resolved = resolveFormat(spec, config.format ?? null);
        const aspectRatio = resolved?.aspectRatio ?? spec.media.imageAspectRatio;
        const formatForMedia = resolved ? `${platform}_${resolved.id}` : undefined;
        const isCarousel = !!resolved && resolved.id === "carousel";

        // Fire async so we can return 202 immediately. The dashboard polls
        // run status and asset rows to surface progress.
        queueMicrotask(async () => {
          try {
            const result = await generateImage({
              title: topic,
              body: finalContent,
              platform,
              aspectRatio,
              format: formatForMedia,
              customPrompt,
            });

            // Mark old `hosted` assets as superseded so the Media tab shows
            // only the new ones at the top. Keeping history in case the
            // operator wants to compare or revert.
            await fastify.db
              .update(socialMediaAsset)
              .set({ status: "superseded" })
              .where(
                and(
                  eq(socialMediaAsset.draft_id, draft.id),
                  eq(socialMediaAsset.status, "hosted"),
                ),
              );

            const modelName =
              result.provider === "fal" ? "nano-banana-2"
              : result.provider === "openai" ? (process.env.OPENAI_IMAGE_MODEL || "gpt-image-2")
              : "";

            for (let idx = 0; idx < result.urls.length; idx++) {
              await fastify.db.insert(socialMediaAsset).values({
                id: uuidv4(),
                draft_id: draft.id,
                type: "image",
                status: "hosted",
                prompt: result.prompts[idx] ?? customPrompt ?? `Social image for: ${topic}`,
                provider: result.provider,
                model: modelName,
                source_url: result.urls[idx],
                hosted_url: result.urls[idx],
                media_mode: "image",
                aspect_ratio: aspectRatio,
                carousel_index: isCarousel ? idx : null,
                metadata: JSON.stringify({ attempts: result.attempts, regenerated: true }),
              });
            }

            const finishedAt = new Date().toISOString();
            await fastify.db
              .update(socialRunStage)
              .set({
                status: "completed",
                completed_at: finishedAt,
                output_data: JSON.stringify({
                  url: result.url,
                  urls: result.urls,
                  provider: result.provider,
                  attempts: result.attempts,
                  regenerated: true,
                  custom_prompt: customPrompt ?? null,
                }),
              })
              .where(eq(socialRunStage.id, mediaStages[0].id));

            await fastify.db
              .update(socialRun)
              .set({ status: "pending_approval" as never, updated_at: finishedAt })
              .where(eq(socialRun.id, id));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const finishedAt = new Date().toISOString();
            await fastify.db
              .update(socialRunStage)
              .set({ status: "failed", completed_at: finishedAt, error_message: message })
              .where(eq(socialRunStage.id, mediaStages[0].id));
            await fastify.db
              .update(socialRun)
              .set({ status: "pending_approval" as never, error_message: message, updated_at: finishedAt })
              .where(eq(socialRun.id, id));
            fastify.log.error({ err, runId: id }, "regenerate-media failed");
            void AllImageProvidersFailed; // silence unused-import linter when err isn't this type
          }
        });

        return reply.status(202).send({
          run_id: id,
          action: "regenerate_media",
          status: "running",
          custom_prompt: customPrompt ?? null,
          message: customPrompt
            ? "Media regeneration started with edited prompt."
            : "Media regeneration started.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to regenerate media");
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── POST /api/social/runs/:id/select-draft ─────────────────────────────────
  fastify.post(
    "/api/social/runs/:id/select-draft",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { draft_id } = request.body as { draft_id: string };

      if (!draft_id) {
        return reply.status(400).send({ error: "draft_id is required" });
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

        const drafts = await fastify.db
          .select()
          .from(socialDraft)
          .where(
            and(eq(socialDraft.id, draft_id), eq(socialDraft.run_id, id))
          )
          .limit(1);

        if (drafts.length === 0) {
          return reply.status(404).send({
            error: `Draft ${draft_id} not found in run ${id}`,
          });
        }

        const now = new Date().toISOString();

        // Update run config_snapshot to record the selected draft
        const currentConfig = JSON.parse(runs[0].config_snapshot);
        currentConfig.selected_draft_id = draft_id;

        await fastify.db
          .update(socialRun)
          .set({
            config_snapshot: JSON.stringify(currentConfig),
            updated_at: now,
          })
          .where(eq(socialRun.id, id));

        return reply.send({
          run_id: id,
          selected_draft_id: draft_id,
          message: "Draft selected successfully",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to select draft");
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── POST /api/social/runs/:id/select-media ─────────────────────────────────
  fastify.post(
    "/api/social/runs/:id/select-media",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { asset_id } = request.body as { asset_id: string };

      if (!asset_id) {
        return reply.status(400).send({ error: "asset_id is required" });
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

        // Verify the asset belongs to a draft in this run
        const asset = await fastify.db
          .select()
          .from(socialMediaAsset)
          .where(eq(socialMediaAsset.id, asset_id))
          .limit(1);

        if (asset.length === 0) {
          return reply
            .status(404)
            .send({ error: `Asset ${asset_id} not found` });
        }

        // Check asset's draft belongs to this run
        const draft = await fastify.db
          .select()
          .from(socialDraft)
          .where(
            and(
              eq(socialDraft.id, asset[0].draft_id),
              eq(socialDraft.run_id, id)
            )
          )
          .limit(1);

        if (draft.length === 0) {
          return reply.status(400).send({
            error: `Asset ${asset_id} does not belong to run ${id}`,
          });
        }

        const now = new Date().toISOString();

        // Update run config_snapshot to record the selected media
        const currentConfig = JSON.parse(runs[0].config_snapshot);
        currentConfig.selected_asset_id = asset_id;

        await fastify.db
          .update(socialRun)
          .set({
            config_snapshot: JSON.stringify(currentConfig),
            updated_at: now,
          })
          .where(eq(socialRun.id, id));

        return reply.send({
          run_id: id,
          selected_asset_id: asset_id,
          message: "Media asset selected successfully",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "Failed to select media");
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── PUT /api/social/runs/:id/draft ──────────────────────────────────────────
  // Operator edits the draft text. We store the new content on the draft and
  // capture the change as a `social_learning` row so future runs can pull it
  // back into prompt construction.
  fastify.put("/api/social/runs/:id/draft", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { content, notes } = request.body as {
      content: string;
      notes?: string;
    };

    if (!content || typeof content !== "string") {
      return reply.status(400).send({ error: "content is required (string)" });
    }

    try {
      const drafts = await fastify.db
        .select()
        .from(socialDraft)
        .where(eq(socialDraft.run_id, id))
        .orderBy(socialDraft.variant_index)
        .limit(1);

      if (drafts.length === 0) {
        return reply.status(404).send({ error: "No draft for this run" });
      }

      const draft = drafts[0];
      const oldContent =
        draft.final_content ?? draft.humanized_content ?? draft.raw_content;
      const now = new Date().toISOString();

      await fastify.db
        .update(socialDraft)
        .set({
          final_content: content,
          character_count: content.length,
          status: "ready",
          updated_at: now,
        })
        .where(eq(socialDraft.id, draft.id));

      // Use the LLM to extract structured rules from the diff. The operator's
      // edit is the source of truth — we want rules that, when applied to a
      // future draft, would have produced the edited version directly.
      const { extractRulesFromEdit } = await import(
        "../../src/services/learning/rule-extractor.js"
      );
      const rules = await extractRulesFromEdit({
        platform: draft.platform,
        original: oldContent,
        edited: content,
        operatorNote: notes,
      });

      const learningIds: string[] = [];
      for (const rule of rules) {
        const learningId = uuidv4();
        learningIds.push(learningId);
        // platform: null = rule applies to ALL platforms. Operator's edits
        // are house-style guidance, not platform-specific. The pipeline's
        // loadActiveLearnings treats `platform=null OR platform=<run platform>`
        // as a match, so universal rules show up on every run.
        await fastify.db.insert(socialLearning).values({
          id: learningId,
          category: rule.category,
          platform: null,
          campaign_id: draft.campaign_id,
          content: rule.content,
          source_type: "draft_edit",
          source_run_id: id,
          confidence: 0.85,
          reinforcement_count: 1,
          last_reinforced_at: now,
          tags: JSON.stringify([...(rule.tags ?? []), 'universal']),
          active: true,
        });
      }

      return reply.send({
        ok: true,
        draft_id: draft.id,
        learning_ids: learningIds,
        rules_extracted: rules,
        message: `Draft updated. ${rules.length} rule(s) saved — future runs will follow them.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to edit draft");
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/runs/:id/improve-readability ──────────────────────────
  // Asks the LLM to rewrite the run's primary draft for higher Flesch reading
  // ease (shorter sentences, simpler words) while preserving every fact and
  // citation. Does NOT persist — returns the rewritten content so the
  // dashboard can show before/after and let the operator pick.
  fastify.post(
    "/api/social/runs/:id/improve-readability",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { content?: string; mode?: string };
      const aggressive = body.mode === "aggressive";

      try {
        const drafts = await fastify.db
          .select()
          .from(socialDraft)
          .where(eq(socialDraft.run_id, id));
        if (drafts.length === 0) {
          return reply.status(404).send({ error: "No drafts on this run" });
        }
        const draft = drafts[0];
        const source =
          (body.content && body.content.trim()) ||
          draft.final_content ||
          draft.humanized_content ||
          draft.raw_content ||
          "";
        if (!source) {
          return reply.status(400).send({ error: "Draft has no content to improve" });
        }

        const { llmGenerate } = await import("../../src/services/pipeline/llm.js");
        const standardRules = `- Prefer Anglo-Saxon over Latinate words ("use" not "utilize", "help" not "facilitate", "show" not "demonstrate"). Prefer active voice. Prefer one-clause sentences.`;
        const aggressiveRules = `- HARD CAP: maximum 14 words per sentence. Break anything longer.
- HARD CAP: prefer 1-2 syllable words. Replace every 3+ syllable word that has a 1-2 syllable equivalent ("utilize" → "use", "demonstrate" → "show", "facilitate" → "help", "approximately" → "about", "consequently" → "so", "additionally" → "also", "regarding" → "about", "subsequently" → "then").
- HARD CAP: no subordinate clauses chained with "which", "that", "where" — split into separate sentences.
- Active voice only. No passive constructions.
- One idea per sentence. Period. Move on.`;
        const system = `You are a readability editor. Rewrite the social post below to dramatically improve Flesch reading ease (shorter sentences, simpler words, fewer clauses).${aggressive ? "\n\nAGGRESSIVE MODE — push hard for simplicity, even at the cost of register. The operator wants grade-school readability." : ""}

ABSOLUTE RULES:
- Preserve every specific number, percentage, name, date, link, hashtag, and mention EXACTLY. Do not rephrase a number into words or vice versa.
- DO NOT add new facts, stats, named entities, or quotes that aren't in the source. False precision is worse than complexity.
- Keep the same approximate length (within ±15%).
- Keep the same intent and call-to-action.
${aggressive ? aggressiveRules : standardRules}

Return JSON ONLY (no markdown fences):
{
  "improved": "the rewritten post text",
  "changes": ["short bullet describing each substantive edit, e.g. 'Split sentence 2 into two', 'Replaced \"leverage\" with \"use\"'"]
}`;
        const raw = await llmGenerate(system, source, { temperature: 0.4, maxTokens: 1500 });
        const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        let improved = "";
        let changes: string[] = [];
        try {
          const parsed = JSON.parse(cleaned) as { improved?: string; changes?: string[] };
          improved = parsed.improved ?? "";
          changes = Array.isArray(parsed.changes) ? parsed.changes : [];
        } catch {
          improved = cleaned;
        }
        if (!improved) {
          return reply.status(502).send({ error: "Readability rewriter returned empty content" });
        }

        return reply.send({ ok: true, original: source, improved, changes });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        fastify.log.error({ err }, "improve-readability failed");
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ── POST /api/social/runs/:id/rerun ─────────────────────────────────────────
  // Creates a NEW run with the same campaign + brief, then kicks the pipeline
  // off asynchronously. Learnings from this campaign + platform are pulled
  // into the prompts at draft time (handled inside the pipeline).
  fastify.post("/api/social/runs/:id/rerun", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const orig = await fastify.db
        .select()
        .from(socialRun)
        .where(eq(socialRun.id, id))
        .limit(1);

      if (orig.length === 0) {
        return reply.status(404).send({ error: `Run ${id} not found` });
      }

      const config = (() => {
        try {
          return JSON.parse(orig[0].config_snapshot) as {
            platform?: string;
            brief?: { topic?: string };
          };
        } catch {
          return {};
        }
      })();

      const topic = config.brief?.topic;
      const platform = config.platform;
      if (!topic || !platform) {
        return reply.status(400).send({
          error:
            "Original run lacks topic/platform in config_snapshot — cannot rerun automatically.",
        });
      }

      // Pull applicable learnings: platform-specific OR universal (null
      // platform). Mirrors the filter the pipeline uses at runtime.
      const learnings = await fastify.db
        .select()
        .from(socialLearning)
        .where(
          and(
            eq(socialLearning.active, true),
            or(
              eq(socialLearning.platform, platform),
              isNull(socialLearning.platform),
            ),
          ),
        )
        .orderBy(desc(socialLearning.last_reinforced_at))
        .limit(50);

      // Kick off async — caller doesn't wait. Errors land in the run row.
      void (async () => {
        try {
          const { runBotPipeline } = await import("../../src/bot/pipeline.js");
          await (runBotPipeline as (
            db: typeof fastify.db,
            topic: string,
            platform: string,
          ) => Promise<unknown>)(fastify.db, topic, platform);
        } catch (err) {
          fastify.log.error({ err }, "Async rerun failed");
        }
      })();

      return reply.send({
        ok: true,
        message: `Rerun started for "${topic}" on ${platform}`,
        applicable_learnings: learnings.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to rerun");
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /api/social/media-assets ────────────────────────────────────────────
  // Flat list of every media asset with parent run/draft info, used by the
  // MediaStudio page in the dashboard.
  fastify.get("/api/social/media-assets", async (request, reply) => {
    try {
      const { type } = request.query as { type?: string };

      const baseRows = await fastify.db
        .select({
          id: socialMediaAsset.id,
          draft_id: socialMediaAsset.draft_id,
          type: socialMediaAsset.type,
          status: socialMediaAsset.status,
          prompt: socialMediaAsset.prompt,
          provider: socialMediaAsset.provider,
          model: socialMediaAsset.model,
          hosted_url: socialMediaAsset.hosted_url,
          source_url: socialMediaAsset.source_url,
          aspect_ratio: socialMediaAsset.aspect_ratio,
          created_at: socialMediaAsset.created_at,
        })
        .from(socialMediaAsset)
        .orderBy(desc(socialMediaAsset.created_at));

      const filtered = type ? baseRows.filter((r) => r.type === type) : baseRows;

      // Hydrate run + platform via a join in code (small N).
      const draftIds = Array.from(new Set(filtered.map((r) => r.draft_id)));
      const draftRows = draftIds.length
        ? await fastify.db
            .select({
              id: socialDraft.id,
              run_id: socialDraft.run_id,
              platform: socialDraft.platform,
            })
            .from(socialDraft)
            .where(eq(socialDraft.id, draftIds[0])) // placeholder — see below
        : [];

      // Drizzle's `inArray` is the right primitive but to keep this a single
      // surgical patch we just fetch all drafts and look up.
      const allDrafts = await fastify.db.select().from(socialDraft);
      const draftById = new Map(allDrafts.map((d) => [d.id, d]));

      const result = filtered.map((m) => {
        const d = draftById.get(m.draft_id);
        return {
          id: m.id,
          url: m.hosted_url ?? m.source_url ?? null,
          type: m.type,
          status: m.status,
          prompt: m.prompt,
          provider: m.provider,
          model: m.model,
          aspectRatio: m.aspect_ratio,
          createdAt: m.created_at,
          draftId: m.draft_id,
          runId: d?.run_id ?? null,
          platform: d?.platform ?? null,
        };
      });

      // Suppress unused warning on the placeholder fetch above.
      void draftRows;

      return reply.send({ media: result, total: result.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to list media assets");
      return reply.status(500).send({ error: message });
    }
  });

  done();
};

export default draftsRoutes;
