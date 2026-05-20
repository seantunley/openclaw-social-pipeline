/**
 * Conversation summaries — derived/rebuildable rollups stored in
 * `conversation_summary`. Used to give the agent efficient long-context
 * recall without loading every message of an old conversation.
 *
 * Summaries are NEVER load-bearing. They can be deleted + regenerated at
 * any time. The raw episodic record in agent_message is the source of truth.
 */

import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { conversationSummary } from "../../db/schema.js";
import { llmGenerate } from "../pipeline/llm.js";
import * as messagesRepo from "./messages.js";
import type { Message } from "./messages.js";

const SUMMARIZER_MODEL = "claude-haiku-4-5-20251001";

export type SummaryPeriod = "turn" | "day" | "week" | "conversation";

const CONVERSATION_PROMPT = `You are summarising a single conversation between the operator and the agent.

Goals:
  1. Capture what the operator wanted, what was decided, and what is still open.
  2. Preserve every concrete value mentioned (names, dates, numbers, URLs).
  3. DO NOT invent anything not present in the messages.
  4. Output one tight paragraph (4-8 sentences). No bullet points, no headers.

If the conversation is too short to summarise meaningfully, output: "Conversation too short to summarise."`;

/**
 * Summarise a whole conversation into one paragraph. Replaces any prior
 * conversation-level summary (we want a single authoritative one).
 */
export async function summarizeConversation(
  conversationId: string,
  maxMessages = 200,
): Promise<string> {
  const msgs = messagesRepo.listForConversation(conversationId, maxMessages);
  if (msgs.length < 2) return "";

  const transcript = renderTranscript(msgs);
  const summary = await llmGenerate(CONVERSATION_PROMPT, transcript, {
    model: SUMMARIZER_MODEL,
    temperature: 0.2,
    maxTokens: 800,
    caller: "agent.summarizer",
  });

  await persistSummary({
    conversationId,
    period: "conversation",
    startMessageId: msgs[0].id,
    endMessageId: msgs[msgs.length - 1].id,
    summaryText: summary,
  });
  return summary;
}

interface PersistArgs {
  conversationId: string;
  period: SummaryPeriod;
  startMessageId?: string;
  endMessageId?: string;
  bucketDate?: string;
  summaryText: string;
}

async function persistSummary(args: PersistArgs): Promise<string> {
  const db = getDb();
  // For conversation-level summaries we keep only the latest. For other
  // periods (day/week) we append because they cover non-overlapping ranges.
  if (args.period === "conversation") {
    const existing = db
      .select()
      .from(conversationSummary)
      .where(
        and(
          eq(conversationSummary.conversation_id, args.conversationId),
          eq(conversationSummary.period, "conversation"),
        ),
      )
      .orderBy(desc(conversationSummary.created_at))
      .limit(1)
      .all();
    if (existing.length > 0) {
      db.update(conversationSummary)
        .set({
          summary_text: args.summaryText,
          start_message_id: args.startMessageId ?? null,
          end_message_id: args.endMessageId ?? null,
          summarizer_model: SUMMARIZER_MODEL,
        })
        .where(eq(conversationSummary.id, (existing[0] as { id: string }).id))
        .run();
      return (existing[0] as { id: string }).id;
    }
  }

  const id = randomUUID();
  db.insert(conversationSummary)
    .values({
      id,
      conversation_id: args.conversationId,
      period: args.period,
      start_message_id: args.startMessageId ?? null,
      end_message_id: args.endMessageId ?? null,
      bucket_date: args.bucketDate ?? null,
      summary_text: args.summaryText,
      summarizer_model: SUMMARIZER_MODEL,
    })
    .run();
  return id;
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

/** Latest conversation-level summary for a conversation, if any. */
export function getLatestConversationSummary(
  conversationId: string,
): string | null {
  const db = getDb();
  const row = db
    .select()
    .from(conversationSummary)
    .where(
      and(
        eq(conversationSummary.conversation_id, conversationId),
        eq(conversationSummary.period, "conversation"),
      ),
    )
    .orderBy(desc(conversationSummary.created_at))
    .limit(1)
    .get();
  return row ? (row as { summary_text: string }).summary_text : null;
}
