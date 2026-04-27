/**
 * OpenAI image generation. Two auth paths:
 *
 *   1. Direct API key (OPENAI_API_KEY)  → POST /v1/images/generations
 *   2. Codex OAuth (~/.codex/auth.json) → POST /backend-api/codex/responses
 *      with model gpt-5.5 + image_generation tool, streamed SSE response.
 *
 * Codex OAuth path mirrors how OpenClaw's openai/image-generation-provider.ts
 * routes images when only ChatGPT login is configured: the user's subscription
 * carries the image quota — no extra API key required.
 *
 * Image model defaults to `gpt-image-2`; override per-call or per-deploy via
 * OPENAI_IMAGE_MODEL.
 */

import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OPENAI_IMAGES_ENDPOINT = 'https://api.openai.com/v1/images/generations';
const OPENAI_CODEX_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const CODEX_RESPONSES_MODEL = 'gpt-5.5';
const CODEX_IMAGE_INSTRUCTIONS = 'You are an image generation assistant.';
const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS) || 180_000;

type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9' | '4:3' | string;

function aspectToSize(aspectRatio?: AspectRatio): '1024x1024' | '1024x1536' | '1536x1024' {
  switch (aspectRatio) {
    case '4:5':
    case '9:16':
    case '2:3':
    case '3:4':
      return '1024x1536';
    case '16:9':
    case '4:3':
    case '21:9':
    case '3:2':
      return '1536x1024';
    default:
      return '1024x1024';
  }
}

export interface OpenAIImageInput {
  prompt: string;
  aspectRatio?: AspectRatio;
  saveToTempFile?: boolean;
  model?: string;
}

export interface OpenAIImageResult {
  url: string;
  size: string;
  model: string;
  base64: string;
  /** Which auth path produced the image. */
  authMode: 'api-key' | 'codex-oauth';
}

type AuthResolution =
  | { mode: 'api-key'; key: string }
  | { mode: 'codex-oauth'; key: string };

async function resolveAuth(): Promise<AuthResolution> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) return { mode: 'api-key', key: apiKey };
  try {
    const { getCodexApiKey } = await import('../auth/codex-oauth.js');
    const key = await getCodexApiKey();
    return { mode: 'codex-oauth', key };
  } catch (err) {
    throw new Error(
      `No OpenAI auth available — neither OPENAI_API_KEY in engine/.env nor a Codex OAuth login. ` +
        `Sign in with ChatGPT (run 'codex login') or set OPENAI_API_KEY. (${(err as Error).message})`,
    );
  }
}

async function persistOrEncode(
  base64: string,
  size: string,
  model: string,
  authMode: 'api-key' | 'codex-oauth',
  saveToTempFile: boolean | undefined,
): Promise<OpenAIImageResult> {
  if (saveToTempFile) {
    const dir = await mkdtemp(join(tmpdir(), 'openai-img-'));
    const path = join(dir, 'image.png');
    await writeFile(path, Buffer.from(base64, 'base64'));
    return { url: `file://${path}`, size, model, base64, authMode };
  }
  return { url: `data:image/png;base64,${base64}`, size, model, base64, authMode };
}

// ─── Direct API path ──────────────────────────────────────────────────────────

async function generateViaDirectApi(
  input: OpenAIImageInput,
  apiKey: string,
): Promise<OpenAIImageResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const size = aspectToSize(input.aspectRatio);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(OPENAI_IMAGES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, prompt: input.prompt, size, n: 1 }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI image API ${res.status}: ${errBody.slice(0, 400)}`);
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = json.data?.[0];
  if (!item) throw new Error('OpenAI image API returned no data');
  if (item.b64_json) {
    return persistOrEncode(item.b64_json, size, model, 'api-key', input.saveToTempFile);
  }
  if (item.url) return { url: item.url, size, model, base64: '', authMode: 'api-key' };
  throw new Error('OpenAI image API returned neither b64_json nor url');
}

// ─── Codex OAuth path (Responses API + image_generation tool) ────────────────

interface CodexImageEvent {
  type?: string;
  item?: { type?: string; result?: string; revised_prompt?: string };
  response?: { output?: Array<{ type?: string; result?: string }>; usage?: unknown };
  error?: { code?: string; message?: string };
  message?: string;
}

function parseSseEvents(body: string): CodexImageEvent[] {
  const events: CodexImageEvent[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;
    try {
      events.push(JSON.parse(data) as CodexImageEvent);
    } catch {
      // skip non-JSON keepalives
    }
  }
  return events;
}

async function generateViaCodexOAuth(
  input: OpenAIImageInput,
  bearer: string,
): Promise<OpenAIImageResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const size = aspectToSize(input.aspectRatio);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(OPENAI_CODEX_RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: CODEX_RESPONSES_MODEL,
        instructions: CODEX_IMAGE_INSTRUCTIONS,
        input: [{ role: 'user', content: [{ type: 'input_text', text: input.prompt }] }],
        tools: [{ type: 'image_generation', model, size }],
        tool_choice: { type: 'image_generation' },
        stream: true,
        store: false,
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Codex Responses API ${res.status}: ${errBody.slice(0, 400)}`);
  }

  const body = await res.text();
  const events = parseSseEvents(body);

  const failure = events.find((e) => e.type === 'response.failed' || e.type === 'error');
  if (failure) {
    const msg =
      failure.error?.message ??
      failure.message ??
      (failure.error?.code
        ? `Codex image generation failed (${failure.error.code})`
        : 'Codex image generation failed');
    throw new Error(msg);
  }

  // Prefer streamed output_item.done events, fall back to response.completed.
  let base64: string | undefined;
  for (const e of events) {
    if (
      e.type === 'response.output_item.done' &&
      e.item?.type === 'image_generation_call' &&
      typeof e.item.result === 'string' &&
      e.item.result.length > 0
    ) {
      base64 = e.item.result;
      break;
    }
  }
  if (!base64) {
    const completed = events.find((e) => e.type === 'response.completed');
    const out = completed?.response?.output ?? [];
    for (const entry of out) {
      if (entry.type === 'image_generation_call' && entry.result) {
        base64 = entry.result;
        break;
      }
    }
  }
  if (!base64) {
    throw new Error('Codex Responses API returned no image_generation_call result');
  }

  return persistOrEncode(base64, size, model, 'codex-oauth', input.saveToTempFile);
}

// ─── Public entry ─────────────────────────────────────────────────────────────

export async function generateImageOpenAI(
  input: OpenAIImageInput,
): Promise<OpenAIImageResult> {
  const auth = await resolveAuth();
  if (auth.mode === 'api-key') return generateViaDirectApi(input, auth.key);
  return generateViaCodexOAuth(input, auth.key);
}
