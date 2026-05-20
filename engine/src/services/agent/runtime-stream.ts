/**
 * Streaming agent runtime — wraps `chat()` and chunks the final reply over
 * SSE so the dashboard drawer can show typewriter-style output.
 *
 * Native token streaming through pi-ai's Codex flow isn't directly supported,
 * so we chunk-stream the assembled reply instead. To the user that looks
 * like progressive output; to the wire format it's a sequence of `token`
 * events followed by a `done` event. Tool calls are surfaced verbatim
 * before the tokens stream so the drawer can render them inline.
 */

import { chat, type ChatInput } from "./runtime.js";

export interface StreamHooks {
  onToken(delta: string): void;
  onToolCall(call: { name: string; input: unknown; callId: string }): void;
  onToolResult(res: { name: string; output: unknown; callId: string }): void;
  onDone(final: {
    status: "ok" | "blocked" | "killed" | "llm_failed";
    reply: string;
    conversationId: string;
    userMessageId: string | null;
    assistantMessageId: string | null;
    inboundEventId: string | null;
    outboundEventId: string | null;
    agentName: string;
  }): void;
  onError(message: string): void;
}

const CHUNK_SIZE = 24; // characters per token event
const CHUNK_DELAY_MS = 18;

export async function chatStream(input: ChatInput, hooks: StreamHooks): Promise<void> {
  try {
    const result = await chat(input);

    // Surface tool calls first (drawer renders them inline above the typing
    // assistant block, mirroring the original brief's "tool calls visible
    // as collapsible blocks inline with the chat").
    for (const tc of result.toolCalls) {
      const callId = `${tc.name}-${tc.durationMs}-${Math.random().toString(36).slice(2, 8)}`;
      hooks.onToolCall({ name: tc.name, input: tc.input, callId });
      hooks.onToolResult({ name: tc.name, output: tc.output, callId });
    }

    // Chunk-stream the reply so the drawer can show progressive output.
    const reply = result.reply ?? "";
    for (let i = 0; i < reply.length; i += CHUNK_SIZE) {
      hooks.onToken(reply.slice(i, i + CHUNK_SIZE));
      if (CHUNK_DELAY_MS > 0 && i + CHUNK_SIZE < reply.length) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
      }
    }

    hooks.onDone({
      status: result.status,
      reply: result.reply,
      conversationId: result.conversationId,
      userMessageId: result.userMessageId,
      assistantMessageId: result.assistantMessageId,
      inboundEventId: result.inboundEventId,
      outboundEventId: result.outboundEventId,
      agentName: result.agentName,
    });
  } catch (err) {
    hooks.onError((err as Error).message);
  }
}
