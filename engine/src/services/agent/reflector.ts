/**
 * Reflector — after a conversation ends, the agent self-reviews and extracts
 * behavioural LESSONS (imperative rules) for next time. Stored in agent_lesson.
 *
 * Distinct from the extractor: extractor pulls statements ABOUT THE WORLD,
 * reflector pulls statements about how the AGENT SHOULD ACT. Both are
 * memory-building; one writes facts, the other writes lessons.
 *
 * Strict fabrication rule: lessons must be grounded in something visible
 * in the transcript (an operator correction, a confirmed approach, a
 * repeated complaint). No speculative best-practice generation.
 */

import { llmGenerate } from "../pipeline/llm.js";
import * as messagesRepo from "./messages.js";
import * as lessonsRepo from "./lessons.js";
import type { Message } from "./messages.js";

const REFLECTOR_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are reflecting on one finished agent conversation to learn behavioural rules.

A LESSON is an imperative rule for the agent that is grounded in something visible in this transcript:
  - The operator corrected your approach ("no, do X instead").
  - The operator confirmed an approach as right ("yes that's exactly what I wanted").
  - The operator stated a recurring preference ("I always want X first").

Rules:
  - Output STRICT JSON: { "lessons": [ { "content": "...", "confidence": 0.0-1.0, "tags": ["..."] } ] }
  - Each "content" must be ONE imperative sentence ("When the operator asks for X, do Y first.").
  - DO NOT invent lessons. If nothing in the transcript justifies one, output an empty array.
  - DO NOT include style preferences that already live in the explicit preferences block.
  - Confidence 0.8+ only for explicit corrections/confirmations. Inferred behaviour stays at 0.5-0.7.
  - Tags are short topical labels: ["composer","approval","tone"]. Lowercase, kebab-case if needed.`;

export interface ReflectionSummary {
  lessonsAdded: number;
  lessonsReinforced: number;
  modelUsed: string;
}

export async function reflectAndLearn(
  conversationId: string,
  maxMessages = 200,
): Promise<ReflectionSummary> {
  const msgs = messagesRepo.listForConversation(conversationId, maxMessages);
  if (msgs.length < 4) {
    return { lessonsAdded: 0, lessonsReinforced: 0, modelUsed: "skip" };
  }

  const transcript = renderTranscript(msgs);
  const raw = await llmGenerate(SYSTEM_PROMPT, transcript, {
    model: REFLECTOR_MODEL,
    temperature: 0.2,
    maxTokens: 1024,
    caller: "agent.reflector",
  });
  const parsed = parseLessons(raw);

  let added = 0;
  let reinforced = 0;
  for (const l of parsed) {
    if (!l.content || l.content.length < 8) continue;
    const before = lessonsRepo.listActive(500, 0).length;
    lessonsRepo.addLesson({
      content: l.content,
      sourceConversationId: conversationId,
      confidence: clampConfidence(l.confidence),
      tags: Array.isArray(l.tags) ? l.tags.filter((t) => typeof t === "string") : [],
    });
    const after = lessonsRepo.listActive(500, 0).length;
    if (after > before) added += 1;
    else reinforced += 1;
  }
  return { lessonsAdded: added, lessonsReinforced: reinforced, modelUsed: REFLECTOR_MODEL };
}

function parseLessons(raw: string): Array<{ content: string; confidence: number; tags?: string[] }> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const obj = JSON.parse(match[0]) as {
      lessons?: Array<{ content: string; confidence: number; tags?: string[] }>;
    };
    return Array.isArray(obj.lessons) ? obj.lessons : [];
  } catch {
    return [];
  }
}

function renderTranscript(msgs: Message[]): string {
  return msgs
    .map((m) => {
      const tag =
        m.role === "tool"
          ? `[tool:${m.tool_name ?? "?"}]`
          : `[${m.role}]`;
      return `${tag} ${m.content.slice(0, 4000)}`;
    })
    .join("\n\n");
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
