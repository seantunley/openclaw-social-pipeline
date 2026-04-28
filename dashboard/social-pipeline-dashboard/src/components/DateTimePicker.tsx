import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DateTimePickerProps {
  value: Date;
  onChange: (d: Date) => void;
  min?: Date;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Build a 6-row x 7-col grid of dates for a given month, Monday-first.
function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // JS getDay: 0=Sun..6=Sat. We want Monday-first, so shift.
  const shift = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - shift);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export default function DateTimePicker({ value, onChange, min }: DateTimePickerProps) {
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());

  const today = startOfDay(new Date());
  const minDay = min ? startOfDay(min) : null;

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const stepMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const pickDay = (d: Date) => {
    if (minDay && startOfDay(d) < minDay) return;
    const next = new Date(d);
    next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    onChange(next);
  };

  const setHour = (h: number) => {
    const next = new Date(value);
    next.setHours(Math.max(0, Math.min(23, h)));
    onChange(next);
  };

  const setMinute = (m: number) => {
    const next = new Date(value);
    next.setMinutes(Math.max(0, Math.min(59, m)));
    onChange(next);
  };

  return (
    <div className="rounded-md border border-border-strong bg-black/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => stepMonth(-1)}
          className="rounded p-1 text-muted hover:bg-surface-soft hover:text-secondaryText"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-xs font-medium text-secondaryText">
          {MONTHS[viewMonth]} {viewYear}
        </div>
        <button
          type="button"
          onClick={() => stepMonth(1)}
          className="rounded p-1 text-muted hover:bg-surface-soft hover:text-secondaryText"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[10px] text-muted">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((d) => {
          const inMonth = d.getMonth() === viewMonth;
          const isSelected = sameDay(d, value);
          const isToday = sameDay(d, today);
          const disabled = !!minDay && startOfDay(d) < minDay;
          return (
            <button
              key={d.toISOString()}
              type="button"
              disabled={disabled}
              onClick={() => pickDay(d)}
              className={cn(
                'h-7 rounded text-[11px] transition-colors',
                disabled && 'text-faint cursor-not-allowed',
                !disabled && !isSelected && inMonth && 'text-secondaryText hover:bg-surface-medium',
                !disabled && !isSelected && !inMonth && 'text-faint hover:bg-surface-soft',
                !isSelected && isToday && 'font-semibold text-brand-cyan',
                isSelected && 'bg-brand-purple text-white font-semibold hover:bg-brand-purple/90',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-border-strong pt-3">
        <span className="text-[11px] text-muted">Time</span>
        <input
          type="number"
          min={0}
          max={23}
          value={value.getHours()}
          onChange={(e) => setHour(Number(e.target.value))}
          className="w-14 rounded border border-border-strong bg-black/40 px-2 py-1 text-sm text-primaryText focus:outline-none focus:ring-1 focus:ring-brand-purple/40"
        />
        <span className="text-muted">:</span>
        <input
          type="number"
          min={0}
          max={59}
          step={5}
          value={value.getMinutes().toString().padStart(2, '0')}
          onChange={(e) => setMinute(Number(e.target.value))}
          className="w-14 rounded border border-border-strong bg-black/40 px-2 py-1 text-sm text-primaryText focus:outline-none focus:ring-1 focus:ring-brand-purple/40"
        />
        <span className="ml-auto text-[11px] text-muted">
          {value.toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
}
