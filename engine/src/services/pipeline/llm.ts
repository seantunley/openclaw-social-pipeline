/**
 * LLM abstraction layer with auto-fallback chain.
 *
 * Two public functions:
 *   - llmGenerate(): plain completion. Tries providers in order based on
 *       LLM_PROVIDER env var (preferred first), falling back to others on
 *       auth/billing failures so a dead Anthropic key doesn't kill the
 *       whole pipeline.
 *   - llmGenerateWithSearch(): research mode. Tries Anthropic with the
 *       server-side `web_search` tool first; if that fails (e.g. credits
 *       out), falls back to plain llmGenerate without search — research
 *       degrades to model knowledge rather than failing the run outright.
 *
 * **Failure mode:** if every provider fails, throws an `AllProvidersFailed`
 * error that lists each provider's specific error AND a workaround block
 * the dashboard can render verbatim. Per the project's no-silent-failure
 * rule, we never swallow earlier errors when falling through.
 */

import type Anthropic from '@anthropic-ai/sdk';

export interface LlmOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export type LlmProvider = 'anthropic' | 'openai-codex';

const ALL_PROVIDERS: LlmProvider[] = ['anthropic', 'openai-codex'];

/**
 * Resolve the provider chain from LLM_PROVIDER. The env-var value sits
 * first; the rest fill in as fallbacks in stable order.
 */
function getProviderChain(): LlmProvider[] {
  const raw = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase();
  const preferred: LlmProvider =
    raw === 'openai-codex' || raw === 'codex' ? 'openai-codex' : 'anthropic';
  const fallbacks = ALL_PROVIDERS.filter((p) => p !== preferred);
  return [preferred, ...fallbacks];
}

export interface LlmAttempt {
  provider: LlmProvider | 'anthropic-with-search';
  ok: boolean;
  error?: string;
  /** Best-guess remediation hint, surfaced when ok=false. */
  workaround?: string;
}

/**
 * Custom error thrown when every provider in the chain failed. Carries
 * each attempt so the route handler / dashboard can render a complete
 * picture of what was tried, why it failed, and what to do next.
 */
export class AllProvidersFailed extends Error {
  attempts: LlmAttempt[];
  constructor(attempts: LlmAttempt[]) {
    const lines = attempts.map(
      (a) => `  • ${a.provider}: ${a.error ?? 'unknown'}${a.workaround ? ` — ${a.workaround}` : ''}`,
    );
    super(
      `Every LLM provider failed:\n${lines.join('\n')}\n\nWorkarounds:\n  1. Top up Anthropic credits at https://console.anthropic.com/settings/billing\n  2. Sign in with ChatGPT in Settings → Authentication (uses Codex OAuth, no Anthropic key required)\n  3. Set LLM_PROVIDER=openai-codex in engine/.env and restart the API`,
    );
    this.name = 'AllProvidersFailed';
    this.attempts = attempts;
  }
}

// ---------------------------------------------------------------------------
// Provider availability checks — done once per call, cheap, no network.
// ---------------------------------------------------------------------------

function anthropicConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? '';
  return key.length > 0 && !key.startsWith('sk-ant-...');
}

async function codexConfigured(): Promise<boolean> {
  // Lazy-load so this stays cheap when not used.
  try {
    const { existsSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    return existsSync(join(homedir(), '.codex', 'auth.json'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// llmGenerate — tries provider chain, falls back on auth/billing errors
// ---------------------------------------------------------------------------

/**
 * Generate text. Walks the provider chain (preferred first per
 * LLM_PROVIDER) and returns the first successful response. On any
 * provider's auth/billing/network failure, falls through to the next.
 *
 * Throws `AllProvidersFailed` if every provider is unconfigured or
 * errors out.
 */
export async function llmGenerate(
  systemPrompt: string,
  userPrompt: string,
  options?: LlmOptions,
): Promise<string> {
  const result = await llmGenerateWithAttempts(systemPrompt, userPrompt, options);
  return result.text;
}

/**
 * Like `llmGenerate` but also returns the attempt log + winning provider.
 * Used by the pipeline so it can record which provider produced each
 * stage's output (visible in the dashboard's run-detail page).
 */
export async function llmGenerateWithAttempts(
  systemPrompt: string,
  userPrompt: string,
  options?: LlmOptions,
): Promise<{ text: string; provider: LlmProvider; attempts: LlmAttempt[] }> {
  const attempts: LlmAttempt[] = [];

  for (const provider of getProviderChain()) {
    // Skip a provider if it's not configured at all — record as unavailable
    // so the operator sees it in the attempt log without a noisy error.
    if (provider === 'anthropic' && !anthropicConfigured()) {
      attempts.push({
        provider,
        ok: false,
        error: 'ANTHROPIC_API_KEY not set',
        workaround: 'Set ANTHROPIC_API_KEY in engine/.env or sign in with ChatGPT to use Codex',
      });
      continue;
    }
    if (provider === 'openai-codex' && !(await codexConfigured())) {
      attempts.push({
        provider,
        ok: false,
        error: 'No Codex OAuth tokens found at ~/.codex/auth.json',
        workaround: 'Settings → Authentication → Sign in with ChatGPT',
      });
      continue;
    }

    try {
      const text =
        provider === 'anthropic'
          ? await llmGenerateAnthropic(systemPrompt, userPrompt, options)
          : await llmGenerateOpenAICodex(systemPrompt, userPrompt, options);
      attempts.push({ provider, ok: true });
      return { text, provider, attempts };
    } catch (err) {
      attempts.push({
        provider,
        ok: false,
        error: extractMessage(err),
        workaround: deriveWorkaround(provider, err),
      });
      // Fall through to next provider.
    }
  }

  throw new AllProvidersFailed(attempts);
}

// ---------------------------------------------------------------------------
// Anthropic provider
// ---------------------------------------------------------------------------

async function llmGenerateAnthropic(
  systemPrompt: string,
  userPrompt: string,
  options?: LlmOptions,
): Promise<string> {
  const {
    model = 'claude-sonnet-4-6',
    temperature = 0.7,
    maxTokens = 4096,
  } = options ?? {};

  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? '';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const texts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') texts.push(block.text);
  }

  if (texts.length === 0) throw new Error('Anthropic returned no text content');
  return texts.join('\n');
}

// ---------------------------------------------------------------------------
// OpenAI Codex provider — ChatGPT subscription via pi-ai
// ---------------------------------------------------------------------------

async function llmGenerateOpenAICodex(
  systemPrompt: string,
  userPrompt: string,
  options?: LlmOptions,
): Promise<string> {
  const modelId =
    options?.model ?? process.env.LLM_OPENAI_CODEX_MODEL ?? 'gpt-5.4';

  const [pi, { getCodexApiKey }] = await Promise.all([
    import('@mariozechner/pi-ai') as Promise<{
      complete: (model: unknown, context: unknown, options?: unknown) => Promise<{
        content: Array<{ type: string; text?: string }>;
      }>;
      getModel: (provider: string, modelId: string) => unknown;
    }>,
    import('../auth/codex-oauth.js'),
  ]);

  const apiKey = await getCodexApiKey();
  const model = pi.getModel('openai-codex', modelId);

  const response = await pi.complete(
    model,
    {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    },
    { apiKey },
  );

  const texts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    }
  }

  if (texts.length === 0) throw new Error('OpenAI Codex returned no text content');
  return texts.join('\n');
}

// ---------------------------------------------------------------------------
// Web-search research — Anthropic's server-side web_search tool, with
// graceful fallback to plain llmGenerate (no fresh sources) when it fails.
// ---------------------------------------------------------------------------

/**
 * Generate text with Claude's server-side `web_search` tool enabled.
 *
 * Anthropic runs the search loop server-side and returns the final answer.
 * If the request fails (credits out, key invalid, search disabled) we fall
 * back to plain `llmGenerate` — the model produces research notes from its
 * training rather than fresh sources, which is a degraded but useful mode.
 *
 * The pipeline is told via the returned `attempts` whether live search ran;
 * downstream stages can label the run accordingly.
 */
export async function llmGenerateWithSearch(
  systemPrompt: string,
  userPrompt: string,
  options?: { model?: string; maxTokens?: number; maxContinuations?: number },
): Promise<string> {
  const result = await llmGenerateWithSearchAndAttempts(systemPrompt, userPrompt, options);
  return result.text;
}

export async function llmGenerateWithSearchAndAttempts(
  systemPrompt: string,
  userPrompt: string,
  options?: { model?: string; maxTokens?: number; maxContinuations?: number },
): Promise<{ text: string; usedSearch: boolean; attempts: LlmAttempt[] }> {
  const attempts: LlmAttempt[] = [];

  // Try Anthropic with web_search first. Skip outright if no key — saves a
  // round-trip to find that out.
  if (anthropicConfigured()) {
    try {
      const text = await anthropicWebSearch(systemPrompt, userPrompt, options);
      attempts.push({ provider: 'anthropic-with-search', ok: true });
      return { text, usedSearch: true, attempts };
    } catch (err) {
      attempts.push({
        provider: 'anthropic-with-search',
        ok: false,
        error: extractMessage(err),
        workaround: deriveWorkaround('anthropic', err),
      });
      // Fall through.
    }
  } else {
    attempts.push({
      provider: 'anthropic-with-search',
      ok: false,
      error: 'ANTHROPIC_API_KEY not set — web_search requires Anthropic',
      workaround: 'Set ANTHROPIC_API_KEY for live research, or accept degraded research from model knowledge',
    });
  }

  // Fall back to plain llmGenerate — the chain there will try Codex if
  // Anthropic is broken too. Research without live search is degraded but
  // not useless; better than failing the run.
  const fallbackPrompt = `${systemPrompt}\n\n[NOTE: live web search is unavailable for this run. Produce research notes from your training data; flag any claims you can't substantiate.]`;
  const sub = await llmGenerateWithAttempts(fallbackPrompt, userPrompt, {
    model: options?.model,
    maxTokens: options?.maxTokens,
  });
  attempts.push(...sub.attempts);
  return { text: sub.text, usedSearch: false, attempts };
}

async function anthropicWebSearch(
  systemPrompt: string,
  userPrompt: string,
  options?: { model?: string; maxTokens?: number; maxContinuations?: number },
): Promise<string> {
  const {
    model = 'claude-opus-4-7',
    maxTokens = 4096,
    maxContinuations = 5,
  } = options ?? {};

  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? '';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userPrompt },
  ];

  let response: Anthropic.Message | undefined;

  for (let i = 0; i < maxContinuations; i++) {
    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    });

    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }

  if (!response) {
    throw new Error('Web-search research call returned no response');
  }

  const texts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') texts.push(block.text);
  }

  if (texts.length === 0) {
    throw new Error('Web-search research returned no text content');
  }

  return texts.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Error inspection helpers — turn raw provider errors into actionable hints.
// ---------------------------------------------------------------------------

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Pattern-match well-known provider failure modes to surface a workaround
 * the operator can act on. Conservative — fall back to "no specific
 * workaround" rather than guessing.
 */
function deriveWorkaround(provider: LlmProvider, err: unknown): string | undefined {
  const msg = extractMessage(err).toLowerCase();
  if (provider === 'anthropic') {
    if (msg.includes('credit balance') || msg.includes('billing')) {
      return 'Top up at https://console.anthropic.com/settings/billing or sign in with ChatGPT (Codex) in Settings';
    }
    if (msg.includes('401') || msg.includes('invalid api key') || msg.includes('authentication')) {
      return 'Check ANTHROPIC_API_KEY in engine/.env';
    }
    if (msg.includes('429') || msg.includes('rate limit')) {
      return 'Anthropic rate-limited — wait a moment and retry, or switch to Codex';
    }
  }
  if (provider === 'openai-codex') {
    if (msg.includes('401') || msg.includes('expired') || msg.includes('unauthorized')) {
      return 'Codex tokens expired — re-sign in via Settings → Authentication';
    }
    if (msg.includes('429') || msg.includes('rate limit')) {
      return 'ChatGPT subscription rate-limited — wait or upgrade tier';
    }
  }
  return undefined;
}
