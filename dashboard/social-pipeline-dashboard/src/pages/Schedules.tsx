import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Pencil,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import Modal from '@/components/Modal';
import {
  fetchSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
  runScheduleNow,
  type Schedule,
  type CadencePayload,
  type ScheduleActionKind,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ACTION_LABEL: Record<ScheduleActionKind, string> = {
  run_pipeline: 'Run pipeline',
  run_pipeline_multi: 'Multi-platform pipeline',
  research_only: 'Research only',
  schedule_multi_day_campaign: 'Multi-day campaign',
};

export default function Schedules() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => fetchSchedules(),
    refetchInterval: 10_000,
  });
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const schedules = data?.schedules ?? [];

  const onRunNow = async (id: string) => {
    setBusy(`run:${id}`);
    setActionError(null);
    try {
      const r = await runScheduleNow(id);
      if (!r.ok) setActionError(r.summary);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ['schedules'] });
    }
  };

  const onTogglePause = async (s: Schedule) => {
    setBusy(`toggle:${s.id}`);
    setActionError(null);
    try {
      if (s.status === 'active') await pauseSchedule(s.id);
      else await resumeSchedule(s.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ['schedules'] });
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm('Delete this schedule and its fire history? This cannot be undone.')) {
      return;
    }
    setBusy(`del:${id}`);
    setActionError(null);
    try {
      await deleteSchedule(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ['schedules'] });
    }
  };

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primaryText">Schedules</h1>
          <p className="text-sm text-muted">
            Recurring tasks the agent fires automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 rounded-lg border border-border-strong bg-surface-medium px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-strong"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-lg bg-brand-purple px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> New schedule
          </button>
        </div>
      </header>

      {actionError && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {actionError}
        </div>
      )}

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted">Loading schedules…</p>
      ) : isError ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-3 text-xs text-red-300">
          Couldn't load schedules: {error instanceof Error ? error.message : String(error)}
        </div>
      ) : schedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong py-16 text-center">
          <Clock className="mb-3 h-10 w-10 text-muted" />
          <p className="text-sm text-secondaryText">No schedules yet.</p>
          <p className="mt-1 text-xs text-muted">
            Ask Constance: "every Monday at 9am, research the latest AI agent news"
            <br />
            or click <b>New schedule</b> above.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-strong">
          <table className="w-full text-sm">
            <thead className="bg-surface-medium text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Cadence</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Next fire</th>
                <th className="px-3 py-2 text-left">Last fire</th>
                <th className="px-3 py-2 text-left">Fires</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-strong">
              {schedules.map((s) => (
                <tr key={s.id} className="hover:bg-surface-soft">
                  <td className="px-3 py-2 font-medium text-primaryText">
                    {s.name}
                    {s.cadence_source && (
                      <div className="mt-0.5 text-[10px] italic text-muted">
                        “{s.cadence_source}”
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-secondaryText">
                    {s.cadence_summary}
                  </td>
                  <td className="px-3 py-2 text-xs text-secondaryText">
                    {ACTION_LABEL[s.action_kind] ?? s.action_kind}
                    <div className="mt-0.5 text-[10px] text-muted">
                      {summariseActionPayload(s.action_kind, s.action_payload)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-secondaryText">
                    {formatLocal(s.next_fire_at)}
                  </td>
                  <td className="px-3 py-2 text-xs text-secondaryText">
                    {s.last_fire_at ? (
                      <div className="flex items-center gap-1.5">
                        {s.last_fire_status === 'ok' ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-400" />
                        )}
                        {formatLocal(s.last_fire_at)}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-secondaryText">
                    {s.fire_count}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={s.status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <IconButton
                        onClick={() => onRunNow(s.id)}
                        disabled={busy === `run:${s.id}`}
                        title="Run now"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        onClick={() => onTogglePause(s)}
                        disabled={busy === `toggle:${s.id}`}
                        title={s.status === 'active' ? 'Pause' : 'Resume'}
                      >
                        {s.status === 'active' ? (
                          <Pause className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </IconButton>
                      <IconButton onClick={() => setEditing(s)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        onClick={() => onDelete(s.id)}
                        disabled={busy === `del:${s.id}`}
                        title="Delete"
                        danger
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <ScheduleDialog
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['schedules'] });
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Schedule['status'] }) {
  const color =
    status === 'active'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : status === 'paused'
        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
        : 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide', color)}>
      {status}
    </span>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'rounded-md border border-border-strong p-1.5 text-secondaryText transition-colors',
        danger
          ? 'hover:border-red-500/50 hover:text-red-300'
          : 'hover:border-brand-purple/50 hover:text-brand-cyan',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

function formatLocal(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function summariseActionPayload(
  kind: ScheduleActionKind,
  payload: Record<string, unknown>,
): string {
  switch (kind) {
    case 'run_pipeline':
      return `${payload.platform ?? '?'} · "${String(payload.topic ?? '').slice(0, 80)}"`;
    case 'run_pipeline_multi':
      return `${(payload.platforms as string[] | undefined)?.join('/') ?? '?'} · "${String(payload.topic ?? '').slice(0, 80)}"`;
    case 'research_only':
      return `topic: "${String(payload.topic ?? '').slice(0, 80)}"`;
    case 'schedule_multi_day_campaign':
      return `${(payload.days as unknown[] | undefined)?.length ?? '?'} days on ${payload.platform ?? '?'}`;
    default:
      return JSON.stringify(payload).slice(0, 100);
  }
}

// ─── Create / Edit dialog ───────────────────────────────────────────────────

function ScheduleDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing: Schedule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [cadenceKind, setCadenceKind] = useState<'daily' | 'weekly' | 'monthly' | 'cron'>(
    existing?.cadence_kind ?? 'weekly',
  );
  const [hour, setHour] = useState<number>(existing?.cadence_payload.hour ?? 9);
  const [minute, setMinute] = useState<number>(existing?.cadence_payload.minute ?? 0);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    existing?.cadence_payload.day_of_week ?? [1],
  );
  const [dayOfMonth, setDayOfMonth] = useState<number>(
    existing?.cadence_payload.day_of_month ?? 1,
  );
  const [cron, setCron] = useState<string>(existing?.cadence_payload.cron ?? '');
  const [timezone, setTimezone] = useState<string>(
    existing?.cadence_payload.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      'UTC',
  );
  const [actionKind, setActionKind] = useState<ScheduleActionKind>(
    existing?.action_kind ?? 'run_pipeline',
  );
  const [topic, setTopic] = useState<string>(
    String(existing?.action_payload?.topic ?? ''),
  );
  const [platform, setPlatform] = useState<string>(
    String(existing?.action_payload?.platform ?? 'linkedin'),
  );
  const [platforms, setPlatforms] = useState<string[]>(
    (existing?.action_payload?.platforms as string[] | undefined) ?? ['linkedin'],
  );
  const [format, setFormat] = useState<string>(
    String(existing?.action_payload?.format ?? ''),
  );
  const [textOverlay, setTextOverlay] = useState<boolean>(
    Boolean(existing?.action_payload?.textOverlay),
  );
  const [notifyChat, setNotifyChat] = useState<boolean>(
    existing?.notify_chat ?? true,
  );
  const [notifyTelegram, setNotifyTelegram] = useState<boolean>(
    existing?.notify_telegram ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cadence = useMemo<CadencePayload & { kind: typeof cadenceKind }>(
    () => ({
      kind: cadenceKind,
      hour,
      minute,
      day_of_week: cadenceKind === 'weekly' ? daysOfWeek : undefined,
      day_of_month: cadenceKind === 'monthly' ? dayOfMonth : undefined,
      cron: cadenceKind === 'cron' ? cron : undefined,
      timezone,
    }),
    [cadenceKind, hour, minute, daysOfWeek, dayOfMonth, cron, timezone],
  );

  const actionPayload = useMemo<Record<string, unknown>>(() => {
    switch (actionKind) {
      case 'run_pipeline':
        return {
          topic,
          platform,
          ...(format ? { format } : {}),
          ...(textOverlay ? { textOverlay: true } : {}),
        };
      case 'run_pipeline_multi':
        return {
          topic,
          platforms,
          ...(format ? { format } : {}),
          ...(textOverlay ? { textOverlay: true } : {}),
        };
      case 'research_only':
        return { topic, platform };
      case 'schedule_multi_day_campaign':
        return {
          topic,
          platform,
          ...(format ? { format } : {}),
          days: [],
        };
    }
  }, [actionKind, topic, platform, platforms, format, textOverlay]);

  const onSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name,
        cadence,
        action: { kind: actionKind, payload: actionPayload },
        notify_chat: notifyChat,
        notify_telegram: notifyTelegram,
      };
      if (existing) {
        await updateSchedule(existing.id, payload);
      } else {
        await createSchedule(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? `Edit schedule: ${existing.name}` : 'New schedule'}
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Monday AI research"
            className="w-full rounded-md border border-border-strong bg-black/40 px-3 py-2 text-sm text-primaryText"
          />
        </Field>

        <Field label="Cadence">
          <div className="flex items-center gap-2">
            {(['daily', 'weekly', 'monthly', 'cron'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setCadenceKind(k)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs capitalize transition-colors',
                  cadenceKind === k
                    ? 'bg-brand-purple/30 text-brand-cyan'
                    : 'bg-surface-medium text-muted hover:text-secondaryText',
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </Field>

        {cadenceKind === 'weekly' && (
          <Field label="Days of week">
            <div className="flex items-center gap-1.5">
              {DAY_NAMES.map((dn, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    setDaysOfWeek((arr) =>
                      arr.includes(i) ? arr.filter((d) => d !== i) : [...arr, i].sort(),
                    )
                  }
                  className={cn(
                    'h-9 w-12 rounded-md text-xs transition-colors',
                    daysOfWeek.includes(i)
                      ? 'bg-brand-purple/30 text-brand-cyan'
                      : 'bg-surface-medium text-muted hover:text-secondaryText',
                  )}
                >
                  {dn}
                </button>
              ))}
            </div>
          </Field>
        )}

        {cadenceKind === 'monthly' && (
          <Field label="Day of month (1-31)">
            <input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Number(e.target.value))}
              className="w-24 rounded-md border border-border-strong bg-black/40 px-3 py-2 text-sm text-primaryText"
            />
          </Field>
        )}

        {cadenceKind === 'cron' && (
          <Field label="Cron expression (5 fields)">
            <input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 * * 1"
              className="w-full rounded-md border border-border-strong bg-black/40 px-3 py-2 text-sm font-mono text-primaryText"
            />
          </Field>
        )}

        {cadenceKind !== 'cron' && (
          <Field label="Time of day">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="w-16 rounded-md border border-border-strong bg-black/40 px-2 py-2 text-sm text-primaryText"
              />
              <span className="text-muted">:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={minute}
                onChange={(e) => setMinute(Number(e.target.value))}
                className="w-16 rounded-md border border-border-strong bg-black/40 px-2 py-2 text-sm text-primaryText"
              />
            </div>
          </Field>
        )}

        <Field label="Timezone">
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Europe/London"
            className="w-full rounded-md border border-border-strong bg-black/40 px-3 py-2 text-sm text-primaryText"
          />
        </Field>

        <Field label="Action">
          <select
            value={actionKind}
            onChange={(e) => setActionKind(e.target.value as ScheduleActionKind)}
            className="w-full rounded-md border border-border-strong bg-black/40 px-3 py-2 text-sm text-primaryText"
          >
            <option value="run_pipeline">Run pipeline (one platform)</option>
            <option value="run_pipeline_multi">Multi-platform pipeline</option>
            <option value="research_only">Research only</option>
            <option value="schedule_multi_day_campaign">Multi-day campaign</option>
          </select>
        </Field>

        <Field label="Topic">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="latest AI agent news"
            className="w-full rounded-md border border-border-strong bg-black/40 px-3 py-2 text-sm text-primaryText"
          />
        </Field>

        {actionKind === 'run_pipeline_multi' ? (
          <Field label="Platforms (comma-separated)">
            <input
              value={platforms.join(',')}
              onChange={(e) =>
                setPlatforms(
                  e.target.value.split(',').map((p) => p.trim()).filter(Boolean),
                )
              }
              placeholder="instagram, linkedin, twitter"
              className="w-full rounded-md border border-border-strong bg-black/40 px-3 py-2 text-sm text-primaryText"
            />
          </Field>
        ) : (
          <Field label="Platform">
            <input
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="instagram"
              className="w-full rounded-md border border-border-strong bg-black/40 px-3 py-2 text-sm text-primaryText"
            />
          </Field>
        )}

        {(actionKind === 'run_pipeline' || actionKind === 'run_pipeline_multi' ||
          actionKind === 'schedule_multi_day_campaign') && (
          <Field label="Format (optional)">
            <input
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              placeholder="carousel, reel, short, story, thread"
              className="w-full rounded-md border border-border-strong bg-black/40 px-3 py-2 text-sm text-primaryText"
            />
          </Field>
        )}

        {format === 'carousel' && (
          <label className="flex items-center gap-2 text-xs text-secondaryText">
            <input
              type="checkbox"
              checked={textOverlay}
              onChange={(e) => setTextOverlay(e.target.checked)}
            />
            Render slide text into each image
          </label>
        )}

        <div className="space-y-1.5 pt-2">
          <label className="flex items-center gap-2 text-xs text-secondaryText">
            <input
              type="checkbox"
              checked={notifyChat}
              onChange={(e) => setNotifyChat(e.target.checked)}
            />
            Notify in chat on each fire
          </label>
          <label className="flex items-center gap-2 text-xs text-secondaryText">
            <input
              type="checkbox"
              checked={notifyTelegram}
              onChange={(e) => setNotifyTelegram(e.target.checked)}
            />
            Notify via Telegram (requires bot + chat id configured)
          </label>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border-strong px-4 py-2 text-sm text-secondaryText hover:bg-surface-medium"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={saving || !name.trim() || !topic.trim()}
            className="rounded-md bg-brand-purple px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Create schedule'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-wide text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
