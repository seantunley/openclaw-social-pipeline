/**
 * Social SEO & GEO tools — optimize posts for AI search citation and E-E-A-T.
 */

import type { PluginContext, ToolResult } from './types.js';
import { llmGenerate } from '../services/pipeline/llm.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let _skillPrompt: string | null = null;

function loadSkillPrompt(): string {
  if (_skillPrompt) return _skillPrompt;
  try {
    // CJS output: use __dirname instead of import.meta.url for Node16 compatibility
    const skillPath = resolve(
      __dirname,
      '../../skills/social-seo-geo/SKILL.md',
    );
    _skillPrompt = readFileSync(skillPath, 'utf-8');
  } catch {
    // Fallback to inline essentials
    _skillPrompt = `Optimize social media content for AI search citation (GEO) and E-E-A-T authority signals.
Score on: Citability (specific quotable facts), Authority (E-E-A-T signals), Structure (scannable, clear),
Entity Clarity (named entities, clear topic), Amplification (cross-platform citation potential).
Return JSON with enhanced_content, geo_score, eeat_signals, changes_made, ai_citation_readiness.`;
  }
  return _skillPrompt;
}

/**
 * Score a social media post for GEO (AI search citation readiness) and E-E-A-T.
 * Returns scores + specific recommendations without modifying the content.
 */
export async function social_seo_geo_score(
  params: { content: string; platform: string },
  _context: PluginContext,
): Promise<ToolResult> {
  if (!params.content) {
    return { success: false, data: null, error: 'content is required' };
  }

  try {
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

      `PLATFORM: ${params.platform}\n\nCONTENT TO SCORE:\n${params.content}`,
      { temperature: 0.2 },
    );

    try {
      const parsed = JSON.parse(response);
      return { success: true, data: parsed };
    } catch {
      return { success: true, data: { raw_analysis: response } };
    }
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Enhance a social media post for GEO and E-E-A-T.
 * Rewrites/improves the content while preserving tone and message.
 */
export async function social_seo_geo_enhance(
  params: { content: string; platform: string; context?: string },
  _context: PluginContext,
): Promise<ToolResult> {
  if (!params.content) {
    return { success: false, data: null, error: 'content is required' };
  }

  try {
    const skillPrompt = loadSkillPrompt();

    const response = await llmGenerate(
      `${skillPrompt}\n\nYou are ENHANCING this content for both SEO (platform search discoverability) and GEO (AI search citation).
Follow the platform-specific SEO playbook AND GEO guidance. Preserve the core message and tone.
Return JSON with: enhanced_content, seo_score (before and after), geo_score (before and after), combined_score,
seo_details (primary_keyword, secondary_keywords, recommended_hashtags, alt_text_suggestion, search_intent_matched),
eeat_signals, changes_made, platform_optimizations, ai_citation_readiness.`,

      `PLATFORM: ${params.platform}
${params.context ? `ADDITIONAL CONTEXT: ${params.context}` : ''}

CONTENT TO ENHANCE:
${params.content}`,
      { temperature: 0.3 },
    );

    try {
      const parsed = JSON.parse(response);
      return { success: true, data: parsed };
    } catch {
      return { success: true, data: { raw_response: response } };
    }
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Generate GEO-optimized content from scratch given a topic and platform.
 * Uses all the GEO + E-E-A-T best practices from the start.
 */
export async function social_seo_geo_generate(
  params: {
    topic: string;
    platform: string;
    key_facts?: string[];
    experience_statement?: string;
    target_audience?: string;
  },
  _context: PluginContext,
): Promise<ToolResult> {
  if (!params.topic) {
    return { success: false, data: null, error: 'topic is required' };
  }

  try {
    const skillPrompt = loadSkillPrompt();

    const factsBlock = params.key_facts?.length
      ? `\nKEY FACTS TO INCLUDE:\n${params.key_facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
      : '';

    const response = await llmGenerate(
      `${skillPrompt}\n\nYou are GENERATING a new social media post from scratch, optimized for both SEO (platform search) and GEO (AI search citation) from the start.
Follow the platform-specific SEO playbook AND GEO guidance. Aim for high keyword relevance AND high citability.
Return JSON with: content, seo_score, geo_score, combined_score,
seo_details (primary_keyword, secondary_keywords, recommended_hashtags, alt_text_suggestion, search_intent_matched),
eeat_signals, platform_optimizations, ai_citation_readiness.`,

      `PLATFORM: ${params.platform}
TOPIC: ${params.topic}
${params.target_audience ? `TARGET AUDIENCE: ${params.target_audience}` : ''}
${params.experience_statement ? `AUTHOR EXPERIENCE: ${params.experience_statement}` : ''}
${factsBlock}

Generate a ${params.platform} post about this topic, fully optimized for GEO and E-E-A-T.`,
      { temperature: 0.4 },
    );

    try {
      const parsed = JSON.parse(response);
      return { success: true, data: parsed };
    } catch {
      return { success: true, data: { raw_response: response } };
    }
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}
