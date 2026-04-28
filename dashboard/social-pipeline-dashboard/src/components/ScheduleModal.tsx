import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Loader2, X } from 'lucide-react';
import { getPlatformSpec, type PlatformId } from '@/lib/platforms';
import { scheduleRun, rescheduleRun } from '@/lib/api';
import DateTimePicker from './DateTimePicker';

// Per-platform best-times distilled from common social-media engagement
// research. LinkedIn peaks weekday mornings, Instagram early evening, etc.
// Times are local to the operator.
const BEST_TIMES: Record<string, { hour: number; minute: number; label: string }[]> = {
  linkedin: [
    { hour: 8, minute: 0, label: 'Tue 8am — peak B2B' },
    { hour: 12, minute: 0, label: 'Wed 12pm — lunch scroll' },
    { hour: 17, minute: 0, label: 'Thu 5pm — commute' },
  ],
  twitter: [
    { hour: 9, minute: 0, label: '9am weekday' },
    { hour: 15, minute: 0, label: '3pm weekday' },
    { hour: 19, minute: 0, label: '7pm evening' },
  ],
  instagram: [
    { hour: 11, minute: 0, label: '11am late morning' },
    { hour: 14, minute: 0, label: '2pm afternoon' },
    { hour: 19, minute: 0, label: '7pm evening' },
  ],
  facebook: [
    { hour: 9, minute: 0, label: '9am morning' },
    { hour: 13, minute: 0, label: '1pm midday' },
    { hour: 15, minute: 0, label: '3pm afternoon' },
  ],
  tiktok: [
    { hour: 6, minute: 0, label: '6am pre-work' },
    { hour: 19, minute: 0, label: '7pm evening' },
    { hour: 22, minute: 0, label: '10pm late night' },
  ],
  youtube: [
    { hour: 14, minute: 0, label: 'Sat 2pm' },
    { hour: 17, minute: 0, label: 'Sun 5pm' },
    { hour: 20, minute: 0, label: 'Thu 8pm' },
  ],
};

function nextOccurrenceAt(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

export type ScheduleModalMode =
  // Composer "Schedule" button — creates a new scheduled pipeline run.
  | { kind: 'create-run'; format: string }
  // RunDetail "Approve" — schedules publishing for an already-approved run
  // by PATCHing scheduled_at on the existing run row.
  | { kind: 'schedule-approved'; runId: string };

interface ScheduleModalProps {
  mode: ScheduleModalMode;
  activePlatform: PlatformId;
  onClose: () => void;
  onScheduled: (when: string) => void;
  onError: (msg: string) => void;
}

export default function ScheduleModal({
  mode,
  activePlatform,
  onClose,
  onScheduled,
  onError,
}: ScheduleModalProps) {
  const [topic, setTopic] = useState('');
  const [when, setWhen] = useState<Date>(() => new Date(Date.now() + 60 * 60 * 1000));
  const [busy, setBusy] = useState(false);
  const presets = BEST_TIMES[activePlatform] ?? BEST_TIMES.linkedin;
  const spec = getPlatformSpec(activePlatform);

  const isCreate = mode.kind === 'create-run';
  const title = isCreate ? 'Smart Schedule' : 'Schedule publish';
  const subtitle = isCreate
    ? 'Run AI Generate at a chosen time'
    : 'Pick when this approved run should publish';
  const submitLabel = isCreate ? 'Schedule' : 'Schedule publish';

  const submit = async () => {
    if (busy) return;
    if (isCreate && !topic.trim()) return;
    const local = when;
    if (Number.isNaN(local.getTime())) {
      onError('Pick a valid date and time.');
      return;
    }
    setBusy(true);
    try {
      if (mode.kind === 'create-run') {
        const res = await scheduleRun({
          topic: topic.trim(),
          platform: activePlatform,
          format: mode.format || null,
          scheduled_at: local.toISOString(),
        });
        onScheduled(res.scheduled_at);
      } else {
        // Same endpoint the calendar drag-and-drop uses — sets scheduled_at.
        // Status stays 'approved' for runs already through approval.
        await rescheduleRun(mode.runId, local.toISOString());
        onScheduled(local.toISOString());
      }
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-border-strong bg-zinc-950 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-primaryText flex items-center gap-2">
              <Calendar className="h-4 w-4 text-brand-cyan" />
              {title}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {subtitle} for{' '}
              <span style={{ color: spec.color }}>{spec.label}</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-surface-soft hover:text-secondaryText"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isCreate && (
          <label className="block text-xs text-muted">
            Topic
            <input
              autoFocus
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What's the post about?"
              className="mt-1 w-full rounded-md border border-border-strong bg-black/40 px-3 py-2 text-sm text-primaryText placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand-purple/40"
            />
          </label>
        )}

        <div>
          <p className="block text-xs text-muted mb-1">When</p>
          <DateTimePicker value={when} onChange={setWhen} min={new Date()} />
        </div>

        <div>
          <p className="text-xs text-muted mb-2">Best times for {spec.label}</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setWhen(nextOccurrenceAt(p.hour, p.minute))}
                className="rounded-md border border-border-strong bg-black/30 px-2 py-1 text-[11px] text-secondaryText hover:border-brand-purple/40 hover:bg-brand-purple/10"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border-strong px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || (isCreate && !topic.trim())}
            className="flex items-center gap-1.5 rounded-md bg-gradient-to-r from-brand-purple to-brand-pink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calendar className="h-3.5 w-3.5" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
