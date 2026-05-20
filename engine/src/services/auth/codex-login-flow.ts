/**
 * Backend orchestrator for the "Sign in with ChatGPT" OAuth flow.
 *
 * The dashboard's Settings page calls `startCodexLogin()` → we begin the
 * pi-ai OAuth flow (PKCE, callback server on localhost:1455), capture the
 * authorize URL via the `onAuth` callback, and return that URL to the
 * dashboard. The dashboard opens the URL in a new tab; the user signs in;
 * pi-ai's callback server receives the code, exchanges for tokens, and the
 * promise resolves. We then persist the tokens to ~/.codex/auth.json so
 * the existing `getCodexApiKey` helper picks them up automatically.
 *
 * Flows live in an in-memory map keyed by `flowId`. They self-clean after
 * 10 minutes — no zombie callback servers.
 */

import { writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const CODEX_AUTH_PATH =
  process.env.CODEX_AUTH_PATH ?? join(homedir(), '.codex', 'auth.json');

// Identifier sent to OpenAI in the OAuth `originator` parameter. Public.
const OAUTH_ORIGINATOR = 'openclaw-social-pipeline';

interface OAuthCredentials {
  refresh: string;
  access: string;
  expires: number;
  [key: string]: unknown;
}

type FlowStatus = 'pending' | 'completed' | 'failed';

interface Flow {
  id: string;
  status: FlowStatus;
  url: string | null;
  error: string | null;
  startedAt: number;
}

const FLOWS = new Map<string, Flow>();
const FLOW_TTL_MS = 10 * 60 * 1000;

// TLS-cert errors surface here when Node/OpenSSL can't validate the chain to
// auth.openai.com — typically Homebrew Node missing the ca-certificates
// postinstall step. We detect this *before* starting OAuth so the user sees a
// fixable error instead of a generic fetch failure mid-flow.
const TLS_CERT_ERROR_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);
const TLS_CERT_ERROR_PATTERNS = [
  /unable to get local issuer certificate/i,
  /unable to verify the first certificate/i,
  /self[- ]signed certificate/i,
  /certificate has expired/i,
];
const OPENAI_AUTH_PROBE_URL =
  'https://auth.openai.com/oauth/authorize?response_type=code&client_id=openclaw-preflight&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid+profile+email';

async function preflightOpenAIAuth(timeoutMs = 5000): Promise<void> {
  try {
    await fetch(OPENAI_AUTH_PROBE_URL, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const root = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
    const cause = root?.cause && typeof root.cause === 'object'
      ? (root.cause as Record<string, unknown>)
      : null;
    const code = typeof cause?.code === 'string' ? cause.code : undefined;
    const message =
      (typeof cause?.message === 'string' && cause.message) ||
      (typeof root?.message === 'string' && root.message) ||
      String(err);
    const isTlsCert =
      (code && TLS_CERT_ERROR_CODES.has(code)) ||
      TLS_CERT_ERROR_PATTERNS.some((pat) => pat.test(message));
    if (isTlsCert) {
      throw new Error(
        `Node cannot validate TLS certificates against auth.openai.com${code ? ` (${code})` : ''}. ` +
          'Fix: on Homebrew Node, run `brew postinstall ca-certificates && brew postinstall openssl@3`, then retry.',
      );
    }
    throw new Error(
      `Network preflight to auth.openai.com failed before starting OAuth: ${message}. ` +
        'Check DNS, firewall, or HTTPS_PROXY/HTTP_PROXY settings.',
    );
  }
}

function rewriteCodexOAuthError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/unsupported_country_region_territory/i.test(message)) {
    return new Error(
      'OpenAI rejected the token exchange for this country/region/network route. ' +
        'If you use a proxy, set HTTPS_PROXY/HTTP_PROXY/ALL_PROXY for this process and retry.',
    );
  }
  if (/state mismatch|missing authorization code/i.test(message)) {
    return new Error(
      `OAuth callback validation failed (${message}). The browser callback was malformed or arrived after the flow was reset — retry sign-in.`,
    );
  }
  return err instanceof Error ? err : new Error(message);
}

function reapStaleFlows(): void {
  const cutoff = Date.now() - FLOW_TTL_MS;
  for (const [id, flow] of FLOWS) {
    if (flow.startedAt < cutoff) FLOWS.delete(id);
  }
}

async function persistCredsToCodexFile(creds: OAuthCredentials): Promise<void> {
  const dir = join(homedir(), '.codex');
  // mkdir -p (idempotent)
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });

  // Write in the nested-tokens shape Codex CLI uses today.
  const body = JSON.stringify(
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
  await writeFile(CODEX_AUTH_PATH, body, 'utf-8');
}

/**
 * Begin a new login flow. Returns immediately with `{ flowId, url }` so the
 * dashboard can open the URL in a new tab. The flow continues asynchronously
 * — poll `getFlowStatus(flowId)` to see if it completed.
 */
export async function startCodexLogin(): Promise<{ flowId: string; url: string }> {
  reapStaleFlows();

  // Catch fixable TLS/network issues before we spin up a callback server and
  // hand a dead URL to the dashboard.
  await preflightOpenAIAuth();

  const flowId = randomUUID();
  const flow: Flow = {
    id: flowId,
    status: 'pending',
    url: null,
    error: null,
    startedAt: Date.now(),
  };
  FLOWS.set(flowId, flow);

  // Resolve once the URL is known so the caller can return it to the client.
  let resolveUrl!: (u: string) => void;
  const urlReady = new Promise<string>((resolve) => {
    resolveUrl = resolve;
  });

  // Fire the actual login in the background. `loginOpenAICodex` returns a
  // promise that resolves with credentials once the user completes OAuth.
  void (async () => {
    try {
      const oauth = (await import('@earendil-works/pi-ai/oauth')) as {
        loginOpenAICodex(callbacks: {
          onAuth(info: { url: string; instructions?: string }): void;
          onPrompt(prompt: { message: string }): Promise<string>;
          onProgress?(message: string): void;
          onManualCodeInput?(): Promise<string>;
          originator?: string;
        }): Promise<OAuthCredentials>;
      };

      const creds = await oauth.loginOpenAICodex({
        originator: OAUTH_ORIGINATOR,
        onAuth: (info) => {
          flow.url = info.url;
          resolveUrl(info.url);
        },
        onProgress: (msg) => {
          // Surfaced for debugging; visible in API logs alongside flowId.
          console.log(`[codex-oauth ${flowId}] ${msg}`);
        },
        onPrompt: async () => {
          // We don't expose manual code entry from the dashboard — fail fast
          // if the local callback path doesn't work. The user can fall back
          // to running `codex login` directly in that case.
          throw new Error(
            'Manual code entry not supported from dashboard. Run `codex login` from a terminal if the callback fails.',
          );
        },
      });

      await persistCredsToCodexFile(creds);
      flow.status = 'completed';
    } catch (err) {
      flow.status = 'failed';
      flow.error = rewriteCodexOAuthError(err).message;
      // Make sure we don't hang the URL promise if onAuth was never called.
      if (!flow.url) resolveUrl('');
    }
  })();

  // Wait briefly for the URL to be produced (typical: a few hundred ms).
  // If pi-ai doesn't surface a URL within 5s, treat it as a failure.
  const url = await Promise.race([
    urlReady,
    new Promise<string>((resolve) =>
      setTimeout(() => resolve(''), 5000),
    ),
  ]);

  if (!url) {
    flow.status = 'failed';
    flow.error = flow.error ?? 'pi-ai login did not surface an auth URL within 5s';
    throw new Error(flow.error);
  }

  return { flowId, url };
}

export function getFlowStatus(flowId: string): {
  status: FlowStatus | 'not_found';
  url: string | null;
  error: string | null;
} {
  reapStaleFlows();
  const flow = FLOWS.get(flowId);
  if (!flow) return { status: 'not_found', url: null, error: null };
  return { status: flow.status, url: flow.url, error: flow.error };
}

export interface AuthStatus {
  authenticated: boolean;
  authPath: string;
  expiresAt: string | null;
  expired: boolean;
}

/**
 * Inspect the on-disk credentials and report whether we have a usable token.
 */
export async function getCurrentAuthStatus(): Promise<AuthStatus> {
  const base: AuthStatus = {
    authenticated: false,
    authPath: CODEX_AUTH_PATH,
    expiresAt: null,
    expired: false,
  };

  if (!existsSync(CODEX_AUTH_PATH)) return base;

  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(CODEX_AUTH_PATH, 'utf-8');
    const data = JSON.parse(raw) as {
      tokens?: { access_token?: string };
      access_token?: string;
      expires_at?: string | number;
    };
    const access = data.tokens?.access_token ?? data.access_token;
    if (!access) return base;

    let expiresAt: string | null = null;
    let expired = false;
    if (data.expires_at !== undefined) {
      const d =
        typeof data.expires_at === 'number'
          ? new Date(data.expires_at)
          : new Date(data.expires_at);
      if (!Number.isNaN(d.getTime())) {
        expiresAt = d.toISOString();
        expired = d.getTime() < Date.now();
      }
    }

    return {
      authenticated: true,
      authPath: CODEX_AUTH_PATH,
      expiresAt,
      expired,
    };
  } catch {
    return base;
  }
}

/**
 * Remove the on-disk credentials. The next API call that needs Codex OAuth
 * will fail until the user signs in again.
 */
export async function clearCodexAuth(): Promise<void> {
  if (existsSync(CODEX_AUTH_PATH)) {
    await unlink(CODEX_AUTH_PATH);
  }
}
