/**
 * Agent chat API — single endpoint that routes through the agent runtime.
 * Mirrors the bot's `/chat` flow so the dashboard has identical behaviour
 * (same memory, same defense, same skills, same persona).
 */

import type { FastifyPluginAsync } from "fastify";
import { chat } from "../../src/services/agent/runtime.js";
import { chatStream } from "../../src/services/agent/runtime-stream.js";
import { getProfile, updateProfile } from "../../src/services/agent/profile.js";
import { listRecent } from "../../src/services/agent/conversations.js";
import { listForConversation } from "../../src/services/agent/messages.js";
import { listActive as listActivePrefs, upsert as upsertPref, deactivate as deactivatePref } from "../../src/services/agent/preferences.js";
import { listActive as listActiveFacts } from "../../src/services/agent/facts.js";
import { listActive as listActiveLessons } from "../../src/services/agent/lessons.js";

const agentRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/social/agent/chat", async (req, reply) => {
    const body = req.body as {
      message: string;
      surfaceRef?: string;
      conversationId?: string;
      modelOverride?: string;
      temperatureOverride?: number;
    };
    if (!body.message || typeof body.message !== "string") {
      return reply.status(400).send({ error: "message required" });
    }
    const result = await chat({
      userMessage: body.message,
      surface: "dashboard",
      surfaceRef: body.surfaceRef ?? "dashboard-default",
      conversationId: body.conversationId,
      modelOverride: body.modelOverride,
      temperatureOverride: body.temperatureOverride,
    });
    return result;
  });

  // Streaming variant: SSE token-by-token. Drawer UI consumes this for the
  // typewriter-style assistant reply per the original brief.
  // Frames:
  //   event: token      data: "<delta>"
  //   event: tool       data: {"name":"...","input":{...}}
  //   event: tool_result data: {"name":"...","output":{...}}
  //   event: done       data: {"messageId":"...","conversationId":"..."}
  //   event: error      data: {"message":"..."}
  app.post("/api/social/agent/chat/stream", async (req, reply) => {
    const body = req.body as {
      message: string;
      surfaceRef?: string;
      modelOverride?: string;
      temperatureOverride?: number;
    };
    if (!body.message || typeof body.message !== "string") {
      return reply.status(400).send({ error: "message required" });
    }

    // Hand the underlying socket off to us so Fastify doesn't try to send
    // its own response after we've started writing SSE frames.
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const write = (event: string, data: string) => {
      reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
    };

    try {
      await chatStream(
        {
          userMessage: body.message,
          surface: "dashboard",
          surfaceRef: body.surfaceRef ?? "dashboard-default",
          modelOverride: body.modelOverride,
          temperatureOverride: body.temperatureOverride,
        },
        {
          onToken: (delta) => write("token", JSON.stringify(delta)),
          onToolCall: (call) => write("tool", JSON.stringify(call)),
          onToolResult: (res) => write("tool_result", JSON.stringify(res)),
          onDone: (final) => write("done", JSON.stringify(final)),
          onError: (msg) => write("error", JSON.stringify({ message: msg })),
        },
      );
    } catch (err) {
      write("error", JSON.stringify({ message: (err as Error).message }));
    } finally {
      reply.raw.end();
    }
  });

  app.get("/api/social/agent/profile", async () => ({ profile: getProfile() }));

  app.put("/api/social/agent/profile", async (req) => {
    const body = req.body as {
      name?: string;
      systemPrompt?: string;
      defaultModel?: string;
      defaultTemperature?: number;
      maxSteps?: number;
    };
    return { profile: updateProfile(body) };
  });

  app.get("/api/social/agent/conversations", async (req) => {
    const q = req.query as { surface?: "telegram" | "dashboard" | "system"; limit?: string };
    return {
      items: listRecent(q.surface, Math.min(Math.max(Number(q.limit ?? 25), 1), 100)),
    };
  });

  app.get("/api/social/agent/conversations/:id/messages", async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    return {
      items: listForConversation(id, Math.min(Math.max(Number(q.limit ?? 100), 1), 500)),
    };
  });

  app.get("/api/social/agent/memory", async () => {
    return {
      preferences: listActivePrefs(),
      facts: listActiveFacts({ limit: 200 }),
      lessons: listActiveLessons(100, 0),
    };
  });

  app.post("/api/social/agent/preferences", async (req) => {
    const body = req.body as { key: string; value: string };
    return { preference: upsertPref({ key: body.key, value: body.value }) };
  });

  app.delete("/api/social/agent/preferences/:key", async (req) => {
    const { key } = req.params as { key: string };
    deactivatePref(key);
    return { ok: true };
  });
};

export default agentRoutes;
