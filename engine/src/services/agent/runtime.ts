/**
 * Agent runtime — the chat() loop. One entry point used by both surfaces
 * (Telegram bot, dashboard chat) so memory, persona, defense, and skills
 * are identical across them.
 *
 * Provider chain: routes through `llmGenerate` in services/pipeline/llm.ts,
 * which already supports Anthropic API key + Codex OAuth (via pi-ai) and
 * picks based on LLM_PROVIDER env var. The agent therefore inherits Codex
 * support for free — operators using ChatGPT Plus don't need an Anthropic
 * key. Tool calling is implemented as text-based JSON (any model that can
 * follow instructions can call tools), not Vercel AI SDK's structured
 * tool-use API which is provider-specific.
 *
 * One turn:
 *   1. Kill-switch check.
 *   2. Inbound defense (Layers 1+2 via checkInbound, plus operator overrides:
 *      banned_input_hash, blocked_category, runtime_state).
 *   3. Resolve / create conversation; append the user message.
 *   4. Recall memory: preferences, lessons, recent + retrieved messages, facts.
 *   5. Compose the system prompt: profile + memory + tool descriptors.
 *   6. Loop up to profile.max_steps:
 *      a. Call llmGenerate (governor + Codex/Anthropic fallback).
 *      b. Parse output for a `{"tool": "...", "input": {...}}` line.
 *      c. If found: execute, append as a tool turn, loop.
 *      d. Otherwise: that's the final reply — break.
 *   7. Outbound defense (Layers 3+4 via checkOutbound).
 *   8. Append the assistant message + fire extract+embed background tasks.
 *   9. Return the reply.
 */

import { createHash } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { llmGenerateWithAttempts, AllProvidersFailed, type LlmProvider } from "../pipeline/llm.js";
import { checkInbound, checkOutbound, type InputSource } from "../agent-defense/index.js";
import { getDb } from "../../db/index.js";
import { socialConfig, socialLearning } from "../../db/schema.js";
import * as profile from "./profile.js";
import * as conversations from "./conversations.js";
import * as messages from "./messages.js";
import * as runtimeState from "./runtime-state.js";
import * as skills from "./skills.js";
import * as extractor from "./extractor.js";
import * as embedWriter from "./embed-writer.js";
import { recall, renderForPrompt as renderRecall } from "./retriever.js";
import {
  isInputHashBanned,
  hasCategoryBlocked,
} from "../agent-defense/operator-overrides.js";
import { buildToolset, renderToolsForPrompt, type AgentToolset, ASK_OPERATOR_TOOL } from "./tools/index.js";
import { buildGpt5Overlay } from "./gpt5-prompt-overlay.js";

export type ChatSurface = "telegram" | "dashboard" | "system";

export interface ChatInput {
  /** User-visible text. Defense sees the raw text first. */
  userMessage: string;
  surface: ChatSurface;
  /** Telegram chatId stringified, dashboard session uuid, etc. */
  surfaceRef: string;
  /**
   * Explicit conversation id to append to. When set, the runtime appends to
   * THIS conversation rather than resolving one by (surface, surfaceRef).
   * Used by the dashboard drawer when the operator resumes an old conversation.
   */
  conversationId?: string;
  /** Override the profile.default_model for this call. */
  modelOverride?: string;
  /** Override profile.default_temperature for this call. */
  temperatureOverride?: number;
}

export type ChatResultStatus = "ok" | "blocked" | "killed" | "llm_failed";

export interface ToolCallTrace {
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
}

/**
 * Structured clarification the agent emitted via the `askOperator` tool.
 * When present, the drawer renders the question + button options instead of
 * a normal assistant text bubble. Operator's button tap arrives back as
 * their next user message.
 */
export interface AskClarification {
  question: string;
  options: Array<{ label: string; value: string }>;
  multiSelect?: boolean;
  allowFreeText?: boolean;
}

export interface ChatResult {
  status: ChatResultStatus;
  reply: string;
  conversationId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  inboundEventId: string | null;
  outboundEventId: string | null;
  /** Recall warnings (e.g. vector recall fell back to FTS-only). */
  warnings: string[];
  /** Tool calls the model made during this turn, in order. */
  toolCalls: ToolCallTrace[];
  /** Agent's display name from the profile — bot signs replies with this. */
  agentName: string;
  /** Which provider actually produced this reply ('anthropic' | 'openai-codex' | null). */
  provider: LlmProvider | null;
  /** The model the operator asked for (their preference). */
  requestedModel: string;
  /** What provider attempts looked like — useful for the SOC / surface in UI. */
  providerAttempts: Array<{ provider: string; ok: boolean; error?: string }>;
  /**
   * When the agent called the `askOperator` tool this turn, this holds the
   * structured question + button options. The drawer renders buttons; on
   * tap, the operator's chosen value is sent as the next user message.
   */
  clarification: AskClarification | null;
}

export async function chat(input: ChatInput): Promise<ChatResult> {
  // 1. Kill switch — fail fast, no DB writes, no LLM call.
  if (runtimeState.isKillSwitchOn()) {
    return refusal(
      input,
      "killed",
      "Agent is currently suspended by the operator. Use the Operations page to re-enable.",
    );
  }

  // 2a. Operator overrides — banned input hash, then inbound defense.
  const inputHash = createHash("sha256").update(input.userMessage).digest("hex");
  if (isInputHashBanned(inputHash)) {
    return refusal(
      input,
      "blocked",
      "Input matches a banned hash. The operator has blocked this exact input.",
    );
  }

  // 2b. Inbound defense.
  //
  // For operator-only surfaces (dashboard, telegram) we run L1 (deterministic,
  // <1ms) but skip L2 (LLM scanner) on inputs L1 found clean. Rationale:
  //   - The prompt-injection threat model for this app is content the agent
  //     INGESTS (web search results, email, webhooks) — not what the
  //     authenticated operator types.
  //   - L2 adds ~5-15s per turn (it's a second LLM call) and L1 already
  //     catches every encoding/jailbreak signature in the Pliny corpus.
  //   - We still run L2 if L1 fires any detection — that's where its value lives.
  //
  // For untrusted sources (webhook, email, web) we leave both layers on.
  const inboundSource: InputSource = input.surface === "telegram" ? "telegram" : "chat";
  const trustedOperatorSurface = input.surface === "telegram" || input.surface === "dashboard";
  const inbound = await checkInbound(input.userMessage, inboundSource, {
    // We can't pre-check skipFrontier without running L1 first; the defense
    // module already short-circuits L2 when L1 severity is critical. Here
    // we additionally skip L2 for trusted surfaces (L1 still runs).
    skipFrontier: trustedOperatorSurface,
  });
  if (inbound.verdict === "block") {
    return refusal(
      input,
      "blocked",
      `Inbound defense blocked this message (severity: ${inbound.severity}). ` +
        `See the Operations → Live Events tab for details.`,
      inbound.securityEventId,
    );
  }
  // 2c. Operator category blocks — if any reported category is blocked, refuse.
  const inboundCategories = collectInboundCategories(inbound);
  const blockedCat = inboundCategories.find((c) => hasCategoryBlocked(c));
  if (blockedCat) {
    return refusal(
      input,
      "blocked",
      `Inbound matched a category the operator has temporarily blocked: ${blockedCat}.`,
      inbound.securityEventId,
    );
  }

  // 3. Conversation + user message persistence.
  //
  // If the caller passed an explicit conversationId (operator resumed an old
  // conversation in the dashboard drawer), look that one up. Otherwise resolve
  // (or create) by (surface, surfaceRef). The explicit-id path is what makes
  // "click an old conversation → keep talking in it" work — otherwise
  // surfaceRef would be misinterpreted as a session id and a fresh
  // conversation would be created on every send.
  const conv = input.conversationId
    ? conversations.getById(input.conversationId)
    : conversations.getOrCreateConversation(input.surface, input.surfaceRef);
  if (!conv.title) {
    conversations.setTitle(conv.id, input.userMessage.slice(0, 60));
  }
  const userMsg = messages.appendMessage({
    conversationId: conv.id,
    role: "user",
    content: inbound.cleaned, // store the sanitized version
  });

  // 4. Memory recall.
  const recalled = await recall({
    conversationId: conv.id,
    query: input.userMessage,
  });
  const memoryBlock = renderRecall(recalled);

  // 5. Compose system + user prompts.
  const prof = profile.getProfile();
  const toolset = buildToolset();
  const toolsBlock = renderToolsForPrompt(toolset);
  const approvedSkills = skills.loadActiveTools();
  const resolvedModelId = input.modelOverride ?? prof.default_model;
  const now = new Date();
  const defaultPlatforms = readDefaultPlatforms();
  const learnings = readActiveLearningsSummary();
  const isGpt5 = /^(?:gpt-5|openai\/gpt-5)/i.test(resolvedModelId);

  // -----------------------------------------------------------------------
  // Consolidated system prompt. Previously this was ~4000+ tokens of
  // layered, overlapping rule blocks (askOperator policy, ralph loop,
  // platform policy, GPT-5 overlay, today block, persona, memory, tools,
  // skills) and the agent was producing random / off-piste output as a
  // result of trying to satisfy competing constraints. This is the same
  // contract compressed to one clear document. Operator priorities baked
  // in:
  //   1. Conversational + warm — first-person, short, human.
  //   2. Helpful — pick the right tool, act on clear intent.
  //   3. No random irrelevant output — every sentence advances the task.
  //   4. Token efficient — no boilerplate, no repeated rules.
  // -----------------------------------------------------------------------
  const persona = prof.system_prompt ||
    "You assist one operator running a single-author social-media content pipeline.";

  const systemPrompt = [
    `You are ${prof.name || "the agent"}. ${persona}`,
    "",
    `Today: ${now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · ${now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} (ISO ${now.toISOString()}). Resolve "tomorrow", "next week", "Friday" against THIS, not training data.`,
    "",
    `Operator's configured platforms: ${defaultPlatforms.join(", ")}. When you ASK which platform via askOperator, the options array MUST include every one of those (each as {label, value}) plus a final {"label":"Other (specify)","value":"other"} escape. Do NOT invent a different option set, and do NOT omit platforms the operator has configured.`,
    "",
    "Platform is CONSIDERED NAMED if the operator's message contains any of these tokens anywhere (case-insensitive): linkedin, twitter, x, x.com, instagram, insta, ig, facebook, fb, threads, tiktok, youtube, bluesky, pinterest, reddit, vk. That counts as 'platform specified' for routing — DO NOT ask askOperator about platform when one of those is present. Example: 'Instagram Carousel about X' → platform = instagram (and format = carousel).",
    "",
    "Format is CONSIDERED NAMED if the message contains: carousel, reel, story, short, thread, single. Pass format through to runPipeline when present.",
    "",
    learnings.count > 0
      ? `Active operator rules: ${learnings.count} (categories: ${learnings.categories.join(", ")}). The pipeline automatically injects every active rule into research / SEO+GEO / psychology / humanize stages on every run — you don't need to restate them. When the operator edits a draft via editDraft, ALWAYS pass their reason verbatim as 'notes' so new rules can be extracted. When they ask 'are you using my rules?' the honest answer is yes — every run pulls them.`
      : "No operator learning rules captured yet. They build up automatically when the operator edits drafts (via editDraft with a notes argument, or via the dashboard's edit UI).",
    "",
    "DECISION ORDER on every turn:",
    "1. Missing PLATFORM (per the recognition list above) / TIME / RUN-ID / specific DAY? → call askOperator with 2-8 button options. Never infer silently. Never list options as plain text — that's friction.",
    "2. Multi-day intent (any phrase implying N>1 posts: 'every week', 'daily', 'each weekday', 'for N days', '5 posts')? → scheduleMultiDayCampaign with one entry per day. Per-day topics MUST include the date label.",
    "3. Multi-platform single-shot (operator named ≥2 platforms)? → runPipelineMulti.",
    "4. Single platform new post (one platform named)? → runPipeline.",
    "5. Adapt an existing run for OTHER platform(s) (single-day)? → rewriteForPlatform. NEVER use this for multi-day campaigns.",
    "6. Inspect runs? → listRuns / getRun.",
    "7. Approve / publish? → approveDraft, publishToPostiz.",
    "",
    "TOOL-CALL FORMAT: emit a single JSON object on its own line, no prose around it:",
    '  {"tool":"<name>","input":{...}}',
    "",
    "HARD RULES:",
    "• A completion claim ('done', 'scheduled it', 'I created') is a LIE unless a matching tool call ran THIS TURN. The runtime verifies and will force you to retry.",
    "• If your reply would contain a bulleted list of platforms / days / run-ids to pick from → STOP, emit askOperator instead.",
    "• Never invent run IDs, dates, statistics, or names. Use only what's in memory or what tools returned.",
    "• No 'Say the magic words' / 'Just reply with' / 'Send: ...' nudges. Either act or askOperator.",
    "",
    "TONE: live-chat — short, natural, human. First-person feeling OK when useful ('I'm glad we caught that', 'that's frustrating'). No memo voice, no walls of text, no repetitive restatement. Occasional emoji fine, sparse.",
    isGpt5
      ? "Keep persona consistent across turns even after tool calls. Concise, dense replies; don't repeat the prompt."
      : "",
    approvedSkills.length > 0
      ? `\nApproved external skills (read-only reference): ${approvedSkills.map((t) => t.name).join(", ")}.`
      : "",
    "",
    memoryBlock,
    "",
    toolsBlock,
  ]
    .filter((s): s is string => Boolean(s !== null && s !== undefined && (typeof s !== "string" || s.length > 0)))
    .join("\n");

  // 6. Manual tool-calling loop. Uses llmGenerate → Codex/Anthropic chain.
  const modelId = input.modelOverride ?? prof.default_model;
  const maxSteps = Math.max(1, prof.max_steps);
  const toolCalls: ToolCallTrace[] = [];

  // Running transcript fed back to the model on each tool round so it can
  // see its own previous tool calls + results without losing context.
  let runningPrompt = inbound.cleaned;
  let finalReply = "";
  // Set when the agent emits an askOperator tool call. Drawer renders buttons.
  let clarification: AskClarification | null = null;
  // Detect plural intent up front — used by the ralph-loop verifier to catch
  // single-run replies to multi-run requests.
  const intent = detectPluralIntent(inbound.cleaned);
  // Track which provider actually answered the FINAL (non-tool) reply, so
  // the UI can show "answered by openai-codex" instead of just the operator's
  // preferred model id. We capture the last successful provider in the loop.
  let lastProvider: LlmProvider | null = null;
  let lastAttempts: Array<{ provider: string; ok: boolean; error?: string }> = [];

  for (let step = 0; step < maxSteps; step += 1) {
    let raw: string;
    try {
      const r = await llmGenerateWithAttempts(systemPrompt, runningPrompt, {
        model: modelId,
        temperature: input.temperatureOverride ?? prof.default_temperature,
        maxTokens: 2048,
        caller: "agent.runtime",
      });
      raw = r.text;
      lastProvider = r.provider;
      lastAttempts = r.attempts.map((a) => ({
        provider: a.provider,
        ok: a.ok,
        error: a.error,
      }));
    } catch (err) {
      const errorMsg = err instanceof AllProvidersFailed ? err.message : (err as Error).message;
      return {
        status: "llm_failed",
        reply: `LLM call failed: ${errorMsg}`,
        conversationId: conv.id,
        userMessageId: userMsg.id,
        assistantMessageId: null,
        inboundEventId: inbound.securityEventId,
        outboundEventId: null,
        warnings: recalled.warnings,
        toolCalls,
        agentName: prof.name,
        provider: null,
        requestedModel: modelId,
        providerAttempts:
          err instanceof AllProvidersFailed
            ? err.attempts.map((a) => ({ provider: a.provider, ok: a.ok, error: a.error }))
            : [],
        clarification: null,
      };
    }

    const call = parseToolCall(raw, toolset);
    if (!call) {
      // RALPH LOOP — verify the reply matches the work.
      //
      // Two distinct failure modes:
      //   (1) Agent claims action with no tool call at all → re-prompt.
      //   (2) Operator's request implies N>1 outputs but only 1 was
      //       produced → re-prompt the agent to call the right multi-
      //       output tool (scheduleMultiDayCampaign, runPipelineMulti).
      //
      // Both are caught BEFORE the agent gets to write a final reply,
      // so the operator never sees "I did it (lie)" or "I did 1 of 5".
      if (toolCalls.length === 0 && claimsCompletedAction(raw) && step < maxSteps - 1) {
        runningPrompt =
          `${runningPrompt}\n\n` +
          `[ralph-loop verifier] Your previous reply claimed an action was completed, but you did not call any tool this turn — so nothing actually happened in the system. ` +
          `Choose one of:\n` +
          `  (A) Call the appropriate tool now to actually do the thing. Output ONLY the tool JSON.\n` +
          `  (B) Rewrite your reply to be honest that you did NOT execute, and either ASK with askOperator or explain what you need.\n` +
          `Do NOT produce another final reply that asserts completion without a matching tool call. Previous reply was:\n"""${raw.slice(0, 800)}"""`;
        continue;
      }
      // Intent mismatch: plural request but only one output.
      const runsProduced = countRunsProduced(toolCalls);
      if (
        intent.expected !== null &&
        intent.expected > 1 &&
        runsProduced < intent.expected &&
        step < maxSteps - 1
      ) {
        runningPrompt =
          `${runningPrompt}\n\n` +
          `[ralph-loop verifier] The operator's original message implied ${intent.expected} outputs (signal: "${intent.signal}"). ` +
          `So far this turn only ${runsProduced} run(s) were produced. That doesn't match the request.\n\n` +
          `Do NOT write a final reply yet. Instead, call the right tool to make up the difference:\n` +
          `  • scheduleMultiDayCampaign for multi-day campaigns (one run per day, date-labelled topics, auto-scheduled).\n` +
          `  • runPipelineMulti for multi-platform single-shot.\n` +
          `  • rewriteForPlatform with an array of platforms for multi-platform adaptation.\n\n` +
          `If the tool you used returns only one item per call, call it ${intent.expected} times (each with a distinct day/platform/parameter) — do not stop at one. ` +
          `When all ${intent.expected} runs exist, then write your final reply.`;
        continue;
      }
      // No tool call detected — model produced its final reply.
      finalReply = raw.trim() || "(no reply)";
      break;
    }

    // Special-case askOperator: don't execute, surface the question + button
    // options to the UI and end the turn here. The operator's tap is delivered
    // as their next user message.
    if (call.name === ASK_OPERATOR_TOOL) {
      const parsed = call.tool.schema.safeParse(call.input);
      if (parsed.success) {
        const data = parsed.data as AskClarification;
        // Runtime override — if the question is about which platform, force
        // the option set to match the operator's configured defaults + an
        // "Other (specify)" escape. The prompt tells the model to do this,
        // but Codex sometimes invents its own list ("LinkedIn / Other") so
        // we enforce it server-side. Detection is keyword-based on the
        // question text: anything mentioning platform/where-to-post.
        const isPlatformQuestion = /\b(?:which|what)\s+platform\b|\bwhere\s+(?:should|do you want|to post)\b|\bplatform(?:\?|$)/i.test(
          data.question,
        );
        const finalOptions = isPlatformQuestion
          ? [
              ...defaultPlatforms.map((p) => ({ label: capitaliseLabel(p), value: p })),
              { label: "Other (specify)", value: "other" },
            ]
          : data.options;
        clarification = {
          question: data.question,
          options: finalOptions,
          // Force multi-select on every clarification — the operator
          // explicitly asked for "multiple selections" to always be
          // available, even when the agent thought the answer was
          // single-valued. The drawer renders pills that toggle, with
          // a single Send button; tapping one pill + Send still works
          // for genuine single-answer cases.
          multiSelect: true,
          allowFreeText: data.allowFreeText,
        };
        finalReply = data.question;
        toolCalls.push({
          name: call.name,
          input: call.input,
          output: { surfacedToOperator: true },
          durationMs: 0,
        });
        break;
      }
      // If the agent emitted a malformed askOperator call, surface the
      // schema error like any other tool failure and keep looping — the
      // model may retry with a valid shape.
      toolCalls.push({
        name: call.name,
        input: call.input,
        output: { error: "askOperator input invalid", issues: parsed.error.issues },
        durationMs: 0,
      });
      runningPrompt =
        `${runningPrompt}\n\n` +
        `askOperator call rejected — schema error: ${JSON.stringify(parsed.error.issues).slice(0, 400)}.\n` +
        `Either fix the input or skip the question and act.`;
      continue;
    }

    // Execute the tool. Capture trace + feed result back into the loop.
    const t0 = Date.now();
    let output: unknown;
    try {
      const parsed = call.tool.schema.safeParse(call.input);
      if (!parsed.success) {
        output = {
          error: "input did not match the tool schema",
          issues: parsed.error.issues,
        };
      } else {
        output = await call.tool.execute(parsed.data);
      }
    } catch (err) {
      output = { error: (err as Error).message };
    }
    const durationMs = Date.now() - t0;
    toolCalls.push({ name: call.name, input: call.input, output, durationMs });

    runningPrompt =
      `${runningPrompt}\n\n` +
      `Assistant tool call:\n${JSON.stringify({ tool: call.name, input: call.input })}\n\n` +
      `Tool result (${call.name}):\n${JSON.stringify(output).slice(0, 6000)}\n\n` +
      `Continue. Either call another tool with the same JSON format, or write your final plain-text reply.`;

    if (step === maxSteps - 1) {
      // Last loop iteration — force a final answer next round? We already
      // hit the cap; surface a fallback so the operator sees what happened.
      finalReply = "(tool-call loop hit max_steps without a final reply — increase max_steps in Settings → Agent.)";
    }
  }

  // 7. Outbound defense (L3 + L4).
  const outbound = await checkOutbound(finalReply, { conversationId: conv.id });
  const safeReply =
    outbound.verdict === "block"
      ? "I was about to reply but my outbound defense layer blocked the message. The operator can review it in the Operations → Live Events tab."
      : outbound.suggested;

  // 8. Persist assistant turn (+ any tool-call rows so the SOC + UI can show them).
  const assistantMsg = messages.appendMessage({
    conversationId: conv.id,
    role: "assistant",
    content: safeReply,
    toolCalls: toolCalls.map((t) => ({ name: t.name, input: t.input })),
  });
  for (const tc of toolCalls) {
    messages.appendMessage({
      conversationId: conv.id,
      role: "tool",
      content: typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output ?? null),
      toolName: tc.name,
      toolResult: tc.output,
    });
  }

  scheduleBackground(userMsg.id, assistantMsg.id);

  return {
    status: "ok",
    reply: safeReply,
    conversationId: conv.id,
    userMessageId: userMsg.id,
    assistantMessageId: assistantMsg.id,
    inboundEventId: inbound.securityEventId,
    outboundEventId: outbound.securityEventId,
    warnings: recalled.warnings,
    toolCalls,
    agentName: prof.name,
    provider: lastProvider,
    requestedModel: modelId,
    providerAttempts: lastAttempts,
    clarification,
  };
}

// ---------------------------------------------------------------------------
// Ralph loop — intent vs. output verification.
//
// Two-tier check:
//   1. Did the agent CLAIM to have done something when no tool was called?
//      (catches pure-fluff replies — handled by claimsCompletedAction)
//   2. Did the operator's request imply MULTIPLE outputs (e.g. "every day
//      next week", "5 posts", "Mon-Fri") and the agent only produced ONE?
//      That's the case the user hit — agent called rewriteForPlatform once
//      (which makes 1 adapted post) when the operator wanted a 5-post set.
//
// The second check counts plural-intent signals in the user's message and
// the total runs/items produced by tools this turn. If signals say "many"
// and tools produced "one", we re-prompt the agent with explicit feedback
// before letting it write the final reply.
// ---------------------------------------------------------------------------

interface PluralIntent {
  /** Number of distinct outputs the operator implied, or null when not signalled. */
  expected: number | null;
  /** The phrase that triggered the inference (for error feedback). */
  signal: string | null;
}

const PLURAL_PHRASE_PATTERNS: Array<{ pattern: RegExp; days: number; signal: string }> = [
  { pattern: /\bevery\s+day\s+(?:for\s+)?(?:a|the|next)?\s*week\b/i, days: 7, signal: "every day for the week" },
  { pattern: /\bevery\s+weekday\b/i, days: 5, signal: "every weekday" },
  { pattern: /\b(?:mon[-\s]?fri|monday\s+(?:to|through|-)\s+friday)\b/i, days: 5, signal: "Mon-Fri" },
  { pattern: /\b(?:daily|each\s+day)\s+(?:for\s+)?(?:the\s+)?(?:next\s+)?week\b/i, days: 7, signal: "daily for the week" },
  { pattern: /\bone\s+per\s+day\s+(?:for\s+)?(?:the\s+)?(?:next\s+)?week\b/i, days: 7, signal: "one per day next week" },
  { pattern: /\b(?:both|all|each)\s+(?:platforms?|days?)\b/i, days: 2, signal: "both / all / each" },
];

function detectPluralIntent(userMessage: string): PluralIntent {
  // 1. Explicit phrase patterns
  for (const { pattern, days, signal } of PLURAL_PHRASE_PATTERNS) {
    if (pattern.test(userMessage)) return { expected: days, signal };
  }
  // 2. Numeric-N phrasing: "5 posts", "3 drafts", "create 7 of them"
  const numeric = userMessage.match(/\b(\d{1,2})\s+(?:posts?|drafts?|runs?|pieces?|articles?|tweets?|threads?)\b/i);
  if (numeric) {
    const n = Number(numeric[1]);
    if (n >= 2 && n <= 30) return { expected: n, signal: `${n} posts` };
  }
  // 3. Generic plural signal — "posts" / "drafts" / "campaigns" — implies >=2
  if (/\b(?:posts|drafts|campaigns)\b/i.test(userMessage) && !/\bone\s+(?:post|draft|campaign)\b/i.test(userMessage)) {
    return { expected: 2, signal: "plural (multiple posts implied)" };
  }
  return { expected: null, signal: null };
}

// Detect intent: did the operator ask to create a new piece of content?
// Used by the missing-platform guard below.
function isCreateContentIntent(userMessage: string): boolean {
  return /\b(?:make|create|write|draft|generate|produce|build|do)\s+(?:me\s+)?(?:a|an|the|some|another)?\s*(?:post|campaign|content|draft|piece|article|tweet|thread)/i.test(
    userMessage,
  );
}

// Detect whether the operator named a platform explicitly. We're permissive:
// any mention of a known platform name counts, even if it's possessive
// ("LinkedIn's audience") or part of a larger phrase ("for instagram").
function namesAPlatform(userMessage: string): boolean {
  return /\b(?:linkedin|twitter|x\.com|instagram|insta|ig|facebook|fb|threads|tiktok|youtube|bluesky|pinterest|reddit|vk)\b/i.test(
    userMessage,
  );
}

// Tools that produce content runs and therefore need an explicit platform.
const PIPELINE_TOOLS = new Set([
  "runPipeline",
  "runPipelineMulti",
  "rewriteForPlatform",
  "scheduleMultiDayCampaign",
]);

function countRunsProduced(toolCalls: ToolCallTrace[]): number {
  let count = 0;
  for (const t of toolCalls) {
    const out = t.output as { runs?: unknown[]; results?: unknown[]; runId?: string } | null | undefined;
    if (!out) continue;
    if (Array.isArray(out.runs)) count += out.runs.length;
    else if (Array.isArray(out.results)) count += out.results.length;
    else if (typeof out.runId === "string" && out.runId.length > 0) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Ralph loop — claim detection
//
// Returns true when the reply text reads like a confident assertion that
// the agent COMPLETED an action ("I scheduled it", "Done.", "I rewrote
// the post", "All set"). Used to gate the no-tool-call exit path so the
// agent can't lie about taking action. Intentionally biased toward
// past-tense, definitive claims — "I'll do X" / "I can do X" / "let me
// know when" should NOT trigger.
// ---------------------------------------------------------------------------

const COMPLETION_CLAIM_PATTERNS: RegExp[] = [
  // First-person past-tense action verbs
  /\bI\s+(?:just\s+|already\s+|'ve\s+|have\s+)?(?:created|made|built|scheduled|posted|published|approved|ran|rewrote|adapted|generated|drafted|queued|launched|kicked\s+off|fired\s+off|set\s+up|set\s+them?\s+up|wired\s+up)\b/i,
  // First-person past-tense with object: "I scheduled the posts"
  /\bI\s+(?:just\s+|already\s+)?(?:re-)?(?:scheduled|posted|approved|published|saved|stored|added|deleted|removed|disabled|enabled|updated)\s+(?:it|them|that|the|those|these)\b/i,
  // Definitive completion statements
  /\b(?:Done|All done|All set|All scheduled|Scheduled|Approved|Published|Created|Posted|Live now|It's live|It's done|It's scheduled|It's queued)\s*[.!—]/i,
  // "X has been Y" passive completion
  /\b(?:has|have)\s+been\s+(?:created|scheduled|posted|published|approved|adapted|rewritten|queued|saved|updated)\b/i,
];

function claimsCompletedAction(text: string): boolean {
  if (!text || text.length < 4) return false;
  return COMPLETION_CLAIM_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Prompt-block builders
// ---------------------------------------------------------------------------

/**
 * Read the operator's configured default platforms from social_config.
 * These are what askOperator should use as button options — never invent
 * platforms the operator hasn't enabled. Falls back to a small safe set
 * when config is missing.
 */
/**
 * Read the operator's active learning rules (universal + per-platform) so
 * Constance knows they exist and gets applied. We don't render every rule
 * into the prompt — the pipeline already injects the full rule block at
 * generation time (see bot/pipeline.ts:loadActiveLearnings). The agent just
 * needs a count + category breakdown to acknowledge them in conversation
 * ("I'll apply your 12 active rules") without restating them.
 */
function readActiveLearningsSummary(): { count: number; categories: string[] } {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(socialLearning)
      .where(eq(socialLearning.active, true))
      .orderBy(desc(socialLearning.last_reinforced_at))
      .limit(200)
      .all() as Array<{ category: string }>;
    const set = new Set<string>();
    for (const r of rows) set.add(r.category);
    return { count: rows.length, categories: Array.from(set).sort() };
  } catch {
    return { count: 0, categories: [] };
  }
}

function readDefaultPlatforms(): string[] {
  try {
    const db = getDb();
    const row = db
      .select()
      .from(socialConfig)
      .where(eq(socialConfig.key, "general"))
      .get() as { value: string } | undefined;
    if (!row) return ["linkedin"];
    const parsed = JSON.parse(row.value) as {
      default_platforms?: string[];
      platforms?: string[];
    };
    const list = parsed.default_platforms ?? parsed.platforms ?? [];
    return Array.isArray(list) && list.length > 0 ? list : ["linkedin"];
  } catch {
    return ["linkedin"];
  }
}

function buildPlatformPolicyBlock(defaults: string[]): string {
  const opts = defaults
    .map((p) => `      {"label":"${capitaliseLabel(p)}","value":"${p}"}`)
    .join(",\n");
  return `=== PLATFORM POLICY ===
The operator has configured these as their DEFAULT platforms: ${defaults.join(", ")}.

When you call askOperator for a platform choice, use exactly these as your options, in this order. Always include one extra option:
  {"label":"Other (specify)","value":"other"}

…so the operator can request a non-default platform if they want one. If they pick "other", reply asking which specific platform in plain text (one-off case, no buttons needed for the next turn).

Example askOperator JSON for this operator's setup:

{"tool":"askOperator","input":{"question":"Which platform?","options":[
${opts},
      {"label":"Other (specify)","value":"other"}
]}}

Never invent platforms the operator hasn't configured. Never present an option list with fewer than these defaults + the "other" escape hatch.
=== End platform policy ===`;
}

function capitaliseLabel(p: string): string {
  const map: Record<string, string> = {
    linkedin: "LinkedIn",
    twitter: "X / Twitter",
    x: "X / Twitter",
    instagram: "Instagram",
    facebook: "Facebook",
    threads: "Threads",
    tiktok: "TikTok",
    youtube: "YouTube",
    bluesky: "Bluesky",
    pinterest: "Pinterest",
    reddit: "Reddit",
    vk: "VK",
  };
  return map[p.toLowerCase()] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

function buildTodayBlock(now: Date): string {
  const longDate = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `Current date/time context (operator's local time):
  Today = ${longDate}
  Time  = ${time}
  ISO   = ${now.toISOString()}

When the operator says "tomorrow", "next week", "Friday", "this weekend", "in 2 days", etc., resolve relative to THIS date. Never assume your training data's "today".

When the operator uses a vague date ("next week", "this weekend", "soon", "later"), do NOT pick a specific day silently — call askOperator FIRST with a day picker:
  • "next week"   → ask Mon / Tue / Wed / Thu / Fri (Mon-Fri of the upcoming week, with the resolved date in each label like "Mon May 25")
  • "this weekend" → ask Saturday / Sunday (with dates)
  • "soon" / "later" → ask In 1 hour / This evening / Tomorrow morning / Tomorrow afternoon / Next Monday
When the operator says a SPECIFIC day ("Tuesday at 10am", "May 22"), resolve it and ACT — no clarification needed.`;
}

// Detects multi-day / repeating-content requests so the agent reaches for
// scheduleMultiDayCampaign instead of producing a single run.
const campaignDetectionRule = `=== CAMPAIGN DETECTION ===
When the operator asks for content across MULTIPLE days, you MUST produce one run per day, not a single post. Triggers:
  • "a post every day next week"          → 7 runs, one per weekday (Mon-Sun)
  • "a post every weekday"                → 5 runs (Mon-Fri)
  • "5 posts over the next week"          → 5 runs across the upcoming 7-day window
  • "daily for 3 days"                    → 3 runs on consecutive days
  • "every Tuesday for a month"           → 4 runs

Tool to use: \`scheduleMultiDayCampaign\` (preferred — handles labelling + scheduling in one call).
Fallback: call runPipeline N times in a loop ONLY if the topic differs meaningfully per day.

Each run's TOPIC should include the date so the operator can tell them apart:
  • Good:  "AI Trends — Mon May 25"
  • Bad:   "AI Trends" (then "AI Trends" again, then "AI Trends" again — operator can't tell which is which)

If unsure which days the operator means, askOperator with a day-picker (multi-select) listing the specific dates before launching the campaign.`;

// ---------------------------------------------------------------------------
// Tool-call parser — detects `{"tool": "...", "input": {...}}` in the model's
// reply. Tolerant: scans for the first top-level JSON object that has both
// `tool` and `input` fields, and where `tool` is a known tool name. Returns
// null if the reply is plain prose.
// ---------------------------------------------------------------------------

interface ParsedToolCall {
  name: string;
  input: unknown;
  tool: AgentToolset[string];
}

export function parseToolCall(reply: string, toolset: AgentToolset): ParsedToolCall | null {
  // Pull every top-level JSON object out of the reply, in order.
  const candidates = extractJsonObjects(reply);
  for (const c of candidates) {
    if (
      c &&
      typeof c === "object" &&
      "tool" in c &&
      "input" in c &&
      typeof (c as Record<string, unknown>).tool === "string"
    ) {
      const name = (c as Record<string, unknown>).tool as string;
      const tool = toolset[name];
      if (tool) {
        return { name, input: (c as Record<string, unknown>).input, tool };
      }
    }
  }
  return null;
}

function extractJsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const chunk = text.slice(start, i + 1);
        try {
          out.push(JSON.parse(chunk));
        } catch {
          // not valid JSON; ignore
        }
        start = -1;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function refusal(
  input: ChatInput,
  status: Exclude<ChatResultStatus, "ok">,
  reply: string,
  inboundEventId: string | null = null,
): ChatResult {
  // Persist the user attempt in a system conversation so the SOC sees the
  // refusal in context (not just a security_event row floating alone).
  let conversationId = "";
  let userMessageId: string | null = null;
  try {
    const conv = conversations.getOrCreateConversation(
      input.surface,
      input.surfaceRef,
    );
    conversationId = conv.id;
    const msg = messages.appendMessage({
      conversationId: conv.id,
      role: "user",
      content: input.userMessage,
    });
    userMessageId = msg.id;
    messages.appendMessage({
      conversationId: conv.id,
      role: "system",
      content: `[refusal:${status}] ${reply}`,
    });
  } catch {
    // Don't compound a refusal with a write failure — the security_event
    // already captures the inbound block.
  }
  let agentName = "Agent";
  try {
    agentName = profile.getProfile().name;
  } catch {
    // fall through with default
  }
  return {
    status,
    reply,
    conversationId,
    userMessageId,
    assistantMessageId: null,
    inboundEventId,
    outboundEventId: null,
    warnings: [],
    toolCalls: [],
    agentName,
    provider: null,
    requestedModel: "",
    providerAttempts: [],
    clarification: null,
  };
}

function collectInboundCategories(
  inbound: Awaited<ReturnType<typeof checkInbound>>,
): string[] {
  const cats = new Set<string>();
  for (const d of inbound.layer1.detections) cats.add(d.category);
  for (const c of inbound.layer2?.attack_categories ?? []) cats.add(c);
  return Array.from(cats);
}

/**
 * Fire-and-forget: extract facts + write embeddings. Errors are logged.
 * We do NOT await these — they run after the reply is returned.
 */
function scheduleBackground(userMessageId: string, assistantMessageId: string): void {
  setImmediate(() => {
    Promise.allSettled([
      extractor.extractFromMessage(userMessageId),
      extractor.extractFromMessage(assistantMessageId),
      embedWriter.embedMessage(userMessageId),
      embedWriter.embedMessage(assistantMessageId),
    ]).then((results) => {
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          console.error(
            `[agent.runtime] background task #${i} failed: ${r.reason?.message ?? r.reason}`,
          );
        }
      });
    });
  });
}
