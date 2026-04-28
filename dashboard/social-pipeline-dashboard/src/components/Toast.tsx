import { useEffect } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastProps {
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
  /** Auto-dismiss after this many ms. Default 4000. Pass 0 to disable. */
  durationMs?: number;
}

const STYLES: Record<
  ToastKind,
  { bg: string; border: string; text: string; icon: React.ComponentType<{ className?: string }> }
> = {
  success: {
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/40',
    text: 'text-emerald-200',
    icon: CheckCircle2,
  },
  error: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/40',
    text: 'text-red-200',
    icon: XCircle,
  },
  info: {
    bg: 'bg-indigo-500/15',
    border: 'border-indigo-500/40',
    text: 'text-indigo-200',
    icon: Info,
  },
};

export default function Toast({ kind, message, onDismiss, durationMs = 4000 }: ToastProps) {
  useEffect(() => {
    if (durationMs === 0) return;
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);

  const { bg, border, text, icon: Icon } = STYLES[kind];

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-[60] w-full max-w-sm">
      <div
        className={cn(
          'pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-2xl backdrop-blur-md animate-in slide-in-from-top-2',
          bg,
          border,
          text
        )}
      >
        <Icon className="h-5 w-5 shrink-0 mt-0.5" />
        <p className="flex-1 text-sm leading-relaxed">{message}</p>
        <button
          onClick={onDismiss}
          className="text-muted hover:text-secondaryText -mt-1 -mr-1 p-1 rounded transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
