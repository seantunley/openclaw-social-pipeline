import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, LogIn, LogOut, ExternalLink, Loader2 } from 'lucide-react';
import {
  fetchCodexAuthStatus,
  startCodexLoginFlow,
  pollCodexLoginFlow,
  logoutCodex,
} from '@/lib/api';

/**
 * "Sign in with ChatGPT" card. Drop into Settings or anywhere else.
 *
 * Flow:
 *  1. User clicks Sign in.
 *  2. Backend starts pi-ai's OAuth flow + spins up the localhost:1455 callback
 *     server. Returns the authorize URL.
 *  3. We open the URL in a new tab AND poll the flow status every 2 seconds.
 *  4. Once the user completes OAuth in the browser, the backend persists
 *     tokens to ~/.codex/auth.json and the flow flips to `completed`.
 *  5. We refresh the auth status and show the "signed in" state.
 */
export default function CodexAuthCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['codex-auth-status'],
    queryFn: fetchCodexAuthStatus,
    refetchInterval: 30_000,
  });

  const [flowId, setFlowId] = useState<string | null>(null);
  const [flowMessage, setFlowMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startSignIn = async () => {
    setBusy(true);
    setFlowMessage(null);
    try {
      const result = await startCodexLoginFlow();
      setFlowId(result.flowId);
      setFlowMessage('Browser tab opened. Complete sign-in there to finish.');
      window.open(result.url, '_blank', 'noopener,noreferrer');

      // Poll every 2s. Stop at completion / failure / 5 min timeout.
      const startedAt = Date.now();
      pollRef.current = setInterval(async () => {
        try {
          const status = await pollCodexLoginFlow(result.flowId);
          if (status.status === 'completed') {
            if (pollRef.current) clearInterval(pollRef.current);
            setFlowId(null);
            setFlowMessage('Signed in. Tokens saved to ~/.codex/auth.json.');
            queryClient.invalidateQueries({ queryKey: ['codex-auth-status'] });
            setBusy(false);
          } else if (status.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            setFlowId(null);
            setFlowMessage(`Sign-in failed: ${status.error ?? 'unknown error'}`);
            setBusy(false);
          } else if (Date.now() - startedAt > 5 * 60 * 1000) {
            if (pollRef.current) clearInterval(pollRef.current);
            setFlowId(null);
            setFlowMessage('Sign-in timed out (5 min). Try again.');
            setBusy(false);
          }
        } catch {
          // transient — keep polling
        }
      }, 2000);
    } catch (err) {
      setFlowMessage(`Could not start sign-in: ${(err as Error).message}`);
      setBusy(false);
    }
  };

  const cancelInProgress = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setFlowId(null);
    setFlowMessage('Cancelled. The browser tab can stay open if you still want to sign in.');
    setBusy(false);
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await logoutCodex();
      queryClient.invalidateQueries({ queryKey: ['codex-auth-status'] });
      setFlowMessage('Signed out. Tokens removed from disk.');
    } catch (err) {
      setFlowMessage(`Sign out failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const status = data;
  const authed = !!status?.authenticated && !status?.expired;
  const expiredButPresent = !!status?.authenticated && !!status?.expired;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted mt-0.5" />
          ) : authed ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5" />
          ) : expiredButPresent ? (
            <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-muted mt-0.5" />
          )}
          <div>
            <p className="text-sm font-medium text-secondaryText">
              OpenAI Codex (Sign in with ChatGPT)
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Authenticates the bot's `LLM_PROVIDER=openai-codex` mode against your ChatGPT
              Plus / Pro / Business subscription. Tokens land in <code className="text-muted">~/.codex/auth.json</code>{' '}
              — the same file the official Codex CLI uses.
            </p>
            <p className="mt-2 text-xs">
              Status:{' '}
              {isLoading ? (
                <span className="text-muted">Checking…</span>
              ) : authed ? (
                <span className="text-emerald-300 font-medium">Signed in</span>
              ) : expiredButPresent ? (
                <span className="text-amber-300 font-medium">
                  Expired — sign in again to refresh
                </span>
              ) : (
                <span className="text-muted font-medium">Not signed in</span>
              )}
              {status?.expiresAt && (
                <span className="text-muted ml-2">
                  (expires {new Date(status.expiresAt).toLocaleString()})
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {authed ? (
            <button
              onClick={signOut}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-medium disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          ) : flowId ? (
            <button
              onClick={cancelInProgress}
              className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-medium"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={startSignIn}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogIn className="h-3.5 w-3.5" />
              )}
              Sign in with ChatGPT
            </button>
          )}
        </div>
      </div>

      {flowId && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 text-xs text-indigo-200">
          <p className="font-medium">Sign-in started.</p>
          <p className="mt-1">
            If the browser tab didn't open automatically, the backend logged the URL — copy it from
            the engine logs and open it manually. Polling every 2 seconds for completion…
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-indigo-300/80">
            <ExternalLink className="h-3 w-3" />
            Once you finish in the browser, this card will switch to "Signed in" automatically.
          </p>
        </div>
      )}

      {flowMessage && !flowId && (
        <p className="text-xs text-muted">{flowMessage}</p>
      )}

      <div className="rounded-lg border border-border-strong bg-surface-faint p-3 text-[11px] text-muted leading-relaxed">
        <strong className="text-muted">Caveats:</strong> ChatGPT subscription rate limits are
        much lower than OpenAI Platform API limits. The{' '}
        <code className="text-muted">chatgpt.com/backend-api/codex</code> endpoints are
        undocumented and could change without notice. OpenAI's stance on third-party use of these
        tokens is "supportive but not formal" — known but unblessed. Use at your own risk.
      </div>
    </div>
  );
}
