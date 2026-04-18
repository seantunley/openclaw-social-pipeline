import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  socialRun,
  socialRunStage,
  socialDraft,
} from '../../db/schema.js';
import { llmGenerate } from './llm.js';
import { generateImageFal, generateVideoFal, type VideoModel } from '../media/fal.service.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// --------------------------------------------------------------------------
// Types used internally by the pipeline
// --------------------------------------------------------------------------

interface DraftVariant {
  id: string;
  content: string;
  platform: string;
  variant_index: number;
}

interface DraftScore {
  draft_id: string;
  relevance: number;
  engagement: number;
  clarity: number;
  brand_fit: number;
  total: number;
}

interface ImageResult {
  url: string;
  prompt: string;
  aspect_ratio: string;
}

interface VideoResult {
  url: string;
  prompt: string;
  aspect_ratio: string;
  duration: number;
}

// --------------------------------------------------------------------------
// Pipeline Service
// --------------------------------------------------------------------------

export class PipelineService {
  constructor(private readonly db: BetterSQLite3Database) {}

  // -------------------------------- helpers --------------------------------

  /**
   * Record the start of a pipeline stage. Returns the stage row ID.
   */
  private async startStage(
    runId: string,
    stage: string,
    inputJson: unknown
  ): Promise<string> {
    const id = uuidv4();
    this.db.insert(socialRunStage).values({
      id,
      run_id: runId,
      stage,
      status: 'running',
      input_json: JSON.stringify(inputJson),
      started_at: new Date().toISOString(),
    }).run();
    return id;
  }

  /**
   * Mark a stage as completed with its output.
   */
  private async completeStage(
    stageId: string,
    outputJson: unknown
  ): Promise<void> {
    this.db
      .update(socialRunStage)
      .set({
        status: 'completed',
        output_json: JSON.stringify(outputJson),
        completed_at: new Date().toISOString(),
      })
      .where(eq(socialRunStage.id, stageId))
      .run();
  }

  /**
   * Mark a stage as failed with an error message.
   */
  private async failStage(stageId: string, error: string): Promise<void> {
    this.db
      .update(socialRunStage)
      .set({
        status: 'failed',
        output_json: JSON.stringify({ error }),
        completed_at: new Date().toISOString(),
      })
      .where(eq(socialRunStage.id, stageId))
      .run();
  }

  /**
   * Update the top-level run status.
   */
  private async updateRunStatus(runId: string, status: string): Promise<void> {
    this.db
      .update(socialRun)
      .set({ status, updated_at: new Date().toISOString() })
      .where(eq(socialRun.id, runId))
      .run();
  }

  /**
   * Fetch the run record by ID.
   */
  private getRun(runId: string) {
    const rows = this.db
      .select()
      .from(socialRun)
      .where(eq(socialRun.id, runId))
      .all();
    if (rows.length === 0) throw new Error(`Run not found: ${runId}`);
    return rows[0];
  }

  // ----------------------------- stage: collect ----------------------------

  /**
   * Reads the brief from the run record and formats context for downstream
   * stages.
   */
  async collect(runId: string): Promise<Record<string, unknown>> {
    const stageId = await this.startStage(runId, 'collect', { runId });
    try {
      const run = this.getRun(runId);
      const brief =
        typeof run.brief_json === 'string'
          ? JSON.parse(run.brief_json as string)
          : run.brief_json;

      const context = {
        run_id: runId,
        campaign_id: run.campaign_id,
        brief,
        platforms: brief?.platforms ?? [],
        goals: brief?.goals ?? [],
        audience: brief?.audience ?? '',
        tone: brief?.tone ?? '',
        collected_at: new Date().toISOString(),
      };

      await this.completeStage(stageId, context);
      return context;
    } catch (err) {
      await this.failStage(stageId, (err as Error).message);
      throw err;
    }
  }

  // ----------------------------- stage: research ---------------------------

  /**
   * Uses LLM to generate research/context from the campaign brief.
   */
  async research(runId: string, brief: Record<string, unknown>): Promise<string> {
    const stageId = await this.startStage(runId, 'research', brief);
    try {
      const systemPrompt = `You are a social media research assistant. Given a campaign brief, produce thorough research covering:
1. Target audience insights
2. Competitor content analysis
3. Trending topics and hashtags
4. Platform-specific best practices
5. Content angles and hooks

Return well-structured research notes.`;

      const userPrompt = `Campaign brief:\n${JSON.stringify(brief, null, 2)}`;

      const research = await llmGenerate(systemPrompt, userPrompt, {
        temperature: 0.6,
        maxTokens: 4096,
      });

      await this.completeStage(stageId, { research });
      return research;
    } catch (err) {
      await this.failStage(stageId, (err as Error).message);
      throw err;
    }
  }

  // ----------------------- stage: marketing psychology ---------------------

  /**
   * Applies marketing psychology principles to content using LLM.
   */
  async applyMarketingPsychology(
    runId: string,
    content: string,
    principles?: string[],
    intensity?: number
  ): Promise<string> {
    const stageId = await this.startStage(runId, 'psychology', {
      content_length: content.length,
      principles,
      intensity,
    });

    try {
      const effectiveIntensity = intensity ?? 0.5;
      const selectedPrinciples = principles ?? [
        'social proof',
        'scarcity',
        'reciprocity',
        'authority',
        'commitment and consistency',
      ];

      const systemPrompt = `You are a marketing psychology expert. Enhance the given social media content by applying psychology principles.

Principles to apply: ${selectedPrinciples.join(', ')}
Intensity level: ${effectiveIntensity} (0 = subtle, 1 = aggressive)

Rules:
- Preserve the core message and facts
- Make enhancements feel natural, not manipulative
- Keep the same approximate length
- Return ONLY the enhanced content, no explanations`;

      const enhanced = await llmGenerate(systemPrompt, content, {
        temperature: 0.5,
        maxTokens: 2048,
      });

      await this.completeStage(stageId, {
        original_length: content.length,
        enhanced_length: enhanced.length,
        principles: selectedPrinciples,
        intensity: effectiveIntensity,
        enhanced_content: enhanced,
      });

      return enhanced;
    } catch (err) {
      await this.failStage(stageId, (err as Error).message);
      throw err;
    }
  }

  // -------------------------- stage: generate drafts -----------------------

  /**
   * Generates multiple draft variants from research and psychology output.
   */
  async generateDrafts(
    runId: string,
    researchOutput: string,
    psychologyOutput: string,
    variantCount: number = 3
  ): Promise<DraftVariant[]> {
    const stageId = await this.startStage(runId, 'generate_drafts', {
      variant_count: variantCount,
    });

    try {
      const run = this.getRun(runId);
      const brief =
        typeof run.brief_json === 'string'
          ? JSON.parse(run.brief_json as string)
          : run.brief_json;
      const platforms: string[] = (brief as Record<string, unknown>)?.platforms as string[] ?? ['twitter'];

      const systemPrompt = `You are an expert social media copywriter. Generate ${variantCount} distinct content variants for each platform.

Each variant should:
- Have a unique angle or hook
- Be optimized for the specific platform
- Incorporate the research insights and psychology principles provided

Return a JSON array of objects with: { "content": "...", "platform": "...", "variant_index": <number> }
Return ONLY the JSON array, no markdown fences or explanations.`;

      const userPrompt = `Research:\n${researchOutput}\n\nPsychology-enhanced context:\n${psychologyOutput}\n\nPlatforms: ${platforms.join(', ')}\nVariants per platform: ${variantCount}`;

      const raw = await llmGenerate(systemPrompt, userPrompt, {
        temperature: 0.8,
        maxTokens: 8192,
      });

      // Parse the LLM output — handle possible markdown fences
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned) as Array<{
        content: string;
        platform: string;
        variant_index: number;
      }>;

      const drafts: DraftVariant[] = parsed.map((d, i) => {
        const id = uuidv4();
        // Persist each draft
        this.db.insert(socialDraft).values({
          id,
          run_id: runId,
          platform: d.platform,
          variant_index: d.variant_index ?? i,
          content: d.content,
          status: 'draft',
          created_at: new Date().toISOString(),
        }).run();

        return {
          id,
          content: d.content,
          platform: d.platform,
          variant_index: d.variant_index ?? i,
        };
      });

      await this.completeStage(stageId, { draft_count: drafts.length, drafts });
      return drafts;
    } catch (err) {
      await this.failStage(stageId, (err as Error).message);
      throw err;
    }
  }

  // --------------------------- stage: score drafts -------------------------

  /**
   * Scores each draft on relevance, engagement, clarity, and brand_fit.
   */
  async scoreDrafts(runId: string, drafts: DraftVariant[]): Promise<DraftScore[]> {
    const stageId = await this.startStage(runId, 'score_drafts', {
      draft_count: drafts.length,
    });

    try {
      const systemPrompt = `You are a content quality evaluator. Score each social media draft on these dimensions (0-100 each):
- relevance: how well it addresses the campaign brief
- engagement: predicted audience engagement potential
- clarity: how clear and easy to understand the message is
- brand_fit: how well it matches professional brand standards

Return a JSON array of: { "draft_id": "...", "relevance": N, "engagement": N, "clarity": N, "brand_fit": N, "total": N }
where total = average of the four scores.
Return ONLY the JSON array.`;

      const userPrompt = drafts
        .map((d) => `[Draft ${d.id} — ${d.platform}]:\n${d.content}`)
        .join('\n\n---\n\n');

      const raw = await llmGenerate(systemPrompt, userPrompt, {
        temperature: 0.3,
        maxTokens: 4096,
      });

      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const scores = JSON.parse(cleaned) as DraftScore[];

      // Update draft records with scores
      for (const score of scores) {
        this.db
          .update(socialDraft)
          .set({
            score_json: JSON.stringify(score),
            updated_at: new Date().toISOString(),
          })
          .where(eq(socialDraft.id, score.draft_id))
          .run();
      }

      await this.completeStage(stageId, { scores });
      return scores;
    } catch (err) {
      await this.failStage(stageId, (err as Error).message);
      throw err;
    }
  }

  // ----------------------------- stage: humanize ---------------------------

  /**
   * Applies humanizer pass to remove AI writing patterns.
   */
  async applyHumanizer(
    runId: string,
    content: string,
    aggressiveness?: number
  ): Promise<string> {
    const stageId = await this.startStage(runId, 'humanize', {
      content_length: content.length,
      aggressiveness,
    });

    try {
      const level = aggressiveness ?? 0.6;

      const systemPrompt = `You are a humanizer that rewrites AI-generated text to sound natural and human-written.

Aggressiveness: ${level} (0 = light touch, 1 = heavy rewrite)

Detect and fix these AI patterns:
- Overuse of "Furthermore", "Moreover", "In conclusion", "It's worth noting"
- Excessive hedging ("It should be noted that", "One might argue")
- Unnaturally perfect parallel structure
- Overly formal or stiff phrasing
- Generic filler phrases
- Predictable sentence rhythm

Rules:
- Preserve all facts, links, hashtags, and mentions
- Keep the same approximate length
- Maintain the original tone/voice intent
- Return ONLY the rewritten content`;

      const humanized = await llmGenerate(systemPrompt, content, {
        temperature: 0.7,
        maxTokens: 2048,
      });

      await this.completeStage(stageId, {
        original_length: content.length,
        humanized_length: humanized.length,
        aggressiveness: level,
        humanized_content: humanized,
      });

      return humanized;
    } catch (err) {
      await this.failStage(stageId, (err as Error).message);
      throw err;
    }
  }

  // ----------------------- stage: compliance check -------------------------

  /**
   * Checks content against brand/tone compliance rules.
   */
  async checkCompliance(
    runId: string,
    content: string
  ): Promise<{ passed: boolean; issues: string[] }> {
    const stageId = await this.startStage(runId, 'compliance', {
      content_length: content.length,
    });

    try {
      const systemPrompt = `You are a brand compliance checker for social media content. Evaluate the content for:
1. Profanity or inappropriate language
2. Potentially offensive or insensitive content
3. Unsubstantiated claims or misleading statements
4. Legal risks (unqualified health/financial claims)
5. Tone consistency (professional but approachable)

Return a JSON object: { "passed": boolean, "issues": ["issue1", "issue2", ...] }
If all checks pass, return { "passed": true, "issues": [] }
Return ONLY the JSON object.`;

      const raw = await llmGenerate(systemPrompt, content, {
        temperature: 0.2,
        maxTokens: 1024,
      });

      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const result = JSON.parse(cleaned) as { passed: boolean; issues: string[] };

      await this.completeStage(stageId, result);
      return result;
    } catch (err) {
      await this.failStage(stageId, (err as Error).message);
      throw err;
    }
  }

  // ----------------------- stage: generate image ---------------------------

  /**
   * Generates an image asset.
   * Uses fal.ai (nano-banana-2 with editorial prompt tuning) when provider is 'fal'.
   * Falls back to a no-op for other providers until they are wired up.
   */
  async generateImage(
    runId: string,
    prompt: string,
    aspectRatio?: string,
    options?: { provider?: string; platform?: string; title?: string; body?: string; format?: string }
  ): Promise<ImageResult> {
    const stageId = await this.startStage(runId, 'generate_image', {
      prompt,
      aspect_ratio: aspectRatio,
      provider: options?.provider,
    });

    try {
      const provider = options?.provider ?? process.env.IMAGE_PROVIDER ?? 'fal';

      if (provider === 'fal') {
        const urls = await generateImageFal({
          title: options?.title ?? prompt,
          body: options?.body ?? prompt,
          platform: options?.platform ?? 'linkedin',
          aspectRatio,
          format: options?.format,
        });
        const result: ImageResult = {
          url: urls[0],
          prompt,
          aspect_ratio: aspectRatio ?? '1:1',
        };
        await this.completeStage(stageId, { ...result, all_urls: urls, provider: 'fal' });
        return result;
      }

      // Non-fal provider — return empty result for now
      const result: ImageResult = { url: '', prompt, aspect_ratio: aspectRatio ?? '1:1' };
      await this.completeStage(stageId, { ...result, provider, note: 'Provider not yet implemented' });
      return result;
    } catch (err) {
      await this.failStage(stageId, (err as Error).message);
      throw err;
    }
  }

  // ----------------------- stage: generate video ---------------------------

  /**
   * Generates a video asset.
   * Uses fal.ai (kling-v3/wan/sora/longcat with cinematic prompt tuning) when provider is 'fal'.
   */
  async generateVideo(
    runId: string,
    prompt: string,
    aspectRatio?: string,
    duration?: number,
    options?: { provider?: string; platform?: string; title?: string; body?: string; model?: string }
  ): Promise<VideoResult> {
    const stageId = await this.startStage(runId, 'generate_video', {
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      provider: options?.provider,
      model: options?.model,
    });

    try {
      const provider = options?.provider ?? process.env.VIDEO_PROVIDER ?? 'fal';

      if (provider === 'fal') {
        const urls = await generateVideoFal({
          title: options?.title ?? prompt,
          body: options?.body ?? prompt,
          platform: options?.platform ?? 'linkedin',
          model: (options?.model as VideoModel) ?? 'kling-v3',
          duration: duration ?? 10,
        });
        const result: VideoResult = {
          url: urls[0],
          prompt,
          aspect_ratio: aspectRatio ?? '16:9',
          duration: duration ?? 10,
        };
        await this.completeStage(stageId, { ...result, provider: 'fal', model: options?.model ?? 'kling-v3' });
        return result;
      }

      // Non-fal provider — return empty result for now
      const result: VideoResult = { url: '', prompt, aspect_ratio: aspectRatio ?? '16:9', duration: duration ?? 10 };
      await this.completeStage(stageId, { ...result, provider, note: 'Provider not yet implemented' });
      return result;
    } catch (err) {
      await this.failStage(stageId, (err as Error).message);
      throw err;
    }
  }

  // ---------------------- full pipeline orchestration -----------------------

  /**
   * Executes the entire content pipeline in order:
   * collect → research → psychology → drafts → score → humanize → compliance
   *
   * Updates run status at each step.
   */
  async executeFullPipeline(runId: string): Promise<{
    drafts: DraftVariant[];
    scores: DraftScore[];
    compliance: { passed: boolean; issues: string[] };
  }> {
    try {
      await this.updateRunStatus(runId, 'running');

      // 1. Collect brief & context
      const context = await this.collect(runId);

      // 2. Research
      const brief = context.brief as Record<string, unknown>;
      const research = await this.research(runId, brief);

      // 3. Marketing psychology
      const psychologyContent = await this.applyMarketingPsychology(
        runId,
        research,
        (brief.psychology_principles as string[]) ?? undefined,
        (brief.psychology_intensity as number) ?? undefined
      );

      // 4. Generate draft variants
      const variantCount = (brief.variant_count as number) ?? 3;
      const drafts = await this.generateDrafts(
        runId,
        research,
        psychologyContent,
        variantCount
      );

      // 5. Score drafts
      const scores = await this.scoreDrafts(runId, drafts);

      // 6. Humanize the top-scoring draft per platform
      const platformBest = new Map<string, DraftVariant>();
      for (const draft of drafts) {
        const score = scores.find((s) => s.draft_id === draft.id);
        const existing = platformBest.get(draft.platform);
        if (!existing || (score && score.total > (scores.find((s) => s.draft_id === existing.id)?.total ?? 0))) {
          platformBest.set(draft.platform, draft);
        }
      }

      for (const [, bestDraft] of platformBest) {
        const humanized = await this.applyHumanizer(
          runId,
          bestDraft.content,
          (brief.humanizer_aggressiveness as number) ?? undefined
        );

        // Update the draft with humanized content
        this.db
          .update(socialDraft)
          .set({
            content: humanized,
            status: 'humanized',
            updated_at: new Date().toISOString(),
          })
          .where(eq(socialDraft.id, bestDraft.id))
          .run();

        bestDraft.content = humanized;
      }

      // 7. Compliance check on all humanized drafts
      const allContent = Array.from(platformBest.values())
        .map((d) => `[${d.platform}]: ${d.content}`)
        .join('\n\n');
      const compliance = await this.checkCompliance(runId, allContent);

      // Update run status
      const finalStatus = compliance.passed ? 'completed' : 'compliance_failed';
      await this.updateRunStatus(runId, finalStatus);

      return { drafts, scores, compliance };
    } catch (err) {
      await this.updateRunStatus(runId, 'failed');
      throw err;
    }
  }
}
