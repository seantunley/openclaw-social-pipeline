/**
 * webSearch tool — provider-agnostic web search for the agent.
 *
 * Selected via env var WEB_SEARCH_PROVIDER ('brave' | 'tavily', default 'brave').
 * Returns the top-N results with HTML stripped from snippets so a hostile
 * page can't smuggle prompt-injection HTML/script back into the LLM context.
 *
 * Per the original brief:
 *   - Brave Search default, Tavily alternative
 *   - HTML stripped before being fed back to the LLM
 *   - Rate-limited via the call governor (caller='agent.tool.webSearch')
 *
 * Failure modes are loud (no silent stubbing in prod): the tool throws with
 * the provider error + a remediation hint. Stub fallback only kicks in
 * when the relevant API key env var is unset — the result text says so
 * explicitly so the LLM doesn't pretend to have searched.
 */

import { z } from "zod";

export const webSearchSchema = z.object({
  query: z.string().min(2, "query must be at least 2 characters").max(400),
  topK: z.number().int().min(1).max(10).default(5),
});

export type WebSearchInput = z.infer<typeof webSearchSchema>;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  provider: "brave" | "tavily" | "stub";
  query: string;
  results: WebSearchResult[];
  /** When provider=stub: human-readable explanation of why no real search ran. */
  note?: string;
}

const DEFAULT_PROVIDER = (process.env.WEB_SEARCH_PROVIDER ?? "brave").toLowerCase();

/**
 * Execute a web search. Returns up to `topK` results with HTML-stripped
 * snippets. The function never throws on "no results" — it returns an empty
 * results array with the provider field set so the LLM can decide how to
 * proceed.
 */
export async function runWebSearch(input: WebSearchInput): Promise<WebSearchOutput> {
  const provider = DEFAULT_PROVIDER;
  if (provider === "tavily") return await tavilySearch(input);
  if (provider === "brave" || provider === "") return await braveSearch(input);
  // Unknown provider: surface the misconfig so it's not silently stubbed.
  throw new Error(
    `WEB_SEARCH_PROVIDER='${provider}' is not recognised. Use 'brave' or 'tavily'.`,
  );
}

// ---------------------------------------------------------------------------
// Brave Search
// ---------------------------------------------------------------------------

async function braveSearch(input: WebSearchInput): Promise<WebSearchOutput> {
  const key = process.env.BRAVE_SEARCH_API_KEY ?? "";
  if (!key) {
    return {
      provider: "stub",
      query: input.query,
      results: [],
      note:
        "Brave Search is not configured (BRAVE_SEARCH_API_KEY missing). " +
        "Get a free key at https://api-dashboard.search.brave.com/app/keys and set it in engine/.env, " +
        "or switch to Tavily by setting WEB_SEARCH_PROVIDER=tavily and TAVILY_API_KEY.",
    };
  }
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", input.query);
  url.searchParams.set("count", String(input.topK));
  url.searchParams.set("safesearch", "moderate");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Brave Search failed (${res.status}): ${body.slice(0, 300)}. ` +
        `Workaround: verify BRAVE_SEARCH_API_KEY, check quota at api-dashboard.search.brave.com, ` +
        `or switch to Tavily.`,
    );
  }
  const json = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  const raw = json.web?.results ?? [];
  const results: WebSearchResult[] = raw.slice(0, input.topK).map((r) => ({
    title: stripHtml(r.title ?? ""),
    url: r.url ?? "",
    snippet: stripHtml(r.description ?? ""),
  }));
  return { provider: "brave", query: input.query, results };
}

// ---------------------------------------------------------------------------
// Tavily
// ---------------------------------------------------------------------------

async function tavilySearch(input: WebSearchInput): Promise<WebSearchOutput> {
  const key = process.env.TAVILY_API_KEY ?? "";
  if (!key) {
    return {
      provider: "stub",
      query: input.query,
      results: [],
      note:
        "Tavily is not configured (TAVILY_API_KEY missing). " +
        "Get a free key at https://app.tavily.com/ and set it in engine/.env, " +
        "or switch to Brave by setting WEB_SEARCH_PROVIDER=brave and BRAVE_SEARCH_API_KEY.",
    };
  }
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query: input.query,
      max_results: input.topK,
      search_depth: "basic",
      include_answer: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Tavily Search failed (${res.status}): ${body.slice(0, 300)}. ` +
        `Workaround: verify TAVILY_API_KEY, check quota at app.tavily.com, ` +
        `or switch to Brave.`,
    );
  }
  const json = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const raw = json.results ?? [];
  const results: WebSearchResult[] = raw.slice(0, input.topK).map((r) => ({
    title: stripHtml(r.title ?? ""),
    url: r.url ?? "",
    snippet: stripHtml(r.content ?? ""),
  }));
  return { provider: "tavily", query: input.query, results };
}

// ---------------------------------------------------------------------------
// HTML stripping — defensive. Web search results can carry HTML that, if
// fed verbatim to the LLM, becomes a prompt-injection vector.
// ---------------------------------------------------------------------------

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
