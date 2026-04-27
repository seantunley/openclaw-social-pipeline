/**
 * Brand voice profile service. Loads + formats a campaign's brand profile
 * into a system-prompt block that every generation stage of the pipeline
 * appends after ACTIVE RULES.
 *
 * Resolution order: campaign-specific → workspace-default (campaign_id NULL).
 * If neither exists, returns null and the prompt skips the BRAND VOICE block.
 */

import { eq, isNull } from 'drizzle-orm';
import { socialBrandProfile } from '../../db/schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

type Db = BetterSQLite3Database<Record<string, unknown>>;

export interface BrandProfile {
  id: string;
  campaign_id: string | null;
  name: string;
  description: string;
  audience: string;
  tone: string;
  voice: string;
  writing_guidelines: string;
  banned_words: string[];
  required_phrases: string[];
  signature_phrases: string[];
  target_keywords: string[];
  target_hashtags: string[];
  audience_pain_points: string[];
  audience_aspirations: string[];
  archetype: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_url: string;
  mission: string;
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rowToProfile(row: typeof socialBrandProfile.$inferSelect): BrandProfile {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    name: row.name,
    description: row.description,
    audience: row.audience,
    tone: row.tone,
    voice: row.voice,
    writing_guidelines: row.writing_guidelines,
    banned_words: parseList(row.banned_words),
    required_phrases: parseList(row.required_phrases),
    signature_phrases: parseList(row.signature_phrases),
    target_keywords: parseList(row.target_keywords),
    target_hashtags: parseList(row.target_hashtags),
    audience_pain_points: parseList(row.audience_pain_points),
    audience_aspirations: parseList(row.audience_aspirations),
    archetype: row.archetype,
    primary_color: row.primary_color,
    secondary_color: row.secondary_color,
    accent_color: row.accent_color,
    logo_url: row.logo_url,
    mission: row.mission,
  };
}

/**
 * Load the active brand profile for a campaign. Returns null if neither a
 * campaign-specific nor workspace-default profile exists.
 */
export function loadBrandProfile(db: Db, campaignId: string): BrandProfile | null {
  const specific = db
    .select()
    .from(socialBrandProfile)
    .where(eq(socialBrandProfile.campaign_id, campaignId))
    .limit(1)
    .all();
  if (specific.length > 0) return rowToProfile(specific[0]);

  const fallback = db
    .select()
    .from(socialBrandProfile)
    .where(isNull(socialBrandProfile.campaign_id))
    .limit(1)
    .all();
  if (fallback.length > 0) return rowToProfile(fallback[0]);

  return null;
}

/**
 * Render the brand profile as a structured system-prompt block. Returns an
 * empty string when the profile is null so prompts stay unchanged for runs
 * without a brand profile.
 */
export function formatBrandProfileForPrompt(profile: BrandProfile | null): string {
  if (!profile) return '';

  const lines: string[] = [];

  if (profile.name) lines.push(`Brand: ${profile.name}`);
  if (profile.description) lines.push(`Description: ${profile.description}`);
  if (profile.mission) lines.push(`Mission: ${profile.mission}`);
  if (profile.archetype) lines.push(`Archetype: ${profile.archetype}`);
  if (profile.audience) lines.push(`Audience: ${profile.audience}`);
  if (profile.audience_pain_points.length)
    lines.push(`Audience pain points: ${profile.audience_pain_points.join('; ')}`);
  if (profile.audience_aspirations.length)
    lines.push(`Audience aspirations: ${profile.audience_aspirations.join('; ')}`);
  if (profile.tone) lines.push(`Tone: ${profile.tone}`);
  if (profile.voice) lines.push(`Voice: ${profile.voice}`);
  if (profile.writing_guidelines)
    lines.push(`Writing guidelines: ${profile.writing_guidelines}`);
  if (profile.banned_words.length)
    lines.push(`Banned words / phrases (NEVER use): ${profile.banned_words.join(', ')}`);
  if (profile.required_phrases.length)
    lines.push(`Required phrases (must include where natural): ${profile.required_phrases.join(' | ')}`);
  if (profile.signature_phrases.length)
    lines.push(`Signature phrases (weave in when fitting): ${profile.signature_phrases.join(' | ')}`);
  if (profile.target_keywords.length)
    lines.push(`Target keywords (SEO/GEO): ${profile.target_keywords.join(', ')}`);
  if (profile.target_hashtags.length)
    lines.push(`Default hashtags: ${profile.target_hashtags.join(' ')}`);

  if (lines.length === 0) return '';

  return `\n\nBRAND VOICE PROFILE (apply throughout — overrides any conflicting style guidance):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/** Used by the image generator to seed prompt visuals. */
export function brandPaletteFromProfile(
  profile: BrandProfile | null,
): { primary?: string; secondary?: string; accent?: string; logoUrl?: string } | null {
  if (!profile) return null;
  const out: { primary?: string; secondary?: string; accent?: string; logoUrl?: string } = {};
  if (profile.primary_color) out.primary = profile.primary_color;
  if (profile.secondary_color) out.secondary = profile.secondary_color;
  if (profile.accent_color) out.accent = profile.accent_color;
  if (profile.logo_url) out.logoUrl = profile.logo_url;
  return Object.keys(out).length > 0 ? out : null;
}
