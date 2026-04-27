/**
 * SEO + GEO service — score, enhance, and generate social posts optimized
 * for both platform search (SEO) and AI search citation (GEO / E-E-A-T).
 *
 * Extracted from the deprecated `tools/seo-geo.tools.ts` so the logic remains
 * available after the OpenClaw tool wrappers are removed. Pure functions —
 * no plugin/tool context required.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { llmGenerate } from '../pipeline/llm.js';

const INLINE_FALLBACK = `Optimize social media content for AI search citation (GEO) and E-E-A-T authority signals.
Score on: Citability (specific quotable facts), Authority (E-E-A-T signals), Structure (scannable, clear),
Entity Clarity (named entities, clear topic), Amplification (cross-platform citation potential).
Return JSON with enhanced_content, geo_score, eeat_signals, changes_made, ai_citation_readiness.`;

let _skillPrompt: string | null = null;

/**
 * Load the SKILL.md prompt from disk (skills/social-seo-geo/SKILL.md).
 * Tries both the dev-mode and compiled-mode relative paths so the same code
 * works whether the service is run via tsx on source or via node on dist.
 */
function loadSkillPrompt(): string {
  if (_skillPrompt) return _skillPrompt;

  // Try multiple candidate locations because __dirname differs between
  // source (engine/src/services/seo-geo/) and compiled (engine/dist/...).
  const candidates = [
    resolve(__dirname, '../../../skills/social-seo-geo/SKILL.md'),    // src
    resolve(__dirname, '../../../../skills/social-seo-geo/SKILL.md'), // dist (one extra level)
    resolve(process.cwd(), 'skills/social-seo-geo/SKILL.md'),         // cwd fallback
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      _skillPrompt = readFileSync(path, 'utf-8');
      return _skillPrompt;
    }
  }

  _skillPrompt = INLINE_FALLBACK;
  return _skillPrompt;
}

export interface SeoGeoScoreResult {
  seo_score?: number;
  geo_score?: number;
  combined_score?: number;
  eeat_signals?: Record<string, unknown>;
  seo_details?: Record<string, unknown>;
  recommendations?: unknown;
  ai_citation_readiness?: 'low' | 'medium' | 'high' | string;
  raw_analysis?: string;
}

export interface SeoGeoEnhanceResult {
  enhanced_content?: string;
  seo_score?: number | { before: number; after: number };
  geo_score?: number | { before: number; after: number };
  combined_score?: number;
  seo_details?: Record<string, unknown>;
  eeat_signals?: Record<string, unknown>;
  changes_made?: unknown;
  platform_optimizations?: unknown;
  ai_citation_readiness?: string;
  raw_response?: string;
}

export interface SeoGeoGenerateInput {
  topic: string;
  platform: string;
  key_facts?: string[];
  experience_statement?: string;
  target_audience?: string;
  /** Additional system-prompt instructions appended after the SKILL prompt.
   *  Used by the bot pipeline to inject active learnings as binding rules. */
  extraInstructions?: string;
}

export interface SeoGeoGenerateResult {
  content?: string;
  seo_score?: number;
  geo_score?: number;
  combined_score?: number;
  seo_details?: Record<string, unknown>;
  eeat_signals?: Record<string, unknown>;
  platform_optimizations?: unknown;
  ai_citation_readiness?: string;
  raw_response?: string;
}

/**
 * Score a social media post for SEO (platform discoverability) and GEO
 * (AI search citation readiness). Does NOT modify the content.
 */
export async function scoreSeoGeo(
  content: string,
  platform: string,
): Promise<SeoGeoScoreResult> {
  if (!content) throw new Error('content is required');

  const skillPrompt = loadSkillPrompt();
  const response = await llmGenerate(
    `${skillPrompt}\n\nYou are SCORING this content for both SEO (platform search discoverability) and GEO (AI search citation readiness). Do NOT rewrite it. Only analyze and score.
Return JSON with:
- seo_score (overall 0-100, plus sub-scores 0-10 for keyword_optimization, hashtag_strategy, discoverability, technical_elements, search_intent_alignment)
- geo_score (overall 0-100, plus sub-scores 0-10 for citability, authority, structure, entity_clarity, amplification)
- combined_score (weighted average: SEO 50% + GEO 50%)
- eeat_signals (what's present for each of experience, expertise, authoritativeness, trustworthiness)
- seo_details (primary_keyword identified, secondary_keywords found, recommended_hashtags for this platform, alt_text_suggestion, search_intent_matched)
- recommendations (specific improvements for both SEO and GEO)
- ai_citation_readiness (low/medium/high)`,
    `PLATFORM: ${platform}\n\nCONTENT TO SCORE:\n${content}`,
    { temperature: 0.2 },
  );

  const cleaned = stripJsonFences(response);
  try {
    return JSON.parse(cleaned) as SeoGeoScoreResult;
  } catch {
    return { raw_analysis: cleaned };
  }
}

/**
 * Enhance a social media post for both SEO and GEO. Rewrites/improves the
 * content while preserving tone and message.
 */
export async function enhanceSeoGeo(
  content: string,
  platform: string,
  context?: string,
): Promise<SeoGeoEnhanceResult> {
  if (!content) throw new Error('content is required');

  const skillPrompt = loadSkillPrompt();
  const response = await llmGenerate(
    `${skillPrompt}\n\nYou are ENHANCING this content for both SEO (platform search discoverability) and GEO (AI search citation).
Follow the platform-specific SEO playbook AND GEO guidance. Preserve the core message and tone.
Return JSON with: enhanced_content, seo_score (before and after), geo_score (before and after), combined_score,
seo_details (primary_keyword, secondary_keywords, recommended_hashtags, alt_text_suggestion, search_intent_matched),
eeat_signals, changes_made, platform_optimizations, ai_citation_readiness.`,
    `PLATFORM: ${platform}
${context ? `ADDITIONAL CONTEXT: ${context}` : ''}

CONTENT TO ENHANCE:
${content}`,
    { temperature: 0.3 },
  );

  const cleaned = stripJsonFences(response);
  try {
    return JSON.parse(cleaned) as SeoGeoEnhanceResult;
  } catch {
    return { raw_response: cleaned };
  }
}

/**
 * Generate a SEO + GEO-optimized post from scratch, given a topic and
 * platform. Bakes E-E-A-T and citability into the draft from the start
 * rather than bolting them on afterwards.
 */
export async function generateSeoGeo(
  input: SeoGeoGenerateInput,
): Promise<SeoGeoGenerateResult> {
  if (!input.topic) throw new Error('topic is required');

  const skillPrompt = loadSkillPrompt();
  const factsBlock = input.key_facts?.length
    ? `\nKEY FACTS TO INCLUDE:\n${input.key_facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
    : '';

  const response = await llmGenerate(
    `${skillPrompt}\n\nYou are GENERATING a new social media post from scratch, optimized for both SEO (platform search) and GEO (AI search citation) from the start.
Follow the platform-specific SEO playbook AND GEO guidance. Aim for high keyword relevance AND high citability.

ABSOLUTE RULE — DO NOT FABRICATE FACTS.
Only use specific numbers, percentages, dates, named people, named companies, named studies, or attributed quotes when they appear verbatim in the KEY FACTS provided below. If a fact isn't there, do not invent one — write the post without it. False precision is worse than vagueness. "Old uptime thinking is obsolete" beats "37% uptime thinking is obsolete" if 37% wasn't in the research.

Return JSON with: content, seo_score, geo_score, combined_score,
seo_details (primary_keyword, secondary_keywords, recommended_hashtags, alt_text_suggestion, search_intent_matched),
eeat_signals, platform_optimizations, ai_citation_readiness.${input.extraInstructions ?? ''}`,
    `PLATFORM: ${input.platform}
TOPIC: ${input.topic}
${input.target_audience ? `TARGET AUDIENCE: ${input.target_audience}` : ''}
${input.experience_statement ? `AUTHOR EXPERIENCE: ${input.experience_statement}` : ''}
${factsBlock}

Generate a ${input.platform} post about this topic, fully optimized for GEO and E-E-A-T.`,
    { temperature: 0.4 },
  );

  const cleaned = stripJsonFences(response);
  try {
    return JSON.parse(cleaned) as SeoGeoGenerateResult;
  } catch {
    return { raw_response: cleaned };
  }
}

/** Strip ```json fences and any leading prose Claude might add before the
 *  JSON object. Falls back to extracting from the first `{` to the last `}`
 *  so we recover a parseable body even when the model wraps it in commentary. */
function stripJsonFences(raw: string): string {
  let out = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // If there's still text around it, grab the outermost JSON object.
  const first = out.indexOf('{');
  const last = out.lastIndexOf('}');
  if (first > 0 && last > first) out = out.slice(first, last + 1);
  return out;
}
