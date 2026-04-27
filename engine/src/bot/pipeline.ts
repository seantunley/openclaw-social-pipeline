/**
 * Bot-side pipeline orchestration.
 *
 * Drives the SEO/GEO-first content pipeline directly off the engine services,
 * persisting state to the same SQLite DB the dashboard reads from. Returns
 * everything the bot needs to render the approval card.
 *
 * Pipeline stages (each one writes a `social_run_stage` row that the
 * dashboard's PipelineTimeline component reads):
 *   generate    — research (Claude + web_search) → SEO+GEO draft
 *   psychology  — marketing psychology enhancement pass
 *   humanize    — strip AI writing tells
 *   compliance  — bundled into humanize stage's output_data (no schema slot)
 *   media       — image generation (fal.ai). Non-fatal if it fails.
 *   approve     — left in 'pending' state for operator to act on. Run status
 *                 transitions from 'running' → 'pending_approval' at this point.
 *   publish     — pending until approve
 *   analytics   — pending until publish
 */

import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  socialCampaign,
  socialRun,
  socialRunStage,
  socialDraft,
  socialMediaAsset,
  socialLearning,
} from '../db/schema.js';
import {
  llmGenerate,
  llmGenerateWithSearch,
  llmGenerateWithSearchAndAttempts,
  AllProvidersFailed,
  type LlmAttempt,
} from '../services/pipeline/llm.js';
import {
  generateSeoGeo,
  type SeoGeoGenerateResult,
} from '../services/seo-geo/seo-geo.service.js';
import { generateImage, type ImageAttempt } from '../services/media/index.js';
import { formatRulesForPrompt } from '../services/learning/rule-extractor.js';
import {
  loadBrandProfile,
  formatBrandProfileForPrompt,
} from '../services/brand/brand-profile.service.js';
import {
  getPlatformSpec,
  formatSpecForPrompt,
  truncateToLimit,
  resolveFormat,
} from '../services/platform/specs.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

type Db = BetterSQLite3Database<Record<string, unknown>>;

const DEFAULT_CAMPAIGN_ID = 'telegram-default';
const DEFAULT_CAMPAIGN_NAME = 'Telegram Bot';

type StageName =
  | 'generate'
  | 'humanize'
  | 'psychology'
  | 'media'
  | 'approve'
  | 'publish'
  | 'analytics';

const STAGE_ORDER: StageName[] = [
  'generate',
  'humanize',
  'psychology',
  'media',
  'approve',
  'publish',
  'analytics',
];

export interface BotPipelineResult {
  runId: string;
  draftId: string;
  assetId: string;
  topic: string;
  platform: string;
  content: string;
  imageUrl: string;
  scores: {
    seo_score?: number;
    geo_score?: number;
    combined_score?: number;
    ai_citation_readiness?: string;
  };
  compliance: { passed: boolean; issues: string[] } | null;
}

export interface BotPipelineHooks {
  onProgress?: (stage: string) => void | Promise<void>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function ensureDefaultCampaign(db: Db): string {
  const existing = db
    .select()
    .from(socialCampaign)
    .where(eq(socialCampaign.id, DEFAULT_CAMPAIGN_ID))
    .all();
  if (existing.length > 0) return DEFAULT_CAMPAIGN_ID;
  db.insert(socialCampaign)
    .values({
      id: DEFAULT_CAMPAIGN_ID,
      name: DEFAULT_CAMPAIGN_NAME,
      description: 'Default campaign for runs initiated from the Telegram bot.',
      status: 'active',
      target_platforms: JSON.stringify(['linkedin']),
      target_audience: '',
      brand_voice_notes: '',
      goals: JSON.stringify(['SEO', 'GEO', 'AI citation readiness']),
      tags: JSON.stringify(['telegram', 'auto']),
    })
    .run();
  return DEFAULT_CAMPAIGN_ID;
}

function createStageRecords(db: Db, runId: string) {
  const now = new Date().toISOString();
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    db.insert(socialRunStage)
      .values({
        id: uuidv4(),
        run_id: runId,
        stage_name: STAGE_ORDER[i],
        status: 'pending',
        order_index: i,
        created_at: now,
      })
      .run();
  }
}

function startStage(db: Db, runId: string, stage: StageName): void {
  const now = new Date().toISOString();
  db.update(socialRunStage)
    .set({ status: 'running', started_at: now })
    .where(
      and(
        eq(socialRunStage.run_id, runId),
        eq(socialRunStage.stage_name, stage),
      ),
    )
    .run();
}

function completeStage(
  db: Db,
  runId: string,
  stage: StageName,
  output: unknown,
): void {
  const now = new Date().toISOString();
  db.update(socialRunStage)
    .set({
      status: 'completed',
      completed_at: now,
      output_data: JSON.stringify(output ?? {}),
    })
    .where(
      and(
        eq(socialRunStage.run_id, runId),
        eq(socialRunStage.stage_name, stage),
      ),
    )
    .run();
}

function failStage(
  db: Db,
  runId: string,
  stage: StageName,
  error: string,
): void {
  const now = new Date().toISOString();
  db.update(socialRunStage)
    .set({
      status: 'failed',
      completed_at: now,
      error_message: error,
    })
    .where(
      and(
        eq(socialRunStage.run_id, runId),
        eq(socialRunStage.stage_name, stage),
      ),
    )
    .run();
}

// ─── learning loader ────────────────────────────────────────────────────────

interface ActiveRule {
  category: string;
  content: string;
}

/**
 * Pull every active learning that applies to this platform (rules with
 * platform=null apply universally). Used at the start of a run; the rules
 * are then folded into every generation prompt.
 */
function loadActiveLearnings(db: Db, platform: string): ActiveRule[] {
  const rows = db
    .select()
    .from(socialLearning)
    .where(eq(socialLearning.active, true))
    .orderBy(desc(socialLearning.last_reinforced_at))
    .limit(50)
    .all();

  // Filter to platform-specific or universal rules. Doing this in code
  // (rather than SQL) because the WHERE-clause OR with NULL handling in
  // Drizzle is fiddly and the row count is small.
  return rows
    .filter((r) => !r.platform || r.platform === platform)
    .map((r) => ({ category: r.category, content: r.content }));
}

// ─── NO-FABRICATION rule (the hardest rule in the system) ──────────────────
//
// Marketing voice can be subjective. Facts cannot. The user's hardest rule:
// "We never make things up to reinforce a position." Every content stage
// gets this block prepended so the LLM is never tempted to invent stats,
// names, dates, or quotes — even when "social proof" or "specificity"
// would benefit the post.
//
// Triggered when the humanizer once invented "37% uptime thinking is
// obsolete" — a plausible-sounding but completely fabricated stat. The
// fact that it sounded real is exactly the problem.

const NO_FABRICATION_BLOCK = `
ABSOLUTE RULE — DO NOT FABRICATE.

Do not invent or strengthen evidence. Specifically banned:
- Specific percentages, dollar amounts, dates, durations, year-over-year deltas — unless the exact number appears verbatim in the research notes / source content above.
- Named people, companies, studies, reports, publications — unless cited in the source above.
- Quotes or paraphrased statements attributed to anyone — unless cited in the source above.
- Rounded-but-specific figures ("3 in 10", "twice as likely", "30% faster", "since 2020") that read as research-derived but aren't.
- Hypothetical scenarios stated in declarative voice ("Companies that…", "Most teams…") — qualify with "in our experience", "many", "often", or remove.

Allowed:
- Opinion, perspective, framing, persuasion, calls to action.
- Clear hyperbole and metaphor (figurative register, not factual).
- Generic claims with honest qualifiers ("often", "many", "in our experience" when the experience is the brand's own).

When in doubt: remove the false-precision rather than invent a citation. "37% uptime thinking is obsolete" → "Old uptime thinking is obsolete". Same point, no fabrication.
`;

// ─── stage prompts ──────────────────────────────────────────────────────────

async function research(
  topic: string,
  platform: string,
  rulesBlock: string,
): Promise<{ text: string; usedSearch: boolean; attempts: LlmAttempt[] }> {
  const system = `You are a social media research assistant. Use the web_search tool to gather fresh, sourced facts about the topic before answering.

Produce concise research notes covering:
- Audience that cares about this on ${platform}
- 3-5 specific, recent, citable facts (with concrete numbers, names, or outcomes — cite the source where possible)
- 2-3 angles a content creator could take
- E-E-A-T signals worth surfacing (experience, expertise, authority, trust)

Return plain text, well-structured, ~250 words. Prioritise citability — every claim should be the kind of statement an AI search engine could quote back.

${NO_FABRICATION_BLOCK}
Research is the ONLY place facts enter the pipeline. If web_search doesn't return a fact, omit the claim — do not retrieve it from training data and present it as current. When sourcing is uncertain, say so ("commonly reported", "per industry guidance"). Better a thinner research note than fake citations.${rulesBlock}`;
  return llmGenerateWithSearchAndAttempts(
    system,
    `Topic: ${topic}\nPlatform: ${platform}`,
    { maxTokens: 4096 },
  );
}

interface PsychologyResult {
  enhanced: string;
  principles_applied: string[];
  changes: string[];
}

async function applyPsychology(
  content: string,
  platform: string,
  rulesBlock: string,
): Promise<PsychologyResult> {
  const system = `You are a marketing psychology expert. Enhance the given social media draft using these principles where they fit naturally — BUT ONLY when the supporting evidence already exists in the draft. Never add evidence to enable a principle.
- Social proof — surface stats/citations ALREADY in the draft; do not introduce new ones.
- Authority — strengthen voicing of cited sources that are ALREADY present.
- Scarcity / urgency — only when honest; never invent it.
- Loss aversion — frame what gets lost without action (subjective framing, not invented stats).
- Reciprocity — give insight before asking for engagement.
- Specificity — concrete > vague, but only with concrete details present in the draft.

Rules:
- Preserve every fact and citation; only re-frame, re-order, or sharpen.
- DO NOT add new specific numbers, percentages, named entities, or stats not present in the draft.
- Don't make the post longer than ~10% over its current length.
- Keep platform tone (${platform}).
- Don't manufacture pressure or fake urgency.

${NO_FABRICATION_BLOCK}

Return JSON ONLY (no markdown fences):
{
  "enhanced": "the rewritten post text",
  "principles_applied": ["social_proof", "authority", ...],
  "changes": ["short bullet describing each substantive change"]
}${rulesBlock}`;
  const raw = await llmGenerate(system, content, { temperature: 0.5, maxTokens: 2048 });
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<PsychologyResult>;
    return {
      enhanced: parsed.enhanced ?? content,
      principles_applied: Array.isArray(parsed.principles_applied)
        ? parsed.principles_applied
        : [],
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    };
  } catch {
    // Model didn't return JSON — keep the raw text as the enhanced version
    // so the pipeline doesn't break, but flag that we have no structured data.
    return { enhanced: cleaned || content, principles_applied: [], changes: [] };
  }
}

interface HumanizeResult {
  humanized: string;
  patterns_removed: string[];
  changes: string[];
}

async function humanize(content: string, rulesBlock: string): Promise<HumanizeResult> {
  const system = `You are a humanizer that rewrites AI-generated text to sound natural and human-written.
Detect and fix:
- Furthermore / Moreover / In conclusion / It's worth noting
- Excessive hedging
- Overly perfect parallel structure
- Generic filler

Rules:
- Preserve facts, links, hashtags, mentions EXACTLY — no rephrasing of numbers or names.
- DO NOT add new stats, percentages, named entities, dates, durations, year-over-year deltas, or "harder hooks" backed by invented data. Sharpening rhythm is fine; sharpening evidence is forbidden.
- Same approximate length.
- Maintain tone.

${NO_FABRICATION_BLOCK}
The humanizer is the highest-risk stage for fabrication — it tightens language into harder hooks, and that's exactly where fake stats slip in. If the input has no specific number, the output must have no specific number. Period.

Return JSON ONLY (no markdown fences):
{
  "humanized": "the rewritten post text",
  "patterns_removed": ["Furthermore as opener", "hedging in paragraph 2", ...],
  "changes": ["short bullet describing each substantive edit"]
}${rulesBlock}`;
  const raw = await llmGenerate(system, content, { temperature: 0.7, maxTokens: 1500 });
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<HumanizeResult>;
    return {
      humanized: parsed.humanized ?? content,
      patterns_removed: Array.isArray(parsed.patterns_removed)
        ? parsed.patterns_removed
        : [],
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    };
  } catch {
    return { humanized: cleaned || content, patterns_removed: [], changes: [] };
  }
}

async function checkCompliance(
  content: string,
): Promise<{ passed: boolean; issues: string[] }> {
  const system = `You are a brand compliance checker for social media content. Evaluate the content for:
1. Profanity or inappropriate language
2. Potentially offensive or insensitive framing
3. **Fabricated facts** — any specific number (percentage, dollar amount, "3 in 10", "twice as likely", year-over-year delta), named person/company/study/report, or attributed quote that is presented as factual without an obvious source. This is the HARDEST rule. Flag every unsourced specific claim, even if it sounds plausible. False precision is worse than vagueness.
4. Unsubstantiated claims or misleading statements (broader category — e.g. "the industry standard", "research shows" without citing).
5. Legal risks (unqualified health, financial, or safety claims).
6. Tone consistency (professional but approachable).

For category 3 specifically: if the content contains a specific number, name, date, or stat, ask "would this be defensible if a journalist asked for the source?". If not, raise it as an issue.

Return a JSON object: {"passed": boolean, "issues": [string, ...]}.
Each issue should name the offending phrase verbatim and the category, e.g.:
  "Fabricated stat: '37% uptime thinking is obsolete' — no source provided."
If everything is fine, return {"passed": true, "issues": []}.
Return ONLY the JSON object — no markdown, no preamble.`;
  const raw = await llmGenerate(system, content, { temperature: 0.2, maxTokens: 1024 });
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as { passed?: boolean; issues?: string[] };
    return {
      passed: parsed.passed !== false,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    };
  } catch {
    // If parsing fails, surface it as a compliance issue rather than burning the run.
    return {
      passed: false,
      issues: [`Compliance check returned non-JSON: ${cleaned.slice(0, 200)}`],
    };
  }
}

// ─── pipeline ───────────────────────────────────────────────────────────────

export interface RunBotPipelineOptions {
  /**
   * Optional format selector — picks an alt format declared on the
   * platform spec (e.g. 'carousel', 'reel', 'short', 'landscape').
   * Falls through to the platform default when omitted or unknown.
   */
  format?: string | null;
  /**
   * Fired synchronously immediately after the run row is inserted, so
   * fire-and-forget callers (the dashboard `/runs/start` endpoint) can
   * return the runId in their HTTP response and let the UI poll status
   * without racing the long-running pipeline body.
   */
  onRunCreated?: (runId: string) => void;
  /**
   * Pre-generated runId — used by the scheduler to preserve the id of a
   * placeholder row that was created at schedule-time. When set, the
   * pipeline will UPDATE that row instead of inserting a new one.
   */
  runId?: string;
  /** Override for the run's `trigger` column ('manual' | 'scheduled' | 'workflow'). */
  trigger?: 'manual' | 'scheduled' | 'workflow';
}

/**
 * Build a readable run ID like `linkedin-20260427-1830-smoke-test-fallback-3a9f`.
 * Slug from topic + ISO date/time + short random suffix for uniqueness.
 * Way easier to scan in logs than a raw UUID.
 */
export function generateReadableRunId(topic: string, platform: string): string {
  const slug = topic
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 5)
    .join('-')
    .slice(0, 40) || 'run';
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${platform}-${stamp}-${slug}-${suffix}`;
}

export async function runBotPipeline(
  db: Db,
  topic: string,
  platform: string,
  hooks: BotPipelineHooks = {},
  options: RunBotPipelineOptions = {},
): Promise<BotPipelineResult> {
  const campaignId = ensureDefaultCampaign(db);
  const runId = options.runId ?? generateReadableRunId(topic, platform);
  const draftId = uuidv4();
  const assetId = uuidv4();
  const now = () => new Date().toISOString();
  const trigger = options.trigger ?? 'manual';

  // If the scheduler pre-created a placeholder row, UPDATE it in place so
  // the dashboard's run-detail link stays valid. Otherwise INSERT fresh.
  const existing = options.runId
    ? db.select().from(socialRun).where(eq(socialRun.id, options.runId)).all()
    : [];
  if (existing.length > 0) {
    db.update(socialRun)
      .set({
        status: 'running',
        trigger,
        config_snapshot: JSON.stringify({
          platform,
          format: options.format ?? null,
          brief: { topic, platforms: [platform] },
          media_mode: 'image',
          source: trigger === 'scheduled' ? 'smart-scheduler' : 'telegram-bot',
        }),
        started_at: now(),
        updated_at: now(),
      })
      .where(eq(socialRun.id, runId))
      .run();
  } else {
    db.insert(socialRun)
      .values({
        id: runId,
        campaign_id: campaignId,
        status: 'running',
        trigger,
        config_snapshot: JSON.stringify({
          platform,
          format: options.format ?? null,
          brief: { topic, platforms: [platform] },
          media_mode: 'image',
          source: trigger === 'scheduled' ? 'smart-scheduler' : 'telegram-bot',
        }),
        started_at: now(),
      })
      .run();
  }

  createStageRecords(db, runId);

  if (options.onRunCreated) {
    try { options.onRunCreated(runId); } catch { /* hook failure must not abort the run */ }
  }

  // Load every active rule once at the top of the run. Rules accumulate
  // across edits, so the bot converges on the operator's voice over time.
  const rules = loadActiveLearnings(db, platform);
  const rulesBlock = formatRulesForPrompt(rules);

  // Load the brand voice profile for this campaign (or workspace default).
  // Brand profile renders BEFORE rules in the prompt — explicit brand canon
  // outranks implicit edit-derived patterns.
  const brand = loadBrandProfile(db, campaignId);
  const brandBlock = formatBrandProfileForPrompt(brand);

  // Resolve the platform spec once. Folded into every generation prompt so
  // the model knows the char limit, hashtag count, disclosures, etc., and
  // used post-generation to enforce truncation as a safety net.
  const spec = getPlatformSpec(platform);
  // Resolve the format up front. The spec block embeds format-specific
  // authoring instructions (carousel slide structure, reel hook, etc.),
  // and the media stage reads it for aspect-ratio + carousel fan-out.
  const formatId = options.format ?? null;
  const resolvedFormat = resolveFormat(spec, formatId);
  const specBlock = formatSpecForPrompt(spec, formatId);

  // Order in the prompt: spec (hard rules) → brand (canon) → learnings.
  const guidanceBlock = specBlock + brandBlock + rulesBlock;

  try {
    // ── generate stage: research + SEO+GEO draft ────────────────────────────
    startStage(db, runId, 'generate');
    await hooks.onProgress?.(`🔍 Researching${rules.length ? ` (applying ${rules.length} rules)` : ''}`);
    const researchResult = await research(topic, platform, guidanceBlock);
    const researchNotes = researchResult.text;
    if (!researchResult.usedSearch) {
      // Surface degraded-research mode in the operator-visible progress
      // stream so it's not a silent quality drop.
      await hooks.onProgress?.(
        '⚠️ Live web search unavailable; researching from model knowledge',
      );
    }

    await hooks.onProgress?.('✍️ Generating SEO + GEO draft');
    const seoGeo: SeoGeoGenerateResult = await generateSeoGeo({
      topic,
      platform,
      key_facts: extractFacts(researchNotes),
      extraInstructions: guidanceBlock,
    });
    const draftedContent = seoGeo.content ?? seoGeo.raw_response ?? '';
    if (!draftedContent) throw new Error('SEO+GEO generation returned empty content');
    completeStage(db, runId, 'generate', {
      research: researchNotes,
      research_used_search: researchResult.usedSearch,
      research_attempts: researchResult.attempts,
      seo_score: numeric(seoGeo.seo_score),
      geo_score: numeric(seoGeo.geo_score),
      combined_score: seoGeo.combined_score,
    });

    // ── psychology stage ────────────────────────────────────────────────────
    startStage(db, runId, 'psychology');
    await hooks.onProgress?.('🧠 Applying psychology');
    const psych = await applyPsychology(draftedContent, platform, guidanceBlock);
    completeStage(db, runId, 'psychology', {
      // Persist before/after side-by-side so the dashboard can render a diff.
      before: draftedContent,
      enhanced: psych.enhanced,
      principles_applied: psych.principles_applied,
      changes: psych.changes,
    });

    // ── humanize stage (also runs compliance and stores it in output_data) ──
    startStage(db, runId, 'humanize');
    await hooks.onProgress?.('🤖 Humanizing');
    const hum = await humanize(psych.enhanced, guidanceBlock);

    await hooks.onProgress?.('✅ Compliance check');
    const compliance = await checkCompliance(hum.humanized);
    // Safety net: hard-truncate to the platform's char limit before persist.
    // The prompt already asks the model to stay under, but if it overshoots
    // we'd rather ship a clean truncated draft than a rejected one.
    const enforced = truncateToLimit(hum.humanized, spec);
    if (enforced.truncated) {
      compliance.issues.push(
        `Content exceeded ${spec.label} ${spec.content.charLimit}-char limit; auto-truncated.`,
      );
    }

    completeStage(db, runId, 'humanize', {
      before: psych.enhanced,
      humanized: enforced.content,
      patterns_removed: hum.patterns_removed,
      changes: hum.changes,
      compliance,
      truncated: enforced.truncated,
    });
    const finalContent = enforced.content;

    // Persist the draft now so the dashboard sees it even if media fails.
    db.insert(socialDraft)
      .values({
        id: draftId,
        run_id: runId,
        campaign_id: campaignId,
        platform,
        variant_index: 0,
        status: 'media_pending',
        raw_content: draftedContent,
        humanized_content: hum.humanized,
        final_content: finalContent,
        // Fall back to combined_score when the model only returns the
        // combined value — better to show 90 than a null. brand_score
        // mirrors geo_score when present, otherwise also combined.
        seo_score: numeric(seoGeo.seo_score) ?? numeric(seoGeo.combined_score),
        brand_score: numeric(seoGeo.geo_score) ?? numeric(seoGeo.combined_score),
        character_count: finalContent.length,
        metadata: JSON.stringify({
          research_notes: researchNotes,
          seo_details: seoGeo.seo_details,
          eeat_signals: seoGeo.eeat_signals,
          combined_score: seoGeo.combined_score,
          ai_citation_readiness: seoGeo.ai_citation_readiness,
          psychology_enhanced: psych.enhanced,
          principles_applied: psych.principles_applied,
          patterns_removed: hum.patterns_removed,
          compliance,
          source: 'telegram-bot',
        }),
      })
      .run();

    // ── media stage ─────────────────────────────────────────────────────────
    startStage(db, runId, 'media');
    // Per-format aspect: carousel fans out to one image per slide; reel /
    // story / short get vertical 9:16; landscape gets 16:9; and so on.
    // The default (no format) uses the platform's primary aspect.
    const mediaAspect = resolvedFormat?.aspectRatio ?? spec.media.imageAspectRatio;
    const isCarousel = !!resolvedFormat && resolvedFormat.id === 'carousel';
    await hooks.onProgress?.(
      isCarousel ? '🎨 Generating carousel slides' : '🎨 Generating image',
    );
    // Pass the format string through to the orchestrator so the carousel
    // branch in fal.service can fan out. Format id is normalised to
    // platform-prefixed form (`instagram_carousel`) since that's what the
    // existing carousel detector expects.
    const formatForMedia = resolvedFormat
      ? `${platform}_${resolvedFormat.id}`
      : undefined;
    let mediaResult: Awaited<ReturnType<typeof generateImage>>;
    try {
      mediaResult = await generateImage({
        title: topic,
        body: finalContent,
        platform,
        aspectRatio: mediaAspect,
        format: formatForMedia,
      });
    } catch (err) {
      // Every provider failed. Persist the rich AllImageProvidersFailed
      // message so the dashboard surfaces what the operator needs to do
      // (top up credits, codex login, switch IMAGE_PROVIDER, etc.) — but
      // keep the run alive at pending_approval so they can publish
      // text-only or click "regenerate media" once they've fixed it.
      const message = err instanceof Error ? err.message : String(err);
      const attempts = (err as { attempts?: ImageAttempt[] }).attempts ?? [];
      mediaResult = { url: '', urls: [], prompts: [], provider: 'none', attempts };
      failStage(db, runId, 'media', message);
      await hooks.onProgress?.(`⚠️ Image generation failed — see run details for next steps`);
    }
    const imageUrl = mediaResult.url;

    // Persist every generated image. For non-carousel runs there's just
    // one URL → one asset row (with the original `assetId` so existing
    // foreign-key references still resolve). For carousel runs each slide
    // gets its own row, indexed by `carousel_index` so the dashboard can
    // render them in order.
    const modelName =
      mediaResult.provider === 'fal'
        ? 'nano-banana-2'
        : mediaResult.provider === 'openai'
          ? (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2')
          : '';

    if (mediaResult.urls.length === 0) {
      // Persist a single failed-asset row so the draft has *something*
      // attached and the dashboard can show the error state.
      db.insert(socialMediaAsset)
        .values({
          id: assetId,
          draft_id: draftId,
          type: 'image',
          status: 'failed',
          prompt: `Social image for: ${topic}`,
          provider: mediaResult.provider,
          model: modelName,
          source_url: null,
          hosted_url: null,
          media_mode: 'image',
          aspect_ratio: mediaAspect,
          carousel_index: isCarousel ? 0 : null,
          metadata: JSON.stringify({ attempts: mediaResult.attempts }),
        })
        .run();
    } else {
      mediaResult.urls.forEach((url, idx) => {
        db.insert(socialMediaAsset)
          .values({
            // First slide reuses the canonical assetId so existing
            // BotPipelineResult.assetId stays meaningful for downstream
            // callers (telegram bot, postiz adapter).
            id: idx === 0 ? assetId : uuidv4(),
            draft_id: draftId,
            type: 'image',
            status: 'hosted',
            // Persist the *actual* prompt sent to the provider so the
            // dashboard's Media tab can show it and let the operator edit
            // it before regenerating. Falls back to a label if for some
            // reason the provider didn't return a per-image prompt.
            prompt:
              mediaResult.prompts[idx] ??
              `Social image for: ${topic}${isCarousel ? ` — slide ${idx + 1}` : ''}`,
            provider: mediaResult.provider,
            model: modelName,
            source_url: url,
            hosted_url: url,
            media_mode: 'image',
            aspect_ratio: mediaAspect,
            carousel_index: isCarousel ? idx : null,
            metadata: JSON.stringify({ attempts: mediaResult.attempts }),
          })
          .run();
      });
    }

    if (imageUrl) {
      completeStage(db, runId, 'media', {
        url: imageUrl,
        urls: mediaResult.urls,
        slide_count: mediaResult.urls.length,
        format: formatForMedia ?? null,
        provider: mediaResult.provider,
        attempts: mediaResult.attempts,
      });
    }
    // failStage was already called inside the catch block above when the
    // orchestrator threw — don't double-record.

    db.update(socialDraft)
      .set({ status: 'ready', updated_at: now() })
      .where(eq(socialDraft.id, draftId))
      .run();

    // ── approve stage: leave pending; operator decides next ─────────────────
    // Run status moves to 'pending_approval' so the dashboard's Approval tab
    // gates open. The schema's enum doesn't include this value, but SQLite
    // stores any string — `as never` bypasses Drizzle's narrow type.
    db.update(socialRun)
      .set({
        status: 'pending_approval' as never,
        updated_at: now(),
      })
      .where(eq(socialRun.id, runId))
      .run();

    return {
      runId,
      draftId,
      assetId,
      topic,
      platform,
      content: finalContent,
      imageUrl,
      scores: {
        seo_score: numeric(seoGeo.seo_score),
        geo_score: numeric(seoGeo.geo_score),
        combined_score: seoGeo.combined_score,
        ai_citation_readiness: seoGeo.ai_citation_readiness,
      },
      compliance,
    };
  } catch (err) {
    // Preserve the full message — AllProvidersFailed is multi-line and
    // includes per-provider attempts + workarounds. The dashboard's
    // run-detail page renders this verbatim so the operator sees exactly
    // what happened and what to do next, no log-diving required.
    const message =
      err instanceof AllProvidersFailed
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    db.update(socialRun)
      .set({
        status: 'failed',
        error_message: message,
        updated_at: now(),
      })
      .where(eq(socialRun.id, runId))
      .run();
    throw err;
  }
}

function numeric(score: unknown): number | undefined {
  if (typeof score === 'number') return score;
  if (score && typeof score === 'object' && 'after' in score) {
    const after = (score as { after: unknown }).after;
    return typeof after === 'number' ? after : undefined;
  }
  return undefined;
}

function extractFacts(notes: string): string[] {
  return notes
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(\d+\.|[-*•])/.test(l))
    .map((l) => l.replace(/^(\d+\.|[-*•])\s*/, ''))
    .filter((l) => l.length > 10 && l.length < 300)
    .slice(0, 5);
}
