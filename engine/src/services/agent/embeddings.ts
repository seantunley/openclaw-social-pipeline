/**
 * Embeddings — converts text into the 1536-dim float vector vec0 expects.
 *
 * Defaults to OpenAI's `text-embedding-3-small` (matches AGENT_EMBED_DIM
 * default of 1536). Falls back to a deterministic stub vector if no
 * OPENAI_API_KEY is configured — this keeps unit/integration tests from
 * needing network, while making the missing-key state obvious in logs.
 *
 * Failure mode is loud: when an embed call legitimately fails (auth, rate
 * limit, network), we throw with the provider error so the caller can
 * decide whether to retry. We do NOT swallow into a stub silently.
 * See [feedback_no_silent_failure.md].
 */

import { createHash } from "node:crypto";

const EMBED_DIM = Number(process.env.AGENT_EMBED_DIM ?? 1536);
const EMBED_MODEL =
  process.env.AGENT_EMBED_MODEL ?? "text-embedding-3-small";

export interface EmbedResult {
  vector: Float32Array;
  model: string;
  /** True if we returned a deterministic fallback (no API key). */
  stub: boolean;
}

/**
 * Embed a single string. Length is whatever AGENT_EMBED_DIM was at DB init.
 */
export async function embedText(text: string): Promise<EmbedResult> {
  if (!text.trim()) {
    return { vector: new Float32Array(EMBED_DIM), model: "empty", stub: true };
  }
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key) {
    // No key configured — return a deterministic hash-derived stub so tests
    // / dev work without network. Surface this so the operator knows.
    return { vector: stubVector(text), model: "stub", stub: true };
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
      dimensions: EMBED_DIM,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenAI embeddings request failed (${res.status}): ${body.slice(0, 400)}. ` +
        `Workaround: verify OPENAI_API_KEY, that the project has embedding-model access, ` +
        `or unset OPENAI_API_KEY to fall back to stub vectors (FTS-only memory recall).`,
    );
  }

  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const arr = json.data?.[0]?.embedding;
  if (!arr || arr.length !== EMBED_DIM) {
    throw new Error(
      `OpenAI embeddings returned unexpected shape: expected ${EMBED_DIM} dims, got ${arr?.length ?? 0}.`,
    );
  }
  return { vector: Float32Array.from(arr), model: EMBED_MODEL, stub: false };
}

/**
 * Embed a batch. We don't bother with OpenAI batch endpoint here — sequential
 * is fine for our throughput, and it keeps the error surfacing per-input
 * clean (no partial-failure shenanigans).
 */
export async function embedBatch(
  texts: string[],
): Promise<EmbedResult[]> {
  const out: EmbedResult[] = [];
  for (const t of texts) out.push(await embedText(t));
  return out;
}

/** Serialise a Float32Array for sqlite-vec storage (raw little-endian bytes). */
export function vectorToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/**
 * Deterministic stub vector. Hash the text into the requested number of
 * dimensions. Useful for tests and for dev mode without an API key — the
 * vectors won't be meaningful but vec0 will still accept them and you can
 * exercise the retrieval code paths.
 */
function stubVector(text: string): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  // Fill `v` with bytes from chained SHA-256 hashes seeded by `text`. Each
  // 32-byte hash gives 8 floats; loop until we have EMBED_DIM.
  let seed = text;
  let filled = 0;
  while (filled < EMBED_DIM) {
    const buf = createHash("sha256").update(seed).digest();
    for (let i = 0; i + 4 <= buf.length && filled < EMBED_DIM; i += 4) {
      // Map 4 bytes -> uint32 -> [-1,1] roughly.
      const u = buf.readUInt32LE(i);
      v[filled++] = (u / 0xffffffff) * 2 - 1;
    }
    seed = buf.toString("hex");
  }
  // L2-normalize so cosine ≈ dot product.
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

export function getEmbedDim(): number {
  return EMBED_DIM;
}
