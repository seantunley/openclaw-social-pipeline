import { useEffect, useState, useCallback } from 'react';
import dayjs from 'dayjs';
import { useT } from '@/lib/i18n';
import isoWeek from 'dayjs/plugin/isoWeek';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { fetchRuns, rescheduleRun } from '@/lib/api';
import { cn } from '@/lib/utils';

dayjs.extend(isoWeek);

type ViewMode = 'month' | 'week' | 'list';

const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  youtube: '#FF0000',
  twitter: '#1DA1F2',
  linkedin: '#0A66C2',
  tiktok: '#69C9D0',
  reddit: '#FF4500',
  pinterest: '#E60023',
  bluesky: '#0085FF',
  threads: '#ffffff',
  vk: '#4680C2',
  default: '#a78bfa',
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  queued: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  scheduled: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  published: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400' },
  cancelled: { bg: 'bg-surface-soft', text: 'text-white/30' },
  awaiting_approval: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  approved: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
};

/* --- Draggable calendar item --- */
function CalendarItem({ item, compact }: { item: any; compact?: boolean }) {
  const [{ opacity }, dragRef] = useDrag(
    () => ({
      type: 'schedule',
      item: { id: item.id, scheduledAt: item.scheduledAt || item.scheduled_for || item.createdAt || item.created_at },
      collect: (monitor) => ({ opacity: monitor.isDragging() ? 0.3 : 1 }),
    }),
    [item.id, item.scheduledAt, item.scheduled_for]
  );

  const platformColor = PLATFORM_COLORS[item.platform] ?? PLATFORM_COLORS.default;
  const status = STATUS_STYLES[item.status] ?? STATUS_STYLES.pending;
  const scheduledAt = item.scheduledAt || item.scheduled_for || item.createdAt || item.created_at;

  if (compact) {
    return (
      <div ref={dragRef as any} style={{ opacity }} className="cursor-grab active:cursor-grabbing">
        <div
          className={`block rounded-md px-1.5 py-1.5 text-[11px] truncate ${status.bg} ${status.text} hover:brightness-125 transition-all`}
          style={{ borderLeft: `3px solid ${platformColor}` }}
        >
          <span className="font-medium">{dayjs(scheduledAt).format('HH:mm')}</span>{' '}
          {item.brief?.topic || item.brief?.title || `Run ${item.id?.slice(0, 8)}`}
        </div>
      </div>
    );
  }

  return (
    <div ref={dragRef as any} style={{ opacity }} className="cursor-grab active:cursor-grabbing">
      <div
        className="block rounded-lg border border-zinc-800 bg-card p-3 hover:border-zinc-700 transition-all"
        style={{ borderLeft: `4px solid ${platformColor}` }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${status.bg} ${status.text}`}>
            {item.status}
          </span>
          {item.platform && (
            <span className="text-[10px] text-muted capitalize">{item.platform}</span>
          )}
          <span className="text-[10px] text-faint ml-auto">
            {dayjs(scheduledAt).format('HH:mm')}
          </span>
        </div>
        <p className="text-xs font-medium text-secondaryText truncate">
          {item.brief?.topic || item.brief?.title || `Run ${item.id?.slice(0, 8)}`}
        </p>
      </div>
    </div>
  );
}

/* --- Drop zone for a day cell --- */
function DayCell({
  date,
  items,
  isToday,
  isCurrentMonth,
  onDrop,
}: {
  date: dayjs.Dayjs;
  items: any[];
  isToday: boolean;
  isCurrentMonth: boolean;
  onDrop: (id: string, date: dayjs.Dayjs) => void;
}) {
  const isPast = date.isBefore(dayjs(), 'day');

  const [{ canDrop, isOver }, dropRef] = useDrop(
    () => ({
      accept: 'schedule',
      drop: (dragItem: any) => {
        if (isPast) return;
        const oldDate = dayjs(dragItem.scheduledAt);
        const newDate = date.hour(oldDate.hour()).minute(oldDate.minute()).second(0);
        onDrop(dragItem.id, newDate);
      },
      collect: (monitor) => ({
        canDrop: !isPast && !!monitor.canDrop(),
        isOver: !isPast && !!monitor.isOver(),
      }),
    }),
    [date, isPast]
  );

  return (
    <div
      ref={dropRef as any}
      className={cn(
        'min-h-[80px] sm:min-h-[110px] rounded-lg border p-1 sm:p-1.5 transition-all',
        isOver && canDrop
          ? 'border-indigo-500 bg-indigo-500/5'
          : isToday
            ? 'border-indigo-500/50 bg-indigo-500/5'
            : isCurrentMonth
              ? 'border-zinc-800 bg-card'
              : 'border-transparent bg-white/[0.01]'
      )}
    >
      <p
        className={cn(
          'text-xs mb-1 px-0.5',
          isToday ? 'text-indigo-400 font-bold' : isCurrentMonth ? 'text-muted' : 'text-faint'
        )}
      >
        {date.format('D')}
      </p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <CalendarItem key={item.id} item={item} compact />
        ))}
      </div>
    </div>
  );
}

/* --- Week view with hour slots --- */
function WeekView({
  startDate,
  items,
  onDrop,
}: {
  startDate: dayjs.Dayjs;
  items: any[];
  onDrop: (id: string, date: dayjs.Dayjs) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => startDate.add(i, 'day'));
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const getItems = (day: dayjs.Dayjs, hour: number) =>
    items.filter((item) => {
      const d = dayjs(item.scheduledAt || item.scheduled_for || item.createdAt || item.created_at);
      return d.isSame(day, 'day') && d.hour() === hour;
    });

  return (
    <div className="overflow-x-auto -mx-3 px-3 sm:-mx-0 sm:px-0">
      <div className="grid min-w-[700px] sm:min-w-[900px]" style={{ gridTemplateColumns: '50px repeat(7, 1fr)' }}>
        {/* Header row */}
        <div className="border-b border-zinc-800 p-1 sm:p-2" />
        {days.map((day) => (
          <div
            key={day.toString()}
            className={cn(
              'border-b border-zinc-800 p-1 sm:p-2 text-center',
              day.isSame(dayjs(), 'day') && 'bg-indigo-500/5'
            )}
          >
            <p className="text-[10px] text-muted">{day.format('ddd')}</p>
            <p className={cn('text-xs sm:text-sm font-semibold', day.isSame(dayjs(), 'day') && 'text-indigo-400')}>
              {day.format('D')}
            </p>
          </div>
        ))}

        {/* Hour rows */}
        {hours.map((hour) => (
          <div key={hour} className="contents">
            <div className="border-r border-zinc-800 p-1 text-[10px] text-faint text-right pr-1.5 pt-1">
              {String(hour).padStart(2, '0')}:00
            </div>
            {days.map((day) => {
              const cellItems = getItems(day, hour);
              const isPast = day.hour(hour).isBefore(dayjs());
              return (
                <WeekCell
                  key={`${day.toString()}-${hour}`}
                  day={day}
                  hour={hour}
                  items={cellItems}
                  isPast={isPast}
                  onDrop={onDrop}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekCell({
  day,
  hour,
  items,
  isPast,
  onDrop,
}: {
  day: dayjs.Dayjs;
  hour: number;
  items: any[];
  isPast: boolean;
  onDrop: (id: string, date: dayjs.Dayjs) => void;
}) {
  const [{ isOver }, dropRef] = useDrop(
    () => ({
      accept: 'schedule',
      drop: (dragItem: any) => {
        if (isPast) return;
        const newDate = day.hour(hour).minute(0).second(0);
        onDrop(dragItem.id, newDate);
      },
      collect: (monitor) => ({ isOver: !isPast && !!monitor.isOver() }),
    }),
    [day, hour, isPast]
  );

  return (
    <div
      ref={dropRef as any}
      className={cn(
        'border-b border-r border-zinc-800 min-h-[36px] p-0.5 transition-colors',
        isOver && 'bg-indigo-500/10'
      )}
    >
      {items.map((item) => (
        <CalendarItem key={item.id} item={item} compact />
      ))}
    </div>
  );
}

/* --- List view --- */
function ListView({ items }: { items: any[] }) {
  const t = useT();
  const grouped: Record<string, any[]> = {};
  for (const item of items) {
    const day = dayjs(item.scheduledAt || item.scheduled_for || item.createdAt || item.created_at).format('YYYY-MM-DD');
    (grouped[day] ??= []).push(item);
  }
  const sortedDays = Object.keys(grouped).sort();

  return (
    <div className="space-y-4">
      {sortedDays.map((day) => (
        <div key={day}>
          <h3 className="text-xs font-semibold text-muted mb-2">
            {dayjs(day).format('dddd, MMMM D, YYYY')}
          </h3>
          <div className="space-y-2">
            {grouped[day].map((item) => (
              <CalendarItem key={item.id} item={item} />
            ))}
          </div>
        </div>
      ))}
      {sortedDays.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-800 p-10 text-center">
          <CalendarIcon className="h-8 w-8 text-faint mx-auto mb-2" />
          <p className="text-sm text-muted">{t('schedule.empty')}</p>
        </div>
      )}
    </div>
  );
}

/* --- Main Calendar Page --- */
export default function SchedulePage() {
  const t = useT();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(dayjs());

  const loadCalendar = useCallback(() => {
    setLoading(true);
    // Fetch all scheduled + published runs and treat them as calendar items
    // Pull every status the calendar cares about. Real DB statuses are
    // pending|scheduled|running|completed|failed|cancelled plus the soft
    // `pending_approval` value the pipeline sets after the media stage.
    Promise.all([
      fetchRuns({ status: 'scheduled' }).catch(() => []),
      fetchRuns({ status: 'pending_approval' }).catch(() => []),
      fetchRuns({ status: 'completed' }).catch(() => []),
    ])
      .then(([scheduled, pendingApproval, completed]) => {
        const all = [
          ...(Array.isArray(scheduled) ? scheduled : []),
          ...(Array.isArray(pendingApproval) ? pendingApproval : []),
          ...(Array.isArray(completed) ? completed : []),
        ].filter((r) => r.scheduledAt || r.scheduled_for); // calendar only shows runs that have a scheduled time
        setItems(all);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  const handleDrop = async (runId: string, newDate: dayjs.Dayjs) => {
    try {
      await rescheduleRun(runId, newDate.toISOString());
      loadCalendar();
    } catch (err: any) {
      console.error('Reschedule failed:', err.message);
    }
  };

  const navigate = (dir: number) => {
    if (view === 'week') setCurrentDate(currentDate.add(dir * 7, 'day'));
    else setCurrentDate(currentDate.add(dir, 'month'));
  };

  const getItemsForDay = (day: dayjs.Dayjs) =>
    items.filter((item) => dayjs(item.scheduledAt || item.scheduled_for || item.createdAt || item.created_at).isSame(day, 'day'));

  // Month view: build 42-cell grid (6 weeks)
  const monthStart = currentDate.startOf('month');
  const calendarStart = monthStart.startOf('isoWeek');
  const monthCells = Array.from({ length: 42 }, (_, i) => calendarStart.add(i, 'day'));

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-primaryText">
              {t('schedule.title')}
            </h1>
            <p className="text-xs sm:text-sm text-muted mt-1">{t('schedule.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            {/* View switcher */}
            <div className="flex items-center gap-1 bg-surface-faint rounded-lg p-1">
              {(['month', 'week', 'list'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    'px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors',
                    view === v ? 'bg-surface-medium text-white' : 'text-muted hover:text-secondaryText'
                  )}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => navigate(-1)}
                className="p-2 rounded-lg hover:bg-white/[0.05] text-muted hover:text-white transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentDate(dayjs())}
                className="text-xs px-2.5 sm:px-3 py-1.5 rounded-lg border border-zinc-800 text-muted hover:text-white hover:border-zinc-600 transition-colors"
              >
                Today
              </button>
              <span className="text-xs sm:text-sm font-semibold min-w-[120px] sm:min-w-[160px] text-center text-secondaryText">
                {view === 'week'
                  ? `${currentDate.startOf('isoWeek').format('MMM D')} – ${currentDate.endOf('isoWeek').format('MMM D, YYYY')}`
                  : currentDate.format('MMMM YYYY')}
              </span>
              <button
                onClick={() => navigate(1)}
                className="p-2 rounded-lg hover:bg-white/[0.05] text-muted hover:text-white transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-faint" />
          </div>
        ) : (
          <>
            {/* Month View */}
            {view === 'month' && (
              <div className="overflow-x-auto -mx-3 px-3 sm:-mx-0 sm:px-0">
                <div className="min-w-[500px]">
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                      <div
                        key={d}
                        className="p-1.5 sm:p-2 text-center text-[10px] text-muted font-medium uppercase tracking-wider"
                      >
                        {d}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {monthCells.map((day) => (
                      <DayCell
                        key={day.toString()}
                        date={day}
                        items={getItemsForDay(day)}
                        isToday={day.isSame(dayjs(), 'day')}
                        isCurrentMonth={day.month() === currentDate.month()}
                        onDrop={handleDrop}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Week View */}
            {view === 'week' && (
              <WeekView startDate={currentDate.startOf('isoWeek')} items={items} onDrop={handleDrop} />
            )}

            {/* List View */}
            {view === 'list' && <ListView items={items} />}
          </>
        )}
      </div>
    </DndProvider>
  );
}
