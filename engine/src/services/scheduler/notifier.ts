/**
 * Fire notifier for the recurring scheduler. Routes each fire's outcome
 * to (a) the operator's most-recent dashboard chat conversation as a
 * role='system' message, and (b) optionally a Telegram DM via the Bot API.
 *
 * Both channels fail silently with a log line — a notification miss
 * should NOT roll back a successful pipeline run.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { socialConfig } from "../../db/schema.js";
import {
  listRecent,
  getOrCreateConversation,
} from "../agent/conversations.js";
import { appendMessage } from "../agent/messages.js";

export interface NotifyInput {
  /** Schedule that just fired — used in the summary line. */
  scheduleId: string;
  scheduleName: string;
  /** Outcome line from dispatchScheduleAction. */
  summary: string;
  /** True if everything succeeded; false → red-flagged in chat. */
  ok: boolean;
  /** Primary run id when the action produced one — used to deep-link. */
  runId?: string | null;
  /** Whether to drop a chat-system-message. Defaults to true. */
  notifyChat?: boolean;
  /** Whether to send a Telegram DM. Defaults to false. */
  notifyTelegram?: boolean;
  /** Optional logger for failure paths. */
  log?: {
    info: (...args: any[]) => void;
    error: (...args: any[]) => void;
    warn: (...args: any[]) => void;
  };
}

export async function notifyFire(input: NotifyInput): Promise<void> {
  const log = input.log ?? {
    info: console.log,
    error: console.error,
    warn: console.warn,
  };

  const icon = input.ok ? "✅" : "⚠️";
  const headline = `${icon} Schedule "${input.scheduleName}" fired`;
  const runHint = input.runId
    ? `\nRun: ${input.runId}`
    : "";
  const body = `${headline}\n${input.summary}${runHint}`;

  // Drop a chat system message into the most recent dashboard conversation.
  // If none exists yet, mint a dedicated "schedule-notifications" conversation
  // so the operator sees something the first time a schedule fires.
  if (input.notifyChat !== false) {
    try {
      const recent = listRecent("dashboard", 1);
      let conversationId: string;
      if (recent.length > 0) {
        conversationId = recent[0].id;
      } else {
        const conv = getOrCreateConversation(
          "dashboard",
          "schedule-notifications",
          "Schedule notifications",
        );
        conversationId = conv.id;
      }
      appendMessage({
        conversationId,
        role: "system",
        content: body,
        toolName: "scheduler.fire",
        toolResult: {
          schedule_id: input.scheduleId,
          ok: input.ok,
          run_id: input.runId ?? null,
        },
      });
    } catch (err) {
      log.error(
        { err, scheduleId: input.scheduleId },
        "[scheduler] failed to post chat notification",
      );
    }
  }

  // Telegram DM via Bot API HTTP. We use the existing TELEGRAM_BOT_TOKEN
  // env var and a chat_id stored in social_config under key 'general'
  // (telegram_operator_chat_id). When either is missing we skip with a
  // single WARN — repeated warnings on every fire are noise.
  if (input.notifyTelegram) {
    try {
      const sent = await sendTelegramNotification(body);
      if (!sent.ok) {
        log.warn(
          { scheduleId: input.scheduleId, reason: sent.reason },
          "[scheduler] Telegram notification skipped",
        );
      }
    } catch (err) {
      log.error(
        { err, scheduleId: input.scheduleId },
        "[scheduler] Telegram notification failed",
      );
    }
  }
}

async function sendTelegramNotification(
  body: string,
): Promise<{ ok: boolean; reason?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, reason: "TELEGRAM_BOT_TOKEN not set" };
  }
  const chatId = readOperatorChatId();
  if (!chatId) {
    return {
      ok: false,
      reason:
        "telegram_operator_chat_id not configured (set in Settings → Telegram)",
    };
  }

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: body,
        disable_web_page_preview: true,
      }),
    },
  );
  if (!res.ok) {
    return {
      ok: false,
      reason: `Telegram API ${res.status}: ${await res.text().catch(() => "")}`,
    };
  }
  return { ok: true };
}

function readOperatorChatId(): string | null {
  try {
    const db = getDb();
    const row = db
      .select()
      .from(socialConfig)
      .where(eq(socialConfig.key, "general"))
      .get() as { value: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.value) as {
      telegram_operator_chat_id?: string | number;
    };
    if (!parsed.telegram_operator_chat_id) return null;
    return String(parsed.telegram_operator_chat_id);
  } catch {
    return null;
  }
}
