/**
 * Social SEO & GEO tools — optimize posts for AI search citation and E-E-A-T.
 */

import type { PluginContext, ToolResult } from './types.js';
import { llmGenerate } from '../services/pipeline/llm.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

let _skillPrompt: string | null = null;

function loadSkillPrompt(): string {
  if (_skillPrompt) return _skillPrompt;
  try {
    // Try to load the vendored skill
    const skillPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
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
      `${skillPrompt}\n\nYou are SCORING this content. Do NOT rewrite it. Only analyze and score.
Return JSON with: geo_score (overall 0-100, plus sub-scores 0-10 for citability, authority, structure, entity_clarity, amplification),
eeat_signals (what's present for each of experience, expertise, authoritativeness, trustworthiness),
recommendations (specific improvements), ai_citation_readiness (low/medium/high).`,

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
      `${skillPrompt}\n\nYou are ENHANCING this content for AI search citation and authority.
Follow the platform-specific guidance. Preserve the core message and tone.
Return JSON with: enhanced_content, geo_score (before and after), eeat_signals, changes_made, platform_optimizations, ai_citation_readiness.`,

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
      `${skillPrompt}\n\nYou are GENERATING a new social media post from scratch, optimized for AI search citation and E-E-A-T from the start.
Follow all platform-specific guidance. Aim for high citability with specific facts.
Return JSON with: content, geo_score, eeat_signals, platform_optimizations, ai_citation_readiness.`,

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
