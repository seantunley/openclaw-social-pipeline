/**
 * Fact extractor — pulls preferences, facts, goals, constraints out of
 * conversation messages and writes them to agent_fact / user_preference.
 *
 * Runs OFFLINE relative to the chat loop: after a message is appended, the
 * runtime fires `extractFromMessage(msgId)` as a background task. The user
 * doesn't wait for it. Failures here MUST surface specific errors per
 * [feedback_no_silent_failure.md] — but they MUST NOT block the chat reply.
 *
 * Strict fabrication rule per [feedback_no_fabrication.md]:
 *   - Only extract claims VERBATIM from the source message.
 *   - Never invent stats, names, numbers, or dates.
 *   - If unsure, emit nothing for that turn rather than guessing.
 */

import { llmGenerate } from "../pipeline/llm.js";
import * as messages from "./messages.js";
import * as facts from "./facts.js";
import * as preferences from "./preferences.js";

interface ExtractionLine {
  kind: "preference" | "fact" | "goal" | "constraint" | "skill" | "relationship";
  subject: string;
  content: string;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a memory extractor. Read a single message from a conversation and emit ONLY claims that are stated VERBATIM in the message.

Rules:
- DO NOT invent facts, stats, names, dates, or numbers. If something is not literally said in the message, do not emit it.
- DO NOT guess. If the message has no extractable claim, return an empty list.
- Preferences are operator statements about how they want things done ("I prefer X", "I always Y", "don't Z").
- Facts are statements about the operator, their work, or the world ("I work at X", "the launch is Y").
- Goals are intentions ("I want to ship X by Y").
- Constraints are hard limits the operator put on the agent ("never call provider X", "do not send before Y").
- Skills describe operator capabilities ("I write in Russian", "I've used Postiz for 2 years").
- Relationships connect entities ("Sarah is my co-founder", "Brand X is owned by Y").

Output STRICT JSON: { "extractions": [ { "kind": "...", "subject": "...", "content": "...", "confidence": 0.0-1.0 } ] }
Each "content" string MUST be a tight paraphrase that preserves every concrete word from the source. "subject" should be 1-3 words ("user", "brand", "linkedin", "launch-date"). Use 0.8+ confidence only for explicit, unambiguous statements.`;

export interface ExtractedSummary {
  inserted: number;
  reinforced: number;
  preferencesUpserted: number;
  extractorModel: string;
}

/**
 * Run extraction on one message. Idempotent — messages are marked
 * extracted_at so callers can skip already-processed rows.
 */
export async function extractFromMessage(
  messageId: string,
): Promise<ExtractedSummary> {
  const msg = messages.getById(messageId);

  if (msg.role !== "user" && msg.role !== "assistant") {
    messages.markExtracted(messageId);
    return { inserted: 0, reinforced: 0, preferencesUpserted: 0, extractorModel: "skip" };
  }
  if (!msg.content.trim()) {
    messages.markExtracted(messageId);
    return { inserted: 0, reinforced: 0, preferencesUpserted: 0, extractorModel: "empty" };
  }

  // Cheap model for extraction — Haiku class is plenty here.
  const userPrompt =
    `Source role: ${msg.role}\n` +
    `Source message:\n"""${msg.content.slice(0, 8000)}"""\n\n` +
    `Emit extractions as JSON.`;

  const raw = await llmGenerate(SYSTEM_PROMPT, userPrompt, {
    model: "claude-haiku-4-5-20251001",
    temperature: 0.1,
    maxTokens: 1024,
    caller: "agent.extractor",
  });

  const parsed = parseExtractions(raw);

  let inserted = 0;
  let reinforced = 0;
  let prefsUpserted = 0;

  for (const x of parsed) {
    if (!x.content.trim() || !x.subject.trim()) continue;
    if (x.confidence < 0.4) continue; // skip low-conf to limit noise

    if (x.kind === "preference" && msg.role === "user") {
      // Preferences from the user become user_preference rows. Use subject
      // as the key when it's terse, else hash the content into a key.
      const key = makePreferenceKey(x.subject, x.content);
      preferences.upsert({
        key,
        value: x.content,
        setExplicitly: true,
        setViaMessageId: msg.id,
      });
      prefsUpserted += 1;
    }

    const { created } = facts.upsertFact({
      type: x.kind,
      subject: x.subject.toLowerCase(),
      content: x.content,
      sourceMessageId: msg.id,
      extractorModel: "claude-haiku-4-5-20251001",
      confidence: x.confidence,
    });
    if (created) inserted += 1;
    else reinforced += 1;
  }

  messages.markExtracted(messageId);
  return {
    inserted,
    reinforced,
    preferencesUpserted: prefsUpserted,
    extractorModel: "claude-haiku-4-5-20251001",
  };
}

/**
 * Run extraction over the backlog. Use this from a cron / background worker.
 * Returns the number of messages processed (NOT the number of facts found).
 */
export async function extractBacklog(batchSize = 25): Promise<number> {
  const todo = messages.listUnextracted(batchSize);
  let n = 0;
  for (const m of todo) {
    try {
      await extractFromMessage(m.id);
    } catch (err) {
      // Surface the error but keep grinding — one bad row shouldn't stop the
      // whole sweep. We do NOT markExtracted on failure so the next pass
      // retries it.
      console.error(
        `[agent.extractor] message ${m.id} failed: ${(err as Error).message}`,
      );
    }
    n += 1;
  }
  return n;
}

function parseExtractions(raw: string): ExtractionLine[] {
  // The model sometimes returns text around the JSON. Grab the first {...}.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const obj = JSON.parse(match[0]) as { extractions?: ExtractionLine[] };
    if (!Array.isArray(obj.extractions)) return [];
    return obj.extractions.filter(
      (x) =>
        x &&
        typeof x.kind === "string" &&
        typeof x.subject === "string" &&
        typeof x.content === "string" &&
        typeof x.confidence === "number" &&
        ["preference", "fact", "goal", "constraint", "skill", "relationship"].includes(x.kind),
    );
  } catch {
    return [];
  }
}

function makePreferenceKey(subject: string, content: string): string {
  const subj = subject.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 32);
  const tail = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 24);
  return `${subj}__${tail}`;
}
