/**
 * Bridge between OpenAI Codex CLI's on-disk credentials and the unified
 * pi-ai OAuth helpers.
 *
 * The user must have `codex login` (OpenAI's official Codex CLI) installed
 * and authenticated against their ChatGPT Plus/Pro/Business account on the
 * same machine the bot runs on. We read the credentials Codex CLI wrote to
 * `~/.codex/auth.json`, hand them to pi-ai for refresh-on-demand, and return
 * the resulting access token. Refreshed credentials are persisted back to
 * the same file so Codex CLI keeps working alongside the bot.
 *
 * Caveats:
 *  - This rides your ChatGPT subscription quota, not OpenAI Platform credits.
 *    Subscription rate limits are dramatically lower than API limits.
 *  - The /v1/messages endpoints used here (chatgpt.com/backend-api/codex)
 *    are not part of OpenAI's documented public API. They could change or
 *    be disabled at any time.
 *  - OpenAI's stance on third-party tool use of this auth path is
 *    "supportive but not formal" — known but unblessed.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// pi-ai is ESM-only; consumed via dynamic import inside the async path so this
// module loads cleanly under both CJS (compiled engine) and ESM contexts.
// The type below mirrors pi-ai's exported OAuthCredentials shape — duplicated
// here to avoid the CJS/ESM type-only-import friction.
interface OAuthCredentials {
  refresh: string;
  access: string;
  expires: number;
  [key: string]: unknown;
}

const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH ?? join(homedir(), '.codex', 'auth.json');
const PROVIDER_ID = 'openai-codex';

/**
 * Shape of `~/.codex/auth.json`. The Codex CLI has shipped two variants in
 * the wild — flat (`access_token` at the root) and nested (`tokens.access_token`).
 * We accept both.
 */
interface CodexAuthFile {
  access_token?: string;
  refresh_token?: string;
  expires_at?: string | number;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
  };
  auth_mode?: string;
  last_refresh?: string;
}

function parseCodexAuthFile(raw: string): OAuthCredentials | null {
  let data: CodexAuthFile;
  try {
    data = JSON.parse(raw) as CodexAuthFile;
  } catch {
    return null;
  }

  const access = data.tokens?.access_token ?? data.access_token;
  const refresh = data.tokens?.refresh_token ?? data.refresh_token;
  if (!access || !refresh) return null;

  // expires_at may be ISO 8601 or epoch milliseconds. If absent or unparsable
  // we set expires=0 to force pi-ai to refresh on first use.
  let expires = 0;
  const raw_exp = data.expires_at;
  if (typeof raw_exp === 'number') {
    expires = raw_exp;
  } else if (typeof raw_exp === 'string') {
    const parsed = Date.parse(raw_exp);
    if (!Number.isNaN(parsed)) expires = parsed;
  }

  return { access, refresh, expires };
}

function serializeCodexAuthFile(creds: OAuthCredentials): string {
  // Write back in the nested shape Codex CLI uses today. If the user had the
  // flat shape we still produce the nested one — Codex CLI will accept it.
  return JSON.stringify(
    {
      tokens: {
        access_token: creds.access,
        refresh_token: creds.refresh,
      },
      expires_at: new Date(creds.expires).toISOString(),
      last_refresh: new Date().toISOString(),
    },
    null,
    2,
  );
}

/**
 * Read credentials, refresh if needed, persist back, return the bearer
 * access token to use as the API key in subsequent pi-ai calls.
 */
export async function getCodexApiKey(): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(CODEX_AUTH_PATH, 'utf-8');
  } catch {
    throw new Error(
      `Codex credentials not found at ${CODEX_AUTH_PATH}. ` +
        `Install OpenAI's Codex CLI (npm i -g @openai/codex) and run 'codex login' first.`,
    );
  }

  const creds = parseCodexAuthFile(raw);
  if (!creds) {
    throw new Error(
      `Could not parse ${CODEX_AUTH_PATH} — neither flat nor nested token shape recognised.`,
    );
  }

  const oauth = (await import('@mariozechner/pi-ai/oauth')) as {
    getOAuthApiKey(
      providerId: string,
      credentials: Record<string, OAuthCredentials>,
    ): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null>;
  };

  const result = await oauth.getOAuthApiKey(PROVIDER_ID, { [PROVIDER_ID]: creds });
  if (!result) {
    throw new Error('pi-ai returned no credentials for openai-codex.');
  }

  // Persist refreshed credentials only if they actually changed, so we don't
  // race with Codex CLI on a no-op write.
  const refreshed = result.newCredentials;
  if (refreshed.access !== creds.access || refreshed.refresh !== creds.refresh) {
    try {
      await writeFile(CODEX_AUTH_PATH, serializeCodexAuthFile(refreshed), 'utf-8');
    } catch (err) {
      // Non-fatal: we still have a valid in-memory token for this run.
      // Next run will refresh again from the un-updated file.
      console.warn(
        `[codex-oauth] failed to persist refreshed token to ${CODEX_AUTH_PATH}:`,
        (err as Error).message,
      );
    }
  }

  return result.apiKey;
}
