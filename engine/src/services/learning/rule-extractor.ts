/**
 * Diff an operator edit against the model's output and use Claude to extract
 * structured, imperative rules that future runs will follow verbatim.
 *
 * The point: when the operator changes "Furthermore, our team..." to "Our team...",
 * the rule is "avoid the word 'Furthermore' as a sentence opener". Saving a generic
 * "operator edit happened" string accomplishes nothing for future runs.
 */

import { llmGenerate } from '../pipeline/llm.js';

export type LearningCategory =
  | 'tone'
  | 'structure'
  | 'hook'
  | 'cta'
  | 'vocabulary'
  | 'platform'
  | 'topic'
  | 'media'
  | 'timing'
  | 'audience'
  | 'avoidance'
  | 'psychology';

export interface ExtractedRule {
  category: LearningCategory;
  content: string;
  tags?: string[];
}

export interface ExtractRulesInput {
  platform: string;
  original: string;
  edited: string;
  operatorNote?: string;
}

const VALID_CATEGORIES: LearningCategory[] = [
  'tone', 'structure', 'hook', 'cta', 'vocabulary',
  'platform', 'topic', 'media', 'timing', 'audience',
  'avoidance', 'psychology',
];

function normaliseCategory(raw: string): LearningCategory {
  const lower = raw.toLowerCase().trim();
  return (VALID_CATEGORIES as readonly string[]).includes(lower)
    ? (lower as LearningCategory)
    : 'tone';
}

/**
 * Extract 1-5 imperative rules from the diff between an LLM-generated draft
 * and the operator's edited version. Rules are written so that, applied to a
 * future generation prompt, they would steer the model toward the edited
 * style without reproducing this specific post.
 */
export async function extractRulesFromEdit(
  input: ExtractRulesInput,
): Promise<ExtractedRule[]> {
  const { platform, original, edited, operatorNote } = input;

  const trimmedNote = operatorNote?.trim() ?? '';
  const textUnchanged = original.trim() === edited.trim();

  // No text change AND no note → there really is nothing to learn from.
  if (textUnchanged && !trimmedNote) return [];

  // Note-only edit (operator added guidance without changing the text).
  // Convert the note into one or more structured rules without diff context.
  if (textUnchanged && trimmedNote) {
    return ruleFromNoteOnly(trimmedNote, platform);
  }

  const system = `You are a content style analyst. The operator has edited an AI-generated social media draft. Your job is to extract the implicit RULES the operator is teaching — generalisable instructions that, applied to a future draft on a different topic, would produce the edited style without copying this specific post.

Constraints on the rules you extract:
- Imperative voice ("Avoid X", "Always include Y", "Open with a single short sentence under 12 words", etc.)
- Generalisable across topics — never reference the specific subject matter of this draft.
- Categorise each rule as one of: tone, structure, hook, cta, vocabulary, platform, topic, media, timing, audience, avoidance, psychology.
- 1 to 5 rules max — quality over quantity. If the edit is small, return one rule.
- If the operator note is supplied, weight it heavily — it's their intent.
- Don't restate platform-default best practices the model already knows. Only surface what changed.

Return JSON ONLY, no markdown fences:
{
  "rules": [
    { "category": "tone|structure|...", "content": "imperative rule text", "tags": ["short", "tag", "list"] }
  ]
}`;

  const userPrompt = `PLATFORM: ${platform}

ORIGINAL DRAFT (model output):
${original}

EDITED DRAFT (operator's version):
${edited}
${operatorNote ? `\nOPERATOR NOTE:\n${operatorNote}` : ''}

Extract rules that would have produced the edited style on a different topic.`;

  const raw = await llmGenerate(system, userPrompt, {
    temperature: 0.2,
    maxTokens: 1024,
  });

  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as { rules?: unknown };
    if (!Array.isArray(parsed.rules)) return [];

    const extracted = parsed.rules
      .map((r): ExtractedRule | null => {
        if (!r || typeof r !== 'object') return null;
        const obj = r as Record<string, unknown>;
        const content = typeof obj.content === 'string' ? obj.content.trim() : '';
        if (!content) return null;
        return {
          category: normaliseCategory(typeof obj.category === 'string' ? obj.category : 'tone'),
          content,
          tags: Array.isArray(obj.tags)
            ? obj.tags.filter((t): t is string => typeof t === 'string')
            : undefined,
        };
      })
      .filter((r): r is ExtractedRule => r !== null)
      .slice(0, 5);

    // If the LLM returned no usable rules but the operator gave a note,
    // fall back to the note so the edit isn't lost.
    if (extracted.length === 0 && trimmedNote) {
      return ruleFromNoteOnly(trimmedNote, platform);
    }
    return extracted;
  } catch {
    // If JSON parsing fails, at least preserve the operator note as a rule
    // rather than dropping the signal entirely.
    if (trimmedNote) return ruleFromNoteOnly(trimmedNote, platform);
    return [];
  }
}

/**
 * Note-only path: the operator gave guidance but didn't change the text.
 * Try one LLM call to split the note into structured rules; if that fails,
 * save the raw note as a single tone rule.
 */
async function ruleFromNoteOnly(
  note: string,
  platform: string,
): Promise<ExtractedRule[]> {
  const system = `You are a content style analyst. The operator has provided a note that should become one or more structured RULES for a social media content pipeline. Convert the note into imperative, generalisable rules.

Categorise each rule as one of: tone, structure, hook, cta, vocabulary, platform, topic, media, timing, audience, avoidance, psychology.

Return JSON ONLY, no markdown fences:
{ "rules": [ { "category": "...", "content": "imperative rule text", "tags": ["..."] } ] }`;

  const userPrompt = `PLATFORM: ${platform}\n\nOPERATOR NOTE:\n${note}\n\nReturn structured rules.`;

  try {
    const raw = await llmGenerate(system, userPrompt, {
      temperature: 0.2,
      maxTokens: 1024,
    });
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned) as { rules?: unknown };

    if (Array.isArray(parsed.rules)) {
      const out = parsed.rules
        .map((r): ExtractedRule | null => {
          if (!r || typeof r !== 'object') return null;
          const obj = r as Record<string, unknown>;
          const content = typeof obj.content === 'string' ? obj.content.trim() : '';
          if (!content) return null;
          return {
            category: normaliseCategory(typeof obj.category === 'string' ? obj.category : 'tone'),
            content,
            tags: Array.isArray(obj.tags)
              ? obj.tags.filter((t): t is string => typeof t === 'string')
              : ['operator_note'],
          };
        })
        .filter((r): r is ExtractedRule => r !== null)
        .slice(0, 5);
      if (out.length > 0) return out;
    }
  } catch {
    // fall through to raw-note fallback
  }

  // Couldn't parse — save the note verbatim so the operator's intent isn't lost.
  return [{
    category: 'tone',
    content: note,
    tags: ['operator_note', 'unparsed'],
  }];
}

/**
 * Format the active learnings into a section that can be appended to system
 * prompts. Returns an empty string when there are no rules so the prompt is
 * unchanged for runs with no operator history.
 */
export function formatRulesForPrompt(
  rules: Array<{ category: string; content: string }>,
): string {
  if (rules.length === 0) return '';

  // Group by category for readability.
  const byCategory = new Map<string, string[]>();
  for (const r of rules) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r.content);
    byCategory.set(r.category, list);
  }

  const sections: string[] = [];
  for (const [cat, lines] of byCategory) {
    sections.push(`[${cat}]`);
    for (const l of lines) sections.push(`- ${l}`);
  }

  return `\n\nACTIVE RULES (from prior operator feedback — apply ALL):\n${sections.join('\n')}`;
}
