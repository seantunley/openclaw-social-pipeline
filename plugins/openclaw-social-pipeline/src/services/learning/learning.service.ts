/**
 * Content Learning Service
 *
 * Extracts learnings from draft edits, rejections, and analytics.
 * Applies learnings to future content generation prompts.
 */

import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { socialLearning } from '../../db/schema.js';
import { llmGenerate } from '../pipeline/llm.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

type LearningCategory =
  | 'tone' | 'structure' | 'hook' | 'cta' | 'vocabulary'
  | 'platform' | 'topic' | 'media' | 'timing' | 'audience'
  | 'avoidance' | 'psychology';

interface ExtractedLearning {
  category: LearningCategory;
  content: string;
  tags: string[];
}

export class LearningService {
  constructor(private db: BetterSQLite3Database<any>) {}

  /**
   * Extract learnings from a draft edit (original vs edited).
   */
  async extractFromEdit(params: {
    originalDraft: string;
    editedDraft: string;
    platform: string;
    runId?: string;
    campaignId?: string;
  }): Promise<{ learnings: ExtractedLearning[]; saved: number }> {
    const response = await llmGenerate(
      `You analyze content edits to extract reusable writing patterns.

Given an ORIGINAL AI-generated draft and a HUMAN-EDITED version, identify every meaningful change and categorize it.

Categories: tone, structure, hook, cta, vocabulary, platform, topic, media, timing, audience, avoidance, psychology

For each change, write a concise directive learning statement — "Do X" or "Avoid Y" — not a description of what changed.

Return JSON array:
[
  {"category": "tone", "content": "Use conversational first-person on LinkedIn", "tags": ["voice", "formality"]},
  {"category": "vocabulary", "content": "Replace 'utilize' with 'use', 'leverage' with 'build on'", "tags": ["word-choice"]}
]

Only include meaningful changes. Ignore whitespace, punctuation-only edits, and trivial rephrasing.
Return an empty array [] if no meaningful patterns are found.`,

      `PLATFORM: ${params.platform}

ORIGINAL DRAFT:
${params.originalDraft}

HUMAN-EDITED VERSION:
${params.editedDraft}

Extract reusable content learnings from the edits.`,
      { temperature: 0.3 },
    );

    let learnings: ExtractedLearning[] = [];
    try {
      const parsed = JSON.parse(response);
      learnings = Array.isArray(parsed) ? parsed : [];
    } catch {
      learnings = [];
    }

    let saved = 0;
    for (const learning of learnings) {
      await this.saveOrReinforce({
        ...learning,
        platform: params.platform,
        sourceType: 'draft_edit',
        sourceRunId: params.runId,
        campaignId: params.campaignId,
      });
      saved++;
    }

    return { learnings, saved };
  }

  /**
   * Extract learnings from a rejection or revision request.
   */
  async extractFromFeedback(params: {
    notes: string;
    action: 'rejection' | 'revision_request';
    draftContent?: string;
    platform: string;
    runId?: string;
    campaignId?: string;
  }): Promise<{ learnings: ExtractedLearning[]; saved: number }> {
    const response = await llmGenerate(
      `You extract reusable content rules from reviewer feedback.

Given reviewer NOTES (why content was rejected or needs revision), extract actionable learnings.

Categories: tone, structure, hook, cta, vocabulary, platform, topic, media, timing, audience, avoidance, psychology

Write each learning as a directive: "Do X" or "Avoid Y".

Return JSON array:
[
  {"category": "avoidance", "content": "Never use clickbait headlines on LinkedIn", "tags": ["headlines"]},
  {"category": "tone", "content": "Match brand voice — professional but approachable, not corporate", "tags": ["brand-voice"]}
]

Return an empty array [] if the feedback is too vague to extract patterns.`,

      `PLATFORM: ${params.platform}
ACTION: ${params.action}

REVIEWER NOTES:
${params.notes}

${params.draftContent ? `DRAFT THAT WAS ${params.action === 'rejection' ? 'REJECTED' : 'SENT BACK'}:\n${params.draftContent.slice(0, 1000)}` : ''}

Extract reusable content learnings.`,
      { temperature: 0.3 },
    );

    let learnings: ExtractedLearning[] = [];
    try {
      const parsed = JSON.parse(response);
      learnings = Array.isArray(parsed) ? parsed : [];
    } catch {
      learnings = [];
    }

    let saved = 0;
    for (const learning of learnings) {
      await this.saveOrReinforce({
        ...learning,
        platform: params.platform,
        sourceType: params.action === 'rejection' ? 'rejection' : 'revision_request',
        sourceRunId: params.runId,
        campaignId: params.campaignId,
      });
      saved++;
    }

    return { learnings, saved };
  }

  /**
   * Extract learnings from analytics — compare top vs bottom performers.
   */
  async extractFromAnalytics(params: {
    topPosts: { platform: string; content: string; engagement_rate: number; hook?: string; cta?: string }[];
    bottomPosts: { platform: string; content: string; engagement_rate: number; hook?: string; cta?: string }[];
  }): Promise<{ learnings: ExtractedLearning[]; saved: number }> {
    if (params.topPosts.length === 0) return { learnings: [], saved: 0 };

    const response = await llmGenerate(
      `You analyze social media post performance to extract content patterns.

Given TOP-PERFORMING posts and BOTTOM-PERFORMING posts, identify what differentiates them.

Categories: tone, structure, hook, cta, vocabulary, platform, topic, media, timing, audience, psychology

Write each learning as a directive based on what the top performers do differently.

Return JSON array:
[
  {"category": "hook", "content": "Open with a specific statistic or surprising fact — top posts averaged 3.2x more engagement with data-led hooks", "tags": ["data", "opening"]},
  {"category": "cta", "content": "End with an open question rather than a directive — 'What's your take?' outperforms 'Follow for more'", "tags": ["engagement"]}
]`,

      `TOP PERFORMERS (high engagement):
${params.topPosts.map((p, i) => `${i + 1}. [${p.platform}] (${p.engagement_rate}% engagement)\n${p.content.slice(0, 300)}`).join('\n\n')}

BOTTOM PERFORMERS (low engagement):
${params.bottomPosts.map((p, i) => `${i + 1}. [${p.platform}] (${p.engagement_rate}% engagement)\n${p.content.slice(0, 300)}`).join('\n\n')}

Extract content patterns that differentiate top from bottom performers.`,
      { temperature: 0.3 },
    );

    let learnings: ExtractedLearning[] = [];
    try {
      const parsed = JSON.parse(response);
      learnings = Array.isArray(parsed) ? parsed : [];
    } catch {
      learnings = [];
    }

    let saved = 0;
    for (const learning of learnings) {
      await this.saveOrReinforce({
        ...learning,
        platform: null,
        sourceType: 'analytics',
        initialConfidence: 0.7,
      });
      saved++;
    }

    return { learnings, saved };
  }

  /**
   * Save a new learning or reinforce an existing similar one.
   */
  private async saveOrReinforce(params: {
    category: string;
    content: string;
    tags: string[];
    platform: string | null;
    sourceType: string;
    sourceRunId?: string;
    campaignId?: string;
    initialConfidence?: number;
  }): Promise<string> {
    const now = new Date().toISOString();

    // Check for similar existing learnings in same category + platform
    const conditions = [
      eq(socialLearning.category, params.category as any),
      eq(socialLearning.active, true),
    ];
    if (params.platform) {
      conditions.push(eq(socialLearning.platform, params.platform));
    }

    const existing = await this.db
      .select()
      .from(socialLearning)
      .where(and(...conditions));

    // Simple similarity: check if any existing learning covers the same concept
    // (In production, use embedding similarity — for now, check keyword overlap)
    for (const e of existing) {
      const overlap = this.keywordOverlap(e.content, params.content);
      if (overlap > 0.4) {
        // Reinforce existing learning
        const newConfidence = Math.min(1.0, e.confidence + 0.15);
        await this.db
          .update(socialLearning)
          .set({
            confidence: newConfidence,
            reinforcement_count: e.reinforcement_count + 1,
            last_reinforced_at: now,
            updated_at: now,
          })
          .where(eq(socialLearning.id, e.id));
        return e.id;
      }
    }

    // Create new learning
    const id = uuidv4();
    await this.db.insert(socialLearning).values({
      id,
      category: params.category as any,
      platform: params.platform,
      campaign_id: params.campaignId ?? null,
      content: params.content,
      source_type: params.sourceType as any,
      source_run_id: params.sourceRunId ?? null,
      confidence: params.initialConfidence ?? 0.3,
      reinforcement_count: 1,
      last_reinforced_at: now,
      tags: JSON.stringify(params.tags),
      active: true,
      created_at: now,
      updated_at: now,
    });

    return id;
  }

  /**
   * Get applicable learnings for a content generation prompt.
   */
  async getApplicableLearnings(params: {
    platform: string;
    campaignId?: string;
    minConfidence?: number;
    categories?: string[];
  }): Promise<{
    learnings: any[];
    promptInjection: string;
  }> {
    const minConf = params.minConfidence ?? 0.3;

    // Get learnings matching platform (or universal) above confidence threshold
    const rows = await this.db
      .select()
      .from(socialLearning)
      .where(
        and(
          eq(socialLearning.active, true),
          gte(socialLearning.confidence, minConf),
        ),
      )
      .orderBy(desc(socialLearning.confidence));

    // Filter: platform match (same platform or universal)
    const applicable = rows.filter((r) => {
      if (r.platform && r.platform !== params.platform) return false;
      if (params.categories && !params.categories.includes(r.category)) return false;
      if (params.campaignId && r.campaign_id && r.campaign_id !== params.campaignId) return false;
      return true;
    });

    // Build prompt injection
    const lines = applicable.map(
      (r) => `[${r.category.toUpperCase()}${r.platform ? `:${r.platform}` : ''}] (confidence: ${r.confidence.toFixed(1)}) ${r.content}`,
    );

    const promptInjection =
      lines.length > 0
        ? `CONTENT LEARNINGS (apply these patterns):\n\n${lines.join('\n\n')}`
        : '';

    return {
      learnings: applicable.map((r) => ({
        id: r.id,
        category: r.category,
        platform: r.platform,
        content: r.content,
        confidence: r.confidence,
        reinforcement_count: r.reinforcement_count,
        tags: JSON.parse(r.tags),
      })),
      promptInjection,
    };
  }

  /**
   * List all learnings with optional filters.
   */
  async list(params?: {
    category?: string;
    platform?: string;
    active?: boolean;
    limit?: number;
  }) {
    const conditions = [];
    if (params?.category) conditions.push(eq(socialLearning.category, params.category as any));
    if (params?.platform) conditions.push(eq(socialLearning.platform, params.platform));
    if (params?.active !== undefined) conditions.push(eq(socialLearning.active, params.active));

    const query = this.db
      .select()
      .from(socialLearning)
      .orderBy(desc(socialLearning.confidence))
      .limit(params?.limit ?? 50);

    const rows = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

    return rows.map((r) => ({
      ...r,
      tags: JSON.parse(r.tags),
    }));
  }

  /**
   * Add an explicit operator rule (confidence 1.0).
   */
  async addRule(params: {
    category: string;
    content: string;
    platform?: string;
    tags?: string[];
  }): Promise<string> {
    return this.saveOrReinforce({
      category: params.category,
      content: params.content,
      tags: params.tags ?? [],
      platform: params.platform ?? null,
      sourceType: 'operator_rule',
      initialConfidence: 1.0,
    });
  }

  /**
   * Deactivate a learning.
   */
  async deactivate(learningId: string): Promise<void> {
    await this.db
      .update(socialLearning)
      .set({ active: false, updated_at: new Date().toISOString() })
      .where(eq(socialLearning.id, learningId));
  }

  /**
   * Apply confidence decay to old learnings (call monthly).
   */
  async applyDecay(): Promise<number> {
    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Decay learnings not reinforced in the last month
    const stale = await this.db
      .select()
      .from(socialLearning)
      .where(
        and(
          eq(socialLearning.active, true),
          gte(socialLearning.confidence, 0.2),
        ),
      );

    let decayed = 0;
    for (const learning of stale) {
      if (learning.last_reinforced_at < oneMonthAgo && learning.source_type !== 'operator_rule') {
        const newConfidence = Math.max(0, learning.confidence - 0.05);
        const updates: any = { confidence: newConfidence, updated_at: now };
        if (newConfidence < 0.2) updates.active = false;
        await this.db
          .update(socialLearning)
          .set(updates)
          .where(eq(socialLearning.id, learning.id));
        decayed++;
      }
    }

    return decayed;
  }

  // Simple keyword overlap for similarity detection
  private keywordOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }
    return overlap / Math.min(wordsA.size, wordsB.size);
  }
}
