/**
 * Slide-over chat drawer — redesigned. 520px wide, full-height panel with:
 *   - Persistent session ref across messages (one conversation per drawer open)
 *   - Avatar + name from agent_profile (operator's chosen emoji + name)
 *   - Suggested prompts when the conversation is empty
 *   - Tool-call inline badges with collapsible detail
 *   - Timestamps on each turn
 *   - Settings shortcut to /settings#agent
 *   - Conversation history dropdown
 *
 * Uses the non-streaming endpoint with a client-side typewriter animation so
 * we sidestep dev-proxy SSE buffering issues. The streaming endpoint is still
 * available via the `useStreaming` flag if you want it.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Send, ChevronDown, Wrench, MessageSquare, Settings, Plus, Sparkles, Loader2, Mic, MicOff, Square } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWhisper, type WhisperState } from '@/lib/useWhisper';
import { useLocale } from '@/lib/i18n';

interface Profile {
  id: string;
  name: string;
  system_prompt: string;
  default_model: string;
}

interface Conversation {
  id: string;
  surface: string;
  surface_ref: string;
  title: string;
  updated_at: string;
}

interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_calls: string;
  tool_name: string | null;
  tool_result: string;
  created_at: string;
}

interface ToolCallTrace {
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
}

interface Clarification {
  question: string;
  options: Array<{ label: string; value: string }>;
  multiSelect?: boolean;
  allowFreeText?: boolean;
}

const SUGGESTED_PROMPTS = [
  'Show me the most recent runs',
  'Draft a LinkedIn post about our latest learning',
  'Search the web for emerging trends in our space',
  'Approve and publish run XXX',
];

export default function ChatDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  // Drawer width — operator can drag the left edge to resize. Persisted
  // so subsequent opens use the same width.
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem('agent-drawer-width'));
      if (Number.isFinite(stored) && stored >= 380 && stored <= 900) return stored;
    } catch { /* ignore */ }
    return 540;
  });
  useEffect(() => {
    try {
      localStorage.setItem('agent-drawer-width', String(drawerWidth));
    } catch { /* ignore */ }
  }, [drawerWidth]);

  // Stable per-drawer session reference. Persisted to localStorage so the
  // session survives closing + reopening the drawer (and page reloads) —
  // the operator expects to land back in the same conversation they were
  // last in, not a fresh stub.
  const sessionRef = useRef<string>(
    (typeof localStorage !== 'undefined' && localStorage.getItem('agent-drawer-session')) ||
      `drawer-${Date.now().toString(36)}`,
  );
  useEffect(() => {
    try {
      localStorage.setItem('agent-drawer-session', sessionRef.current);
    } catch {
      // Storage might be disabled (incognito quirk); not fatal.
    }
  }, []);

  const profileQ = useQuery<{ profile: Profile } | null>({
    queryKey: ['agent-profile'],
    queryFn: async () => {
      const r = await fetch('/api/social/agent/profile');
      if (!r.ok) return null;
      return r.json();
    },
    enabled: open,
    retry: false,
  });
  const profileName = profileQ.data?.profile?.name ?? 'Agent';
  const { emoji, name: agentName } = splitEmoji(profileName);
  const model = profileQ.data?.profile?.default_model?.replace(/^anthropic\//, '') ?? '';

  const convQ = useQuery<{ items: Conversation[] }>({
    queryKey: ['agent-conversations-dashboard'],
    queryFn: async () => {
      const r = await fetch('/api/social/agent/conversations?surface=dashboard&limit=20');
      if (!r.ok) return { items: [] };
      return r.json();
    },
    enabled: open,
    retry: false,
  });

  // Active conversation ID — persisted so closing + reopening the drawer
  // lands you back where you were. localStorage read happens lazily through
  // the useState initialiser, so it only runs once.
  const [activeConvId, setActiveConvId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('agent-drawer-conv') || null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (activeConvId) localStorage.setItem('agent-drawer-conv', activeConvId);
      else localStorage.removeItem('agent-drawer-conv');
    } catch {
      // ignore
    }
  }, [activeConvId]);
  const [showHistory, setShowHistory] = useState(false);

  // Stop showing the history dropdown when active conversation switches.
  useEffect(() => {
    if (!open) setShowHistory(false);
  }, [open]);

  // When the drawer first opens (or re-opens), snap to the bottom so the
  // operator lands on the most-recent turn — not the top of the thread.
  // Otherwise opening a long conversation drops you at the first turn
  // (a year ago) and you have to scroll a screen-full to find the present.
  // Uses a microtask delay so the message list has rendered first.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      endRef.current?.scrollIntoView({ block: 'end' });
      userAtBottomRef.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, [open, activeConvId]);

  // Local Whisper speech-to-text — model downloads on first use, cached
  // forever, audio never leaves the browser. Maps the operator's UI locale
  // ('en' | 'fr' | 'ru') to Whisper's language hint.
  const { locale } = useLocale();
  const whisper = useWhisper({
    language: locale,
    onTranscript: (text) => {
      setInput((cur) => (cur ? `${cur.trim()} ${text}` : text));
      requestAnimationFrame(() => taRef.current?.focus());
    },
  });

  // Auto-pick a conversation on drawer open. Prefer the most-recent
  // conversation that actually has a TITLE — that means at least one
  // turn happened (the title is auto-generated from the first user
  // message). This skips empty 1-message stubs left behind by blocked
  // turns or aborted sends.
  useEffect(() => {
    if (!open) return;
    if (activeConvId) {
      // Verify the persisted activeConvId still exists in the list. If the
      // stored conversation has been archived/deleted server-side, fall
      // through to auto-pick.
      const stillExists = convQ.data?.items?.some((c) => c.id === activeConvId);
      if (stillExists !== false) return; // either exists or we don't know yet
    }
    const items = convQ.data?.items ?? [];
    const candidate = items.find((c) => c.title && c.title.trim().length > 0);
    if (candidate) {
      setActiveConvId(candidate.id);
    } else if (items[0]) {
      // No titled conversation; use the most-recent whatever it is.
      setActiveConvId(items[0].id);
    }
  }, [open, convQ.data, activeConvId]);

  const msgsQ = useQuery<{ items: PersistedMessage[] }>({
    queryKey: ['agent-messages', activeConvId],
    queryFn: async () => {
      if (!activeConvId) return { items: [] };
      const r = await fetch(`/api/social/agent/conversations/${activeConvId}/messages?limit=200`);
      if (!r.ok) return { items: [] };
      return r.json();
    },
    enabled: open && !!activeConvId,
    retry: false,
  });

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // Wall-clock when the current send started. We tick it every second so
  // the thinking pill can escalate its copy ("thinking" → "still working
  // — probably running a tool" → "Constance may be running a full pipeline,
  // check the Runs page"). Reset to null when sending finishes.
  const [sendStartedAt, setSendStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!sendStartedAt) {
      setElapsedSec(0);
      return;
    }
    setElapsedSec(Math.floor((Date.now() - sendStartedAt) / 1000));
    const t = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - sendStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [sendStartedAt]);
  // Structured error so we can render a retry button + actionable hint
  // instead of just dumping "Failed to fetch" on the user.
  const [error, setError] = useState<{ message: string; hint?: string; retryable: boolean } | null>(null);
  // Optimistic copy of the user's just-sent message so they see it in the
  // thread before msgsQ refetches at the end of the turn. Cleared when the
  // turn completes successfully. On failure we KEEP it visible so the
  // operator can retry without retyping.
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  // Last message text held in reserve so the operator can retry after a
  // failure — restored to the textarea via the Retry button, or kept in
  // pendingUserMessage display.
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  // Typewriter state for the in-flight assistant reply.
  const [typing, setTyping] = useState<{
    fullText: string;
    typedChars: number;
    tools: ToolCallTrace[];
    provider: string | null;
    requestedModel: string;
    clarification?: Clarification | null;
  } | null>(null);
  // Sticky clarification at the bottom of the thread when the most recent
  // assistant turn asked for a structured choice. Cleared when the operator
  // taps a button (sends a new message) or types a fresh prompt.
  const [pendingClarification, setPendingClarification] = useState<Clarification | null>(null);
  // For multiSelect questions, accumulate the operator's picks before they
  // click "Send selection".
  const [pickedValues, setPickedValues] = useState<Set<string>>(new Set());
  // Provider of the last completed turn — drawn in the header subtitle so
  // the operator can see at a glance whether the reply came from Anthropic
  // or via Codex/ChatGPT, regardless of which model their PREFERENCE is set to.
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Track whether the user has manually scrolled up from the bottom. We
  // sample this on every scroll event (cheap, just one number). The
  // autoscroll layout-effect uses THIS ref instead of measuring the
  // post-render DOM — that way the "is the user at the bottom?" decision
  // reflects intent (where they were looking) instead of the post-update
  // scrollHeight, which is always inflated when new content was just added.
  const userAtBottomRef = useRef(true);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const distance =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      userAtBottomRef.current = distance < 120;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  // Autoscroll on any change that adds content to the thread bottom. Uses
  // useLayoutEffect so the scroll fires in the same frame as the new
  // content (no flash), and forces scroll when the operator has just
  // submitted (we always want them to see their own message).
  useLayoutEffect(() => {
    const end = endRef.current;
    const container = scrollRef.current;
    if (!end || !container) return;
    // If they just hit send / a reply is arriving, snap to bottom regardless
    // of where they were — that's the "I want to see my conversation" intent.
    // Otherwise only auto-scroll if they were already at/near the bottom.
    const forceScroll = !!pendingUserMessage || sending || !!typing;
    if (forceScroll || userAtBottomRef.current) {
      end.scrollIntoView({ block: 'end' });
      // Reset the flag — after a forced scroll, we ARE at the bottom.
      userAtBottomRef.current = true;
    }
  }, [
    msgsQ.data,
    typing?.typedChars,
    typing?.tools.length,
    sending,
    error,
    pendingUserMessage,
  ]);

  // Typewriter tick — advances `typedChars` every 12ms until the whole reply
  // is on screen. Runs on the client so we don't depend on SSE plumbing.
  useEffect(() => {
    if (!typing) return;
    if (typing.typedChars >= typing.fullText.length) return;
    const timer = setTimeout(() => {
      setTyping((t) =>
        t && t.typedChars < t.fullText.length
          ? { ...t, typedChars: Math.min(t.fullText.length, t.typedChars + 4) }
          : t,
      );
    }, 12);
    return () => clearTimeout(timer);
  }, [typing]);

  // Auto-focus the textarea when the drawer opens.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => taRef.current?.focus());
    }
  }, [open]);

  async function sendMessage(prompt?: string) {
    const text = (prompt ?? input).trim();
    if (!text || sending) return;
    setInput('');
    setError(null);
    setSending(true);
    setSendStartedAt(Date.now());
    setPendingUserMessage(text);
    setLastFailedMessage(null);
    // Sending a new message clears any pinned clarification — the operator
    // has answered (or chosen to ignore the buttons and type freely).
    setPendingClarification(null);
    setPickedValues(new Set());
    // Don't create the typing bubble yet — it would render empty until the
    // response arrives, and an empty AssistantBubble shows "(empty reply)".
    // The "thinking…" pill below covers the wait.
    setTyping(null);

    let succeeded = false;
    try {
      // Two distinct fields:
      //   - conversationId: when resuming an existing conversation, the server
      //     appends to THAT one regardless of session ref.
      //   - surfaceRef: stable per-drawer-open id; when there's no active
      //     conversation yet, the server creates one keyed on this.
      const r = await fetch('/api/social/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          surfaceRef: sessionRef.current,
          conversationId: activeConvId ?? undefined,
        }),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        setError(translateHttpError(r.status, detail));
        setLastFailedMessage(text);
        return;
      }
      const data = (await r.json()) as {
        status: 'ok' | 'blocked' | 'killed' | 'llm_failed';
        reply: string;
        conversationId: string;
        toolCalls?: ToolCallTrace[];
        warnings?: string[];
        provider?: string | null;
        requestedModel?: string;
        providerAttempts?: Array<{ provider: string; ok: boolean; error?: string }>;
        clarification?: Clarification | null;
      };

      if (data.status !== 'ok') {
        setError({
          message: data.reply,
          hint:
            data.status === 'blocked'
              ? 'The defense layer flagged this message. See Operations → Live Events for the verdict.'
              : data.status === 'killed'
                ? 'The agent is suspended. Re-enable it in Operations → Settings.'
                : 'The agent failed to produce a reply. Try again or rephrase.',
          retryable: data.status !== 'blocked',
        });
        setLastFailedMessage(text);
        setTyping(null);
        return;
      }
      if (data.conversationId && data.conversationId !== activeConvId) {
        setActiveConvId(data.conversationId);
      }
      // Surface any recall warnings inline (only if non-empty + non-noisy).
      if (data.warnings && data.warnings.length > 0) {
        const noisy = data.warnings.every((w) => w.includes('OPENAI_API_KEY'));
        if (!noisy) {
          setError({ message: data.warnings.join('\n'), retryable: false });
        }
      }
      setLastProvider(data.provider ?? null);
      setTyping({
        fullText: data.reply,
        typedChars: 0,
        tools: data.toolCalls ?? [],
        provider: data.provider ?? null,
        requestedModel: data.requestedModel ?? '',
        clarification: data.clarification ?? null,
      });
      // Pin the clarification at the bottom of the thread so it stays
      // interactive across re-renders even after the typing buffer clears.
      setPendingClarification(data.clarification ?? null);
      setPickedValues(new Set());
      succeeded = true;
    } catch (err) {
      setError(translateNetworkError(err as Error));
      setLastFailedMessage(text);
      setTyping(null);
    } finally {
      setSending(false);
      setSendStartedAt(null);
      // Only clear the optimistic bubble on SUCCESS. On failure we leave it
      // visible so the operator can see what they tried to send, and the
      // Retry button below the error puts it back in the textarea.
      if (succeeded) setPendingUserMessage(null);
      qc.invalidateQueries({ queryKey: ['agent-messages'] });
      qc.invalidateQueries({ queryKey: ['agent-conversations-dashboard'] });
    }
  }

  function retryLastMessage() {
    if (!lastFailedMessage) return;
    const text = lastFailedMessage;
    setLastFailedMessage(null);
    setPendingUserMessage(null);
    setError(null);
    void sendMessage(text);
  }

  function restoreToInput() {
    if (!lastFailedMessage) return;
    setInput(lastFailedMessage);
    setLastFailedMessage(null);
    setPendingUserMessage(null);
    setError(null);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  // When typewriter finishes, the new turn appears in msgsQ (already invalidated)
  // and we can clear the typing buffer.
  useEffect(() => {
    if (typing && typing.typedChars >= typing.fullText.length && typing.fullText.length > 0) {
      const t = setTimeout(() => setTyping(null), 300);
      return () => clearTimeout(t);
    }
  }, [typing]);

  // Resize: drag the left handle to widen / narrow. Clamped to 380–900px.
  // Uses pointer events for parity across mouse + touch + pen.
  const resizingRef = useRef(false);
  function onResizeStart(e: React.PointerEvent) {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'ew-resize';
    const handlePointerMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return;
      // Drawer is anchored to the right edge; width grows as the pointer
      // moves left. Account for the 16px outer margin.
      const width = Math.max(380, Math.min(900, window.innerWidth - ev.clientX - 16));
      setDrawerWidth(width);
    };
    const handlePointerUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function newConversation() {
    sessionRef.current = `drawer-${Date.now().toString(36)}`;
    try {
      localStorage.setItem('agent-drawer-session', sessionRef.current);
    } catch {
      // ignore
    }
    setActiveConvId(null);
    setShowHistory(false);
    setTyping(null);
    setError(null);
    setPendingUserMessage(null);
    setLastFailedMessage(null);
  }

  // Walk the message list once to build the visible view:
  //   - Drop role='system' rows from the visible list…
  //   - …but BEFORE dropping each one, check whether it's a "[refusal:*]"
  //     marker. If so, annotate the most-recent user message with the
  //     refusal reason so the bubble can render a "blocked" / "refused"
  //     badge instead of looking identical to a successful send.
  const visibleMessages = useMemo(() => {
    const items = msgsQ.data?.items ?? [];
    const out: Array<PersistedMessage & { refusal?: string }> = [];
    for (const m of items) {
      if (m.role === 'system') {
        const match = m.content.match(/^\[refusal:([^\]]+)\]\s*(.*)$/);
        if (match && out.length > 0) {
          const last = out[out.length - 1];
          if (last.role === 'user') {
            last.refusal = `${match[1]}: ${match[2]}`.trim();
          }
        }
        continue;
      }
      out.push(m);
    }
    return out;
  }, [msgsQ.data]);

  if (!open) return null;

  return (
    <>
      {/* Dimmer */}
      <div
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close chat"
      />

      {/* Panel — floating with rounded corners, sits off the right edge with
          a 16px margin top/bottom/right so it visibly hovers over the page.
          Backdrop-blur + slight translucency give a modern glass feel.
          Width is operator-controlled via the left-edge resize handle. */}
      <aside
        className="fixed right-4 top-4 bottom-4 z-50 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-card/95 backdrop-blur-md shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6),0_0_0_1px_rgba(125,211,240,0.06)] ring-1 ring-brand-cyan/5"
        role="dialog"
        aria-label={`Chat with ${agentName}`}
        style={{ width: `${drawerWidth}px` }}
      >
        {/* Resize handle — full-height bar on the left edge. Hover state
            shows a brand-cyan accent. Pointer events drag-to-resize. */}
        <div
          onPointerDown={onResizeStart}
          className="absolute left-0 top-0 bottom-0 z-10 w-1.5 cursor-ew-resize group flex items-center justify-center"
          aria-label="Resize chat drawer"
          role="separator"
        >
          <span className="h-12 w-1 rounded-full bg-white/5 group-hover:bg-brand-cyan/50 transition-colors" />
        </div>
        {/* Header */}
        <header className="border-b border-white/5 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-cyan/30 to-brand-purple/30 border border-brand-cyan/30 text-lg shadow-inner">
                {emoji ?? '🤖'}
              </div>
              <div className="min-w-0">
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="flex items-center gap-1 text-sm font-semibold text-primaryText hover:text-brand-cyan transition-colors"
                >
                  <span className="truncate max-w-[260px]">{agentName}</span>
                  <ChevronDown
                    className={`h-3 w-3 text-muted transition-transform ${showHistory ? 'rotate-180' : ''}`}
                  />
                </button>
                <p className="text-[10px] uppercase tracking-widest text-muted flex items-center gap-1.5">
                  <span>{model || 'agent'}</span>
                  {lastProvider && (
                    <>
                      <span className="text-faint">·</span>
                      <span
                        title={
                          lastProvider === 'anthropic'
                            ? 'Last reply came from Anthropic (your Anthropic API key).'
                            : 'Last reply came from Codex (your ChatGPT Plus / OAuth).'
                        }
                        className={
                          lastProvider === 'anthropic'
                            ? 'text-orange-400'
                            : lastProvider === 'openai-codex'
                              ? 'text-emerald-400'
                              : 'text-muted'
                        }
                      >
                        via {lastProvider === 'openai-codex' ? 'ChatGPT' : 'Claude'}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={newConversation}
                title="New conversation"
                className="rounded-md p-1.5 text-muted hover:text-primaryText hover:bg-surface-soft transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
              <Link
                to="/settings"
                onClick={onClose}
                title="Agent settings"
                className="rounded-md p-1.5 text-muted hover:text-primaryText hover:bg-surface-soft transition-colors"
              >
                <Settings className="h-4 w-4" />
              </Link>
              <button
                onClick={onClose}
                title="Close"
                className="rounded-md p-1.5 text-muted hover:text-primaryText hover:bg-surface-soft transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Conversation history dropdown */}
          {showHistory && (
            <div className="mt-3 rounded-lg border border-border-strong bg-surface-faint max-h-56 overflow-y-auto">
              {(convQ.data?.items ?? []).length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted">No conversations yet.</p>
              ) : (
                <ul className="divide-y divide-border-strong">
                  {(convQ.data?.items ?? []).map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => {
                          setActiveConvId(c.id);
                          setShowHistory(false);
                          setTyping(null);
                          setError(null);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                          c.id === activeConvId
                            ? 'bg-surface-soft text-primaryText'
                            : 'text-secondaryText hover:bg-surface-soft'
                        }`}
                      >
                        <p className="truncate font-medium">{c.title || '(untitled)'}</p>
                        <p className="text-[10px] text-muted mt-0.5">{relativeTime(c.updated_at)}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </header>

        {/* Context strip — today's date so Constance + the operator share
            the same temporal frame. Helps the operator avoid ambiguous
            scheduling requests ("next week" → which day?), and reminds
            the agent what "today" / "tomorrow" actually resolve to. */}
        <ContextStrip />

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {visibleMessages.length === 0 && !typing && (
            <EmptyState
              agentName={agentName}
              onPromptClick={(p) => sendMessage(p)}
            />
          )}

          {visibleMessages.map((m) => (
            <MessageBubble
              key={m.id}
              m={m}
              agentName={agentName}
              emoji={emoji}
              refusal={m.refusal}
            />
          ))}

          {/* Optimistic user-message bubble during the wait, so the operator
              can see what they sent while the agent is thinking. Stays
              visible after a failure (faded) so they have context for the
              Retry / Edit & resend buttons in the error block below. */}
          {pendingUserMessage && (
            <div className="flex flex-col items-end">
              <div
                className={`max-w-[88%] rounded-2xl rounded-br-sm bg-gradient-to-br from-brand-purple/25 to-brand-pink/15 border border-brand-purple/30 px-3.5 py-2 text-sm text-primaryText whitespace-pre-wrap ${
                  error ? 'opacity-60' : ''
                }`}
              >
                {pendingUserMessage}
              </div>
              <p className="mt-1 mr-1 text-[10px] text-muted">
                {error
                  ? 'failed — retry below'
                  : sending
                    ? 'sending…'
                    : 'sent'}
              </p>
            </div>
          )}

          {typing && (
            <>
              {typing.tools.map((t, i) => (
                <ToolBadge key={`live-${i}`} call={t} startOpen={false} />
              ))}
              <AssistantBubble
                emoji={emoji}
                agentName={agentName}
                content={typing.fullText.slice(0, typing.typedChars)}
                stillTyping={typing.typedChars < typing.fullText.length}
                footer={
                  typing.provider && typing.typedChars >= typing.fullText.length ? (
                    <ProviderBadge provider={typing.provider} requestedModel={typing.requestedModel} />
                  ) : null
                }
              />
            </>
          )}

          {sending && !typing && (
            <ThinkingPill emoji={emoji} agentName={agentName} elapsedSec={elapsedSec} />
          )}

          {/* Pinned clarification: buttons the operator can tap to answer
              the most recent agent question without typing. Click sends the
              value as the next user message. */}
          {pendingClarification && !sending && (
            <ClarificationButtons
              clarification={pendingClarification}
              picked={pickedValues}
              onTogglePicked={(value) =>
                setPickedValues((cur) => {
                  const next = new Set(cur);
                  if (next.has(value)) next.delete(value);
                  else next.add(value);
                  return next;
                })
              }
              onSend={(value) => {
                setPendingClarification(null);
                setPickedValues(new Set());
                void sendMessage(value);
              }}
            />
          )}

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 space-y-1.5">
              <p className="text-xs font-medium text-red-300">{error.message}</p>
              {error.hint && (
                <p className="text-[11px] text-red-300/70 whitespace-pre-wrap">{error.hint}</p>
              )}
              {error.retryable && lastFailedMessage && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={retryLastMessage}
                    className="rounded-md bg-red-500/20 border border-red-500/40 px-2.5 py-1 text-[11px] text-red-200 hover:bg-red-500/30 transition-colors"
                  >
                    Retry
                  </button>
                  <button
                    onClick={restoreToInput}
                    className="rounded-md border border-border-strong bg-surface-faint px-2.5 py-1 text-[11px] text-secondaryText hover:bg-surface-soft transition-colors"
                  >
                    Edit & resend
                  </button>
                  <button
                    onClick={() => {
                      setError(null);
                      setLastFailedMessage(null);
                      setPendingUserMessage(null);
                    }}
                    className="rounded-md border border-border-strong bg-surface-faint px-2.5 py-1 text-[11px] text-muted hover:bg-surface-soft transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Sentinel for autoscroll — empty div the layout-effect targets. */}
          <div ref={endRef} aria-hidden="true" />
        </div>

        {/* Input */}
        <form
          className="border-t border-border-strong p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
        >
          <div className="rounded-xl border border-border-strong bg-surface-faint focus-within:border-brand-cyan/60 focus-within:ring-1 focus-within:ring-brand-cyan/30 transition-all">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={`Message ${agentName}…    (Enter to send · Shift+Enter for newline)`}
              rows={2}
              disabled={sending}
              className="w-full resize-none bg-transparent px-3 py-2.5 text-sm text-secondaryText placeholder:text-muted focus:outline-none disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <MicStatusBlurb state={whisper.state} sending={sending} />
              <div className="flex items-center gap-1.5">
                <MicButton state={whisper.state} onToggle={() => void whisper.toggle()} onCancel={whisper.cancel} disabled={sending} />
                <button
                  type="submit"
                  disabled={!input.trim() || sending}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-cyan to-brand-purple px-3 py-1.5 text-xs font-medium text-white shadow disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-md transition-shadow"
                >
                  {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {sending ? 'Sending' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </form>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function EmptyState({
  agentName,
  onPromptClick,
}: {
  agentName: string;
  onPromptClick: (p: string) => void;
}) {
  return (
    <div className="pt-6 text-center space-y-4">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-cyan/20 to-brand-purple/20 border border-brand-cyan/30">
        <Sparkles className="h-5 w-5 text-brand-cyan" />
      </div>
      <div>
        <p className="text-sm font-semibold text-primaryText">Say hi to {agentName}</p>
        <p className="text-xs text-muted mt-1">
          They know your preferences, recent runs, and can use tools.
        </p>
      </div>
      <div className="space-y-1.5 max-w-[400px] mx-auto pt-2">
        <p className="text-[10px] uppercase tracking-widest text-muted text-left px-1">
          Suggested
        </p>
        {SUGGESTED_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPromptClick(p)}
            className="block w-full text-left rounded-lg border border-border-strong bg-surface-faint px-3 py-2 text-xs text-secondaryText hover:bg-surface-soft hover:border-brand-cyan/40 hover:text-primaryText transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContextStrip() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const weekday = now.toLocaleDateString(undefined, { weekday: 'long' });
  const date = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-white/[0.02] text-[10px]">
      <span className="text-muted">Today</span>
      <span className="text-secondaryText">
        <span className="text-primaryText font-medium">{weekday}</span> · {date}
      </span>
      <span className="text-faint">·</span>
      <span className="text-secondaryText font-mono">{time}</span>
    </div>
  );
}

function ClarificationButtons({
  clarification,
  picked,
  onTogglePicked,
  onSend,
}: {
  clarification: Clarification;
  picked: Set<string>;
  onTogglePicked: (value: string) => void;
  onSend: (value: string) => void;
}) {
  // Unified multi-select UI — every question accepts one OR several picks.
  // Tap to toggle; "Send selection" sends the chosen values as a single
  // message (joined with " and " for >1 values). Operators who only want
  // one value just tap one pill, then Send.
  return (
    <div className="ml-9 rounded-2xl rounded-tl-sm border border-brand-cyan/40 bg-brand-cyan/5 p-3">
      <p className="text-xs text-secondaryText mb-2.5 leading-relaxed">
        {clarification.question}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {clarification.options.map((opt) => {
          const isPicked = picked.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onTogglePicked(opt.value)}
              className={
                isPicked
                  ? 'rounded-full bg-brand-cyan/30 border border-brand-cyan text-primaryText px-3 py-1 text-xs font-medium'
                  : 'rounded-full border border-border-strong bg-surface-faint text-secondaryText px-3 py-1 text-xs hover:bg-surface-soft hover:border-brand-cyan/40 hover:text-primaryText transition-colors'
              }
            >
              <span
                className={
                  isPicked
                    ? 'mr-1.5 inline-block h-2 w-2 rounded-full bg-brand-cyan align-middle'
                    : 'mr-1.5 inline-block h-2 w-2 rounded-full border border-border-strong align-middle'
                }
              />
              {opt.label}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[10px] text-muted">
          {picked.size === 0
            ? 'Pick one or more, then send.'
            : `${picked.size} selected`}
        </p>
        <button
          type="button"
          disabled={picked.size === 0}
          onClick={() => onSend(Array.from(picked).join(' and '))}
          className="rounded-md bg-gradient-to-r from-brand-cyan to-brand-purple px-3 py-1 text-xs font-medium text-white disabled:opacity-30 hover:shadow transition-shadow"
        >
          Send selection
        </button>
      </div>
      {clarification.allowFreeText && (
        <p className="mt-2 text-[10px] text-muted">…or type your own answer below.</p>
      )}
    </div>
  );
}

function ThinkingPill({
  emoji,
  agentName,
  elapsedSec,
}: {
  emoji: string | undefined;
  agentName: string;
  elapsedSec: number;
}) {
  // Progressive copy. Re-evaluated every second via the parent's
  // `elapsedSec` tick. Thresholds chosen so the operator gets meaningful
  // signal without being told "still working" within a couple seconds.
  let subtitle = 'thinking…';
  let extraHint: React.ReactNode = null;
  if (elapsedSec >= 60) {
    subtitle = `still working · ${elapsedSec}s`;
    extraHint = (
      <p className="mt-2 text-[10px] text-muted leading-relaxed">
        This is taking a while — Constance may be running a full pipeline
        (research → draft → image, typically 30–90s). You can wait, or open
        the{' '}
        <Link to="/runs" className="text-brand-cyan hover:underline">
          Runs page
        </Link>{' '}
        for live progress.
      </p>
    );
  } else if (elapsedSec >= 15) {
    subtitle = `still working · ${elapsedSec}s`;
    extraHint = (
      <p className="mt-2 text-[10px] text-muted">
        Probably running a tool — webSearch, runPipeline, etc.
      </p>
    );
  } else if (elapsedSec >= 4) {
    subtitle = `thinking · ${elapsedSec}s`;
  }
  return (
    <div className="flex gap-2">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-cyan/30 to-brand-purple/30 border border-brand-cyan/30 text-sm mt-0.5">
        {emoji ?? '🤖'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-[11px] font-semibold text-primaryText">{agentName}</span>
          <span className="text-[10px] text-muted">{subtitle}</span>
        </div>
        <div className="inline-flex items-center gap-1 rounded-2xl rounded-tl-sm bg-surface-soft border border-border-strong px-3.5 py-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-cyan animate-thinking-dot" style={{ animationDelay: '0ms' }} />
          <span className="h-1.5 w-1.5 rounded-full bg-brand-cyan animate-thinking-dot" style={{ animationDelay: '160ms' }} />
          <span className="h-1.5 w-1.5 rounded-full bg-brand-cyan animate-thinking-dot" style={{ animationDelay: '320ms' }} />
        </div>
        {extraHint}
      </div>
    </div>
  );
}

function MessageBubble({
  m,
  agentName,
  emoji,
  refusal,
}: {
  m: PersistedMessage;
  agentName: string;
  emoji: string | undefined;
  refusal?: string;
}) {
  if (m.role === 'tool') {
    return (
      <ToolBadge
        call={{
          name: m.tool_name ?? 'tool',
          input: null,
          output: safeJson(m.tool_result) ?? m.content,
          durationMs: 0,
        }}
        startOpen={false}
      />
    );
  }
  if (m.role === 'user') {
    const blocked = !!refusal;
    return (
      <div className="flex flex-col items-end">
        <div
          className={
            blocked
              ? 'max-w-[88%] rounded-2xl rounded-br-sm bg-red-500/10 border border-red-500/40 px-3.5 py-2 text-sm text-primaryText whitespace-pre-wrap opacity-80'
              : 'max-w-[88%] rounded-2xl rounded-br-sm bg-gradient-to-br from-brand-purple/25 to-brand-pink/15 border border-brand-purple/30 px-3.5 py-2 text-sm text-primaryText whitespace-pre-wrap'
          }
        >
          {m.content}
        </div>
        <p className="mt-1 mr-1 text-[10px]">
          {blocked ? (
            <span className="text-red-300">
              blocked by defense · {shortTime(m.created_at)}
              <span className="ml-1 text-muted">({refusal!.slice(0, 80)})</span>
            </span>
          ) : (
            <span className="text-muted">{shortTime(m.created_at)}</span>
          )}
        </p>
      </div>
    );
  }
  // Assistant
  const calls = safeJson<Array<{ name: string; input: unknown }>>(m.tool_calls) ?? [];
  return (
    <AssistantBubble
      emoji={emoji}
      agentName={agentName}
      content={m.content}
      timestamp={m.created_at}
      footer={
        calls.length > 0 ? (
          <p className="mt-1 text-[10px] text-muted">
            Used: {calls.map((c) => c.name).join(', ')}
          </p>
        ) : null
      }
    />
  );
}

function AssistantBubble({
  emoji,
  agentName,
  content,
  timestamp,
  stillTyping,
  footer,
}: {
  emoji: string | undefined;
  agentName: string;
  content: string;
  timestamp?: string;
  stillTyping?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-cyan/30 to-brand-purple/30 border border-brand-cyan/30 text-sm mt-0.5">
        {emoji ?? '🤖'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-[11px] font-semibold text-primaryText">{agentName}</span>
          {timestamp && (
            <span className="text-[10px] text-muted">{shortTime(timestamp)}</span>
          )}
        </div>
        <div className="rounded-2xl rounded-tl-sm bg-surface-soft border border-border-strong px-3.5 py-2 text-sm text-secondaryText whitespace-pre-wrap">
          {content ? (
            <LinkifyRunIds text={content} />
          ) : stillTyping ? (
            ''
          ) : (
            <span className="text-muted italic">…the model returned no text. Try again or rephrase.</span>
          )}
          {stillTyping && <span className="ml-0.5 animate-pulse text-brand-cyan">▍</span>}
        </div>
        {footer}
      </div>
    </div>
  );
}

// Match the readable run-id format produced by `generateReadableRunId` in
// engine/src/bot/pipeline.ts:
//   <platform>-<YYYYMMDD>-<HHMM>-<slug>-<4chars>
// e.g. linkedin-20260519-1212-ai-and-the-latest-trends-a77t
const RUN_ID_RE = /\b([a-z]+-\d{8}-\d{4}-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-[a-z0-9]{4})\b/g;

function LinkifyRunIds({ text }: { text: string }) {
  // Split text on the run-id pattern and render each match as a Link to
  // the Runs detail page, while preserving all surrounding text + newlines
  // (the parent uses whitespace-pre-wrap so \n still renders).
  const parts: Array<{ kind: 'text' | 'run'; value: string }> = [];
  let lastIndex = 0;
  RUN_ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN_ID_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ kind: 'text', value: text.slice(lastIndex, m.index) });
    }
    parts.push({ kind: 'run', value: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ kind: 'text', value: text.slice(lastIndex) });
  }
  if (parts.length === 1 && parts[0].kind === 'text') return <>{parts[0].value}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'run' ? (
          <Link
            key={i}
            to={`/runs/${p.value}`}
            className="font-mono text-brand-cyan underline decoration-dotted underline-offset-2 hover:decoration-solid"
            title="Open this run"
          >
            {p.value}
          </Link>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}

function ProviderBadge({
  provider,
  requestedModel,
}: {
  provider: string;
  requestedModel: string;
}) {
  const isCodex = provider === 'openai-codex';
  const isAnthropic = provider === 'anthropic';
  const label = isCodex ? 'ChatGPT' : isAnthropic ? 'Claude' : provider;
  const requested = requestedModel.replace(/^anthropic\//, '');
  const requestedIsAnthropic = requested.startsWith('claude');
  // Show a "you asked for X, got Y" hint when the chain fell through.
  const mismatched =
    (isCodex && requestedIsAnthropic) || (isAnthropic && !requestedIsAnthropic);
  return (
    <p className="mt-1 text-[10px] text-muted">
      via{' '}
      <span
        className={
          isAnthropic
            ? 'text-orange-400'
            : isCodex
              ? 'text-emerald-400'
              : 'text-muted'
        }
      >
        {label}
      </span>
      {mismatched && requested && (
        <span className="ml-1 text-faint">
          (you asked for <span className="text-secondaryText">{requested}</span>; chain fell through)
        </span>
      )}
    </p>
  );
}

function ToolBadge({ call, startOpen }: { call: ToolCallTrace; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const inputSummary = call.input ? truncate(JSON.stringify(call.input), 80) : '';
  return (
    <div className="ml-9 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-amber-200 hover:text-amber-100"
      >
        <Wrench className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">
          <span className="font-semibold">{call.name}</span>
          {inputSummary && <span className="text-amber-300/70">({inputSummary})</span>}
        </span>
        {call.durationMs > 0 && (
          <span className="ml-auto flex-shrink-0 text-[10px] text-muted">{call.durationMs}ms</span>
        )}
        <ChevronDown
          className={`h-3 w-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <pre className="mx-2 mb-2 max-h-56 overflow-auto rounded bg-black/30 p-2 text-[11px] text-secondaryText whitespace-pre-wrap">
          {call.output === undefined
            ? '(running…)'
            : typeof call.output === 'string'
              ? call.output
              : safeStringify(call.output)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mic UI — button + status blurb. Reflects every state of the useWhisper
// hook so the operator knows whether the model is downloading, recording,
// transcribing, etc.
// ---------------------------------------------------------------------------

function MicButton({
  state,
  onToggle,
  onCancel,
  disabled,
}: {
  state: WhisperState;
  onToggle: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  if (state.kind === 'recording') {
    // Show a stop-square; click stops recording and starts transcription.
    return (
      <button
        type="button"
        onClick={onToggle}
        title="Stop recording"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30 transition-colors"
      >
        <Square className="h-3 w-3 fill-current" />
      </button>
    );
  }
  if (state.kind === 'loading' || state.kind === 'transcribing' || state.kind === 'permission') {
    return (
      <button
        type="button"
        onClick={onCancel}
        title="Cancel"
        className="flex h-7 w-7 items-center justify-center rounded-full border border-border-strong bg-surface-faint text-muted"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </button>
    );
  }
  if (state.kind === 'error') {
    return (
      <button
        type="button"
        onClick={onToggle}
        title={state.message}
        disabled={disabled}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
      >
        <MicOff className="h-3 w-3" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Voice input — speech-to-text runs locally in your browser"
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-border-strong bg-surface-faint text-secondaryText hover:bg-surface-soft hover:text-primaryText disabled:opacity-40 transition-colors"
    >
      <Mic className="h-3 w-3" />
    </button>
  );
}

function MicStatusBlurb({ state, sending }: { state: WhisperState; sending: boolean }) {
  const [showDetails, setShowDetails] = useState(false);
  if (sending) {
    return <p className="text-[10px] text-muted px-1">Working…</p>;
  }
  if (state.kind === 'recording') {
    const elapsed = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    return (
      <p className="flex items-center gap-1.5 text-[10px] text-red-300 px-1">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
        Recording… {elapsed > 0 ? `${elapsed}s` : ''}
      </p>
    );
  }
  if (state.kind === 'permission') {
    return <p className="text-[10px] text-muted px-1">Asking for mic permission…</p>;
  }
  if (state.kind === 'loading') {
    return (
      <p className="text-[10px] text-muted px-1">
        Loading speech model… {Math.round(state.progress * 100)}% (one-time download)
      </p>
    );
  }
  if (state.kind === 'transcribing') {
    return <p className="text-[10px] text-muted px-1">Transcribing locally…</p>;
  }
  if (state.kind === 'error') {
    const d = state.diagnostics;
    return (
      <div className="flex-1 min-w-0 px-1">
        <p className="text-[10px] text-red-300 whitespace-pre-wrap leading-relaxed">{state.message}</p>
        {d && (
          <>
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="mt-1 text-[10px] text-muted underline decoration-dotted hover:text-secondaryText"
            >
              {showDetails ? 'Hide' : 'Show'} technical details
            </button>
            {showDetails && (
              <pre className="mt-1 rounded bg-black/30 p-2 text-[10px] text-secondaryText whitespace-pre-wrap break-all">
                {`error.name      = ${d.errorName ?? '—'}\n` +
                  `error.message   = ${d.rawMessage ?? '—'}\n` +
                  `permission API  = ${d.permissionState ?? '—'}\n` +
                  `secure context  = ${d.secureContext ?? '—'}\n` +
                  `origin          = ${d.origin ?? '—'}`}
              </pre>
            )}
          </>
        )}
      </div>
    );
  }
  return (
    <p className="text-[10px] text-muted px-1">
      Tools: webSearch, runPipeline, listRuns, approve, publish · 🎙 voice = local
    </p>
  );
}

// ---------------------------------------------------------------------------
// Error translation — turn raw browser / HTTP errors into something the
// operator can act on. We refuse to surface "Failed to fetch" verbatim.
// ---------------------------------------------------------------------------

function translateNetworkError(err: Error): {
  message: string;
  hint: string;
  retryable: boolean;
} {
  const raw = err.message || String(err);
  // Chrome / Firefox / Safari all surface "Failed to fetch" / "Load failed"
  // / "NetworkError when attempting to fetch resource." for offline / dead
  // server / aborted-during-flight. We can't distinguish them client-side,
  // so the best we can do is name the most-likely cause.
  const isFetchAbort = /failed to fetch|load failed|networkerror|fetch is aborted/i.test(raw);
  if (isFetchAbort) {
    return {
      message: "Couldn't reach the engine API.",
      hint:
        'The engine process may have stopped, restarted mid-request, or your network dropped.\n' +
        '• Check the `npm run start:api` terminal is still running.\n' +
        '• Try again — most transient drops succeed on retry.\n' +
        '• If the API restarted, the new build should be ready now; click Retry.',
      retryable: true,
    };
  }
  if (/abort/i.test(raw)) {
    return {
      message: 'Request was cancelled.',
      hint: 'The previous send was aborted. Click Retry to send it again.',
      retryable: true,
    };
  }
  return {
    message: raw,
    hint: 'An unexpected error occurred. Retry, or open the browser DevTools console for details.',
    retryable: true,
  };
}

function translateHttpError(
  status: number,
  detail: string,
): { message: string; hint: string; retryable: boolean } {
  if (status === 404) {
    return {
      message: 'Chat endpoint not found (404).',
      hint:
        'The engine API is running but doesn\'t have the agent routes registered. ' +
        'Restart it: stop the `npm run start:api` process and run it again.',
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      message: `Engine API error (${status}).`,
      hint:
        'The engine returned a 5xx. Check the API terminal for the stack trace. ' +
        'Most 5xx are transient — Retry usually works.',
      retryable: true,
    };
  }
  if (status === 401 || status === 403) {
    return {
      message: `Unauthorized (${status}).`,
      hint: 'The engine refused this request. Check authentication settings.',
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      message: 'Rate-limited (429).',
      hint:
        'The call governor capped this request. Raise the spend / volume cap in Operations → Settings, ' +
        'or wait for the window to roll.',
      retryable: true,
    };
  }
  return {
    message: `HTTP ${status}: ${detail.slice(0, 200) || 'no detail in response body'}`,
    hint: 'Open the browser Network tab for the full response, or retry.',
    retryable: true,
  };
}

function splitEmoji(name: string): { emoji: string | undefined; name: string } {
  const m = name.match(/^(\p{Extended_Pictographic})\s+(.*)$/u);
  if (m) return { emoji: m[1], name: m[2] };
  return { emoji: undefined, name };
}

function safeJson<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function shortTime(iso: string): string {
  return iso.slice(11, 16);
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
