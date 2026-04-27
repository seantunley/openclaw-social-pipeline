import { useState, useMemo, useRef, useEffect } from 'react';
import { useT } from '@/lib/i18n';
import {
  PLATFORMS_ORDERED,
  getPlatformSpec,
  type PlatformId,
  type PlatformSpec,
} from '@/lib/platforms';
import { cn } from '@/lib/utils';
import { startRun, scheduleRun } from '@/lib/api';
import {
  Calendar,
  Send,
  Sparkles,
  AlertTriangle,
  Image as ImageIcon,
  Video,
  Smile,
  AtSign,
  Hash,
  Plus,
  Loader2,
  X,
} from 'lucide-react';
import Toast, { type ToastKind } from '@/components/Toast';
import ScheduleModal from '@/components/ScheduleModal';
import LiveRunPanel from '@/components/LiveRunPanel';

/**
 * Post Composer.
 *
 * Multi-platform composer modeled on Postiz's split view: a Global tab
 * holds the canonical text, per-platform tabs let you override for each
 * channel (with that platform's char limit + format constraints visible
 * inline). Live preview pane on the right.
 *
 * The "Post Now" / "Schedule" buttons are wired to no-op handlers for
 * now — once the publish API is plumbed through, swap the handlers.
 */

type Tab = 'global' | PlatformId;

interface PerPlatformState {
  body: string;
  /** Whether this platform inherits from Global. */
  override: boolean;
}

const ALL_PLATFORMS: PlatformId[] = PLATFORMS_ORDERED.map((p) => p.id);

// Compact emoji palette. Avoid an emoji-picker dep — most operators only
// reach for ten or twenty common ones.
const EMOJI_PALETTE = [
  '🎯', '🚀', '✨', '💡', '🔥', '📊', '💪', '⚡',
  '🎉', '👀', '🤝', '✅', '⭐', '📈', '🧠', '💬',
  '❤️', '👋', '🙌', '🎬', '🎨', '📸', '📍', '🌍',
];

export default function Composer() {
  const t = useT();
  const [active, setActive] = useState<Tab>('global');
  const [globalText, setGlobalText] = useState('');
  const [selected, setSelected] = useState<Set<PlatformId>>(
    new Set(['twitter', 'instagram', 'facebook', 'linkedin']),
  );
  const [overrides, setOverrides] = useState<Partial<Record<PlatformId, PerPlatformState>>>({});
  const [attachments, setAttachments] = useState<File[]>([]);
  const [thread, setThread] = useState<string[]>([]);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Phase B: live run panel. When AI Generate fires, we keep the runId
  // here and render <LiveRunPanel> inline so the operator watches the
  // pipeline advance in place — no fire-and-forget toast handoff.
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  // Format override per platform — keyed by platform id so picking
  // "carousel" on Instagram doesn't bleed into the LinkedIn tab. Empty
  // string (or absent) = use the platform default.
  const [formats, setFormats] = useState<Partial<Record<PlatformId, string>>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const formatFor = (id: PlatformId): string => formats[id] ?? '';
  const setFormatFor = (id: PlatformId, value: string) =>
    setFormats((prev) => ({ ...prev, [id]: value }));

  const togglePlatform = (id: PlatformId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Resolve the body for a given platform: per-platform override if set,
  // otherwise the global text.
  const bodyFor = (id: PlatformId): string =>
    overrides[id]?.override ? overrides[id]!.body : globalText;

  const setBodyFor = (id: PlatformId, body: string) => {
    setOverrides((prev) => ({
      ...prev,
      [id]: { body, override: true },
    }));
  };

  const resetOverride = (id: PlatformId) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  /**
   * Insert a string at the current textarea cursor position. Falls back to
   * appending if the textarea isn't focused. Always re-targets the right
   * setter (global vs per-platform override).
   */
  const insertAtCursor = (snippet: string) => {
    const ta = textareaRef.current;
    const current = active === 'global' ? globalText : bodyFor(active);
    let next: string;
    let selStart = current.length;
    if (ta && document.activeElement === ta) {
      const start = ta.selectionStart ?? current.length;
      const end = ta.selectionEnd ?? current.length;
      next = current.slice(0, start) + snippet + current.slice(end);
      selStart = start + snippet.length;
    } else {
      next = current + (current.endsWith(' ') || current === '' ? '' : ' ') + snippet;
      selStart = next.length;
    }
    if (active === 'global') setGlobalText(next);
    else setBodyFor(active as PlatformId, next);
    // Re-focus and place caret after the inserted snippet.
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        ta.setSelectionRange(selStart, selStart);
      }
    });
  };

  const onAttachFile = (kind: 'image' | 'video') => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAttachments((prev) => [...prev, file]);
    setToast({
      kind: 'success',
      message: `${t('composer.attached')}: ${file.name}`,
    });
    void kind;
  };

  const removeAttachment = (idx: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== idx));

  const promptMention = () => {
    const handle = window.prompt(t('composer.mention_prompt'));
    if (handle) insertAtCursor(`@${handle.replace(/^@/, '')}`);
  };

  const promptHashtag = () => {
    const tag = window.prompt(t('composer.hashtag_prompt'));
    if (tag) insertAtCursor(`#${tag.replace(/^#/, '').replace(/\s+/g, '')}`);
  };

  const addThreadPart = () => {
    const current = active === 'global' ? globalText : bodyFor(active);
    if (!current.trim()) return;
    setThread((prev) => [...prev, current]);
    if (active === 'global') setGlobalText('');
    else setBodyFor(active as PlatformId, '');
    setToast({ kind: 'success', message: t('composer.thread_added') });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">
            {t('composer.title')}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{t('composer.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-white/5"
          >
            <Calendar className="h-3.5 w-3.5" />
            {t('composer.schedule')}
          </button>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-purple to-brand-pink px-3 py-2 text-xs font-medium text-white hover:opacity-90"
          >
            <Send className="h-3.5 w-3.5" />
            {t('composer.post_now')}
          </button>
        </div>
      </div>

      {toast && (
        <Toast
          kind={toast.kind}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      )}

      {aiOpen && (
        <AiGenerateBar
          onClose={() => setAiOpen(false)}
          onRunStarted={(runId) => {
            setAiOpen(false);
            setActiveRunId(runId);
          }}
          onError={(err) => setToast({ kind: 'error', message: err })}
          activePlatform={active === 'global' ? 'linkedin' : (active as PlatformId)}
          format={
            active === 'global' ? '' : formatFor(active as PlatformId)
          }
        />
      )}

      {activeRunId && (
        <LiveRunPanel runId={activeRunId} onDismiss={() => setActiveRunId(null)} />
      )}

      {scheduleOpen && (
        <ScheduleModal
          mode={{
            kind: 'create-run',
            format: active === 'global' ? '' : formatFor(active as PlatformId),
          }}
          activePlatform={active === 'global' ? 'linkedin' : (active as PlatformId)}
          onClose={() => setScheduleOpen(false)}
          onScheduled={(when) => {
            setScheduleOpen(false);
            setToast({
              kind: 'success',
              message: `Scheduled for ${new Date(when).toLocaleString()}`,
            });
          }}
          onError={(err) => setToast({ kind: 'error', message: err })}
        />
      )}

      <PlatformPicker selected={selected} onToggle={togglePlatform} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComposerPanel
          active={active}
          setActive={setActive}
          selected={selected}
          globalText={globalText}
          setGlobalText={setGlobalText}
          bodyFor={bodyFor}
          setBodyFor={setBodyFor}
          resetOverride={resetOverride}
          overrides={overrides}
          textareaRef={textareaRef}
          attachments={attachments}
          removeAttachment={removeAttachment}
          onAttachFile={onAttachFile}
          onInsertEmoji={(e) => insertAtCursor(e)}
          onMention={promptMention}
          onHashtag={promptHashtag}
          onAddToThread={addThreadPart}
          onOpenAi={() => setAiOpen(true)}
          thread={thread}
          formatFor={formatFor}
          setFormatFor={setFormatFor}
        />
        <PreviewPanel
          active={active}
          selected={selected}
          bodyFor={bodyFor}
          globalText={globalText}
          attachments={attachments}
        />
      </div>

      <CharLimitsTable selected={selected} bodyFor={bodyFor} globalText={globalText} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform picker (top row of selected channels)
// ---------------------------------------------------------------------------

function PlatformPicker({
  selected,
  onToggle,
}: {
  selected: Set<PlatformId>;
  onToggle: (id: PlatformId) => void;
}) {
  const t = useT();
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
        {t('composer.publish_to')}
      </p>
      <div className="flex flex-wrap gap-2">
        {PLATFORMS_ORDERED.map((p) => {
          const on = selected.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onToggle(p.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                on
                  ? 'border-indigo-400/50 bg-indigo-500/10 text-indigo-200'
                  : 'border-white/10 text-zinc-400 hover:bg-white/5',
              )}
            >
              <span style={{ color: on ? p.color : undefined }}>{p.icon}</span>
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer panel (left column — tabs + textarea + per-platform controls)
// ---------------------------------------------------------------------------

interface ComposerPanelProps {
  active: Tab;
  setActive: (t: Tab) => void;
  selected: Set<PlatformId>;
  globalText: string;
  setGlobalText: (v: string) => void;
  bodyFor: (id: PlatformId) => string;
  setBodyFor: (id: PlatformId, body: string) => void;
  resetOverride: (id: PlatformId) => void;
  overrides: Partial<Record<PlatformId, PerPlatformState>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  attachments: File[];
  removeAttachment: (idx: number) => void;
  onAttachFile: (
    kind: 'image' | 'video',
  ) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  onInsertEmoji: (e: string) => void;
  onMention: () => void;
  onHashtag: () => void;
  onAddToThread: () => void;
  onOpenAi: () => void;
  thread: string[];
  formatFor: (id: PlatformId) => string;
  setFormatFor: (id: PlatformId, value: string) => void;
}

function ComposerPanel({
  active,
  setActive,
  selected,
  globalText,
  setGlobalText,
  bodyFor,
  setBodyFor,
  resetOverride,
  overrides,
  textareaRef,
  attachments,
  removeAttachment,
  onAttachFile,
  onInsertEmoji,
  onMention,
  onHashtag,
  onAddToThread,
  onOpenAi,
  thread,
  formatFor,
  setFormatFor,
}: ComposerPanelProps) {
  const t = useT();

  const tabs: Tab[] = ['global', ...ALL_PLATFORMS.filter((p) => selected.has(p))];

  const value = active === 'global' ? globalText : bodyFor(active);
  const onChange = (v: string) =>
    active === 'global' ? setGlobalText(v) : setBodyFor(active, v);

  const spec: PlatformSpec | null =
    active === 'global' ? null : getPlatformSpec(active);

  const charCount = value.length;
  const limit = spec?.content.charLimit ?? 0;
  const over = limit > 0 && charCount > limit;

  return (
    <div className="rounded-xl border border-white/10 bg-card overflow-hidden flex flex-col">
      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-white/10">
        {tabs.map((id) => {
          const on = id === active;
          const overridden = id !== 'global' && overrides[id]?.override;
          if (id === 'global') {
            return (
              <TabButton
                key="global"
                on={on}
                onClick={() => setActive('global')}
                color="#6366f1"
              >
                <Sparkles className="h-3 w-3" /> {t('composer.global_tab')}
              </TabButton>
            );
          }
          const p = getPlatformSpec(id);
          return (
            <TabButton
              key={id}
              on={on}
              onClick={() => setActive(id)}
              color={p.color}
              dot={overridden}
            >
              <span style={{ color: p.color }}>{p.icon}</span>
              {p.label}
            </TabButton>
          );
        })}
      </div>

      {/* Textarea + toolbar */}
      <div className="p-4 flex-1 space-y-3">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={10}
          placeholder={
            active === 'global'
              ? t('composer.body_placeholder', { platform: 'Global' })
              : t('composer.body_placeholder', {
                  platform: getPlatformSpec(active).label,
                })
          }
          className="w-full resize-none rounded-lg bg-black/30 border border-white/10 p-3 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-purple/40"
        />

        {/* Thread parts (Twitter only — visual cue that prior parts are queued) */}
        {thread.length > 0 && (
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-2 text-[11px] text-zinc-500">
            {thread.length} earlier thread part{thread.length === 1 ? '' : 's'} queued
          </div>
        )}

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-zinc-300"
              >
                {file.type.startsWith('video/') ? (
                  <Video className="h-3 w-3 text-zinc-500" />
                ) : (
                  <ImageIcon className="h-3 w-3 text-zinc-500" />
                )}
                <span className="truncate max-w-[12rem]">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="text-zinc-500 hover:text-rose-400"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar: image / video / emoji / @ / # */}
        <ComposerToolbar
          onAttachFile={onAttachFile}
          onInsertEmoji={onInsertEmoji}
          onMention={onMention}
          onHashtag={onHashtag}
        />

        {/* Action row: thread + AI Generate */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddToThread}
            disabled={!value.trim()}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('composer.add_to_thread')}
          </button>
          <button
            type="button"
            onClick={onOpenAi}
            className="flex items-center gap-1.5 rounded-lg border border-brand-purple/40 bg-gradient-to-r from-brand-purple/15 to-brand-pink/15 px-3 py-1.5 text-xs font-medium text-brand-cyan hover:from-brand-purple/25 hover:to-brand-pink/25"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('composer.ai_generate')}
          </button>
        </div>

        {/* Per-platform footer */}
        {spec && (
          <div className="space-y-2 pt-1 border-t border-white/5">
            <FormatPicker
              spec={spec}
              value={formatFor(active as PlatformId)}
              onChange={(v) => setFormatFor(active as PlatformId, v)}
            />
            <CharCounter spec={spec} count={charCount} />
            {over && (
              <p className="flex items-center gap-1.5 text-xs text-rose-400">
                <AlertTriangle className="h-3 w-3" />
                {t('composer.over_limit', { over: charCount - limit })}
              </p>
            )}
            <PlatformControls spec={spec} />
            {overrides[active as PlatformId]?.override && (
              <button
                type="button"
                onClick={() => resetOverride(active as PlatformId)}
                className="text-[11px] text-zinc-500 underline-offset-2 hover:underline hover:text-zinc-300"
              >
                Reset to global
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar (image / video / emoji / mention / hashtag)
// ---------------------------------------------------------------------------

function ComposerToolbar({
  onAttachFile,
  onInsertEmoji,
  onMention,
  onHashtag,
}: {
  onAttachFile: (kind: 'image' | 'video') => (e: React.ChangeEvent<HTMLInputElement>) => void;
  onInsertEmoji: (e: string) => void;
  onMention: () => void;
  onHashtag: () => void;
}) {
  const t = useT();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex items-center gap-1 relative">
      <ToolButton label={t('composer.attach_image')} onClick={() => imageInputRef.current?.click()}>
        <ImageIcon className="h-4 w-4" />
      </ToolButton>
      <ToolButton label={t('composer.attach_video')} onClick={() => videoInputRef.current?.click()}>
        <Video className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label={t('composer.insert_emoji')}
        onClick={() => setEmojiOpen((v) => !v)}
        active={emojiOpen}
      >
        <Smile className="h-4 w-4" />
      </ToolButton>
      <ToolButton label={t('composer.insert_mention')} onClick={onMention}>
        <AtSign className="h-4 w-4" />
      </ToolButton>
      <ToolButton label={t('composer.insert_hashtag')} onClick={onHashtag}>
        <Hash className="h-4 w-4" />
      </ToolButton>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onAttachFile('image')}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={onAttachFile('video')}
      />

      {emojiOpen && (
        // bottom-full pins the popover ABOVE the toolbar so it floats over
        // the textarea instead of spilling into the per-platform footer
        // (which sits below). 6 cols × 4 rows fits the 24-emoji palette
        // tightly without horizontal scroll.
        <div className="absolute z-30 bottom-full left-0 mb-2 w-[15.5rem] rounded-lg border border-white/10 bg-zinc-950 p-2 shadow-xl">
          <div className="grid grid-cols-6 gap-1">
            {EMOJI_PALETTE.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onInsertEmoji(e);
                  setEmojiOpen(false);
                }}
                className="flex h-8 w-8 items-center justify-center rounded text-base leading-none hover:bg-white/10"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors',
        active
          ? 'bg-brand-purple/20 text-brand-cyan'
          : 'hover:bg-white/5 hover:text-zinc-200',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AI Generate inline bar — invokes the existing pipeline via createRun
// ---------------------------------------------------------------------------

function AiGenerateBar({
  onClose,
  onRunStarted,
  onError,
  activePlatform,
  format,
}: {
  onClose: () => void;
  // Lifts the new runId to Composer so it can render the live pipeline
  // panel inline instead of bouncing the operator to a toast.
  onRunStarted: (runId: string) => void;
  onError: (err: string) => void;
  activePlatform: PlatformId;
  format: string;
}) {
  const t = useT();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [localFormat, setLocalFormat] = useState(format);
  const spec = getPlatformSpec(activePlatform);

  const submit = async () => {
    if (!topic.trim() || busy) return;
    setBusy(true);
    try {
      const res = await startRun({
        topic: topic.trim(),
        platform: activePlatform,
        format: localFormat || null,
      });
      onRunStarted(res.runId);
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-brand-purple/40 bg-gradient-to-r from-brand-purple/10 to-brand-pink/10 p-3 flex flex-wrap items-center gap-2">
      <Sparkles className="h-4 w-4 text-brand-cyan shrink-0" />
      <input
        autoFocus
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onClose();
        }}
        placeholder={t('composer.ai_generate_placeholder')}
        className="flex-1 min-w-[12rem] bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
        disabled={busy}
      />
      <span className="text-[11px] text-zinc-500 flex items-center gap-1">
        <span style={{ color: spec.color }}>{spec.icon}</span>
        {spec.label}
      </span>
      {spec.media.altFormats?.length ? (
        <select
          value={localFormat}
          onChange={(e) => setLocalFormat(e.target.value)}
          disabled={busy}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-purple/40"
        >
          <option value="">Default ({spec.media.imageAspectRatio})</option>
          {spec.media.altFormats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={!topic.trim() || busy}
        className="flex items-center gap-1.5 rounded-md bg-gradient-to-r from-brand-purple to-brand-pink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {t('composer.ai_generate')}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
        aria-label="Close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ScheduleModal lives in @/components/ScheduleModal — shared with RunDetail's
// approval flow. Imported at the top of this file.

function TabButton({
  on,
  onClick,
  color,
  dot,
  children,
}: {
  on: boolean;
  onClick: () => void;
  color: string;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors',
        on
          ? 'text-zinc-100 border-b-2'
          : 'text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent',
      )}
      style={on ? { borderColor: color } : undefined}
    >
      {children}
      {dot && (
        <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
      )}
    </button>
  );
}

/**
 * Format dropdown — only renders for platforms that declare alt formats.
 * Empty value = "use platform default". Value matches `altFormat.id`
 * (e.g. 'carousel', 'reel', 'story', 'short', 'landscape', 'square'),
 * which the engine prefixes with the platform id when calling the media
 * orchestrator (`instagram_carousel`).
 */
function FormatPicker({
  spec,
  value,
  onChange,
}: {
  spec: PlatformSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  if (!spec.media.altFormats?.length) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-zinc-400">Format</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-purple/40"
      >
        <option value="">
          Default ({spec.media.imageAspectRatio})
        </option>
        {spec.media.altFormats.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label} ({f.aspectRatio})
          </option>
        ))}
      </select>
    </div>
  );
}

function CharCounter({ spec, count }: { spec: PlatformSpec; count: number }) {
  const t = useT();
  const limit = spec.content.charLimit;
  const ratio = Math.min(count / limit, 1);
  const colour =
    ratio > 1
      ? 'bg-rose-400'
      : ratio > 0.9
        ? 'bg-amber-400'
        : 'bg-emerald-400';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-zinc-400">
        <span>{spec.label}</span>
        <span className={cn(count > limit && 'text-rose-400 font-medium')}>
          {t('composer.chars_of', { count, limit })}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
        <div
          className={cn('h-full transition-all', colour)}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}

function PlatformControls({ spec }: { spec: PlatformSpec }) {
  const t = useT();
  const hasReplyAudience = !!spec.content.replyAudience?.length;
  const hasAi = spec.content.disclosures.includes('ai_generated');
  const hasPaid = spec.content.disclosures.includes('paid_partnership');

  if (!hasReplyAudience && !hasAi && !hasPaid) {
    return (
      <p className="text-[11px] text-zinc-500">
        {t('composer.hashtags_target', {
          min: spec.content.hashtags.min,
          max: spec.content.hashtags.max,
        })}
      </p>
    );
  }

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
        {spec.label} settings
      </summary>
      <div className="mt-2 space-y-2 pl-3 border-l border-white/10">
        {hasReplyAudience && (
          <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
            <span>{t('composer.reply_audience')}</span>
            <select className="rounded border border-white/10 bg-black/30 px-2 py-1 text-zinc-200">
              {spec.content.replyAudience!.map((a) => (
                <option key={a} value={a}>
                  {t(`composer.reply.${a}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        {hasAi && (
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input type="checkbox" className="accent-indigo-400" />
            {t('composer.ai_disclosure')}
          </label>
        )}
        {hasPaid && (
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input type="checkbox" className="accent-indigo-400" />
            {t('composer.paid_partnership')}
          </label>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Preview panel (right column)
// ---------------------------------------------------------------------------

function PreviewPanel({
  active,
  selected,
  bodyFor,
  globalText,
  attachments,
}: {
  active: Tab;
  selected: Set<PlatformId>;
  bodyFor: (id: PlatformId) => string;
  globalText: string;
  attachments: File[];
}) {
  const t = useT();
  const target: PlatformId | null =
    active === 'global'
      ? (Array.from(selected)[0] ?? 'twitter')
      : (active as PlatformId);
  const spec = target ? getPlatformSpec(target) : null;
  const body = active === 'global' ? globalText : bodyFor(active);

  // First image attachment becomes the preview hero. Object URLs are
  // revoked on cleanup so we don't leak blobs across re-renders.
  const firstImage = attachments.find((f) => f.type.startsWith('image/'));
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!firstImage) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(firstImage);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [firstImage]);

  return (
    <div className="rounded-xl border border-white/10 bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          {t('composer.preview')}
        </p>
        {spec && (
          <span className="text-[11px] text-zinc-500">
            {spec.media.imageDimensions.width}×{spec.media.imageDimensions.height}
            {' '}·{' '}{spec.media.imageAspectRatio}
          </span>
        )}
      </div>

      {!body && !imageUrl ? (
        <div className="rounded-lg border border-dashed border-white/10 p-12 text-center text-xs text-zinc-500">
          {t('composer.no_content')}
        </div>
      ) : (
        <PreviewCard spec={spec!} body={body} imageUrl={imageUrl} />
      )}
    </div>
  );
}

function PreviewCard({
  spec,
  body,
  imageUrl,
}: {
  spec: PlatformSpec;
  body: string;
  imageUrl?: string | null;
}) {
  // Cap the preview at ~360px wide and the placeholder image at 280px
  // tall. Without the cap, tall aspect ratios (9:16 stories, 4:5
  // Instagram) blew the preview pane up to 600+px tall on a wide screen
  // and dominated the page. The cap preserves the ratio (so the operator
  // still sees the shape) without making the preview the dominant
  // element.
  const aspectStyle = useMemo(() => {
    const [w, h] = spec.media.imageAspectRatio.split(':').map(Number);
    const ratioPct = (h / w) * 100;
    return { paddingBottom: `${ratioPct}%` } as const;
  }, [spec.media.imageAspectRatio]);

  return (
    <div className="mx-auto w-full max-w-sm rounded-lg border border-white/10 overflow-hidden bg-black/40">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <span style={{ color: spec.color }} className="text-base leading-none">
          {spec.icon}
        </span>
        <span className="text-xs text-zinc-200 font-medium">{spec.label}</span>
        <span className="text-[10px] text-zinc-500 ml-auto">
          {body.length} / {spec.content.charLimit}
        </span>
      </div>
      <div className="relative w-full bg-zinc-900 max-h-72 overflow-hidden" style={aspectStyle}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-600">
            {spec.media.imageDimensions.width}×{spec.media.imageDimensions.height}
          </div>
        )}
      </div>
      <div className="p-3 text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed line-clamp-[12]">
        {body}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Char-limits table at the bottom
// ---------------------------------------------------------------------------

function CharLimitsTable({
  selected,
  bodyFor,
  globalText,
}: {
  selected: Set<PlatformId>;
  bodyFor: (id: PlatformId) => string;
  globalText: string;
}) {
  const t = useT();
  if (selected.size === 0) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-card p-4">
      <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
        {t('composer.char_limit')}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {Array.from(selected).map((id) => {
          const spec = getPlatformSpec(id);
          const body = bodyFor(id) || globalText;
          const count = body.length;
          const over = count > spec.content.charLimit;
          return (
            <div
              key={id}
              className="rounded-lg border border-white/10 px-3 py-2"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span style={{ color: spec.color }}>{spec.icon}</span>
                <span className="text-xs text-zinc-300">{spec.label}</span>
              </div>
              <div className={cn('text-sm font-medium', over ? 'text-rose-400' : 'text-zinc-200')}>
                {count} / {spec.content.charLimit}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
