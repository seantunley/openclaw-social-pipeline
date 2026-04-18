import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'MMM d, yyyy HH:mm');
}

export function formatRelative(date: string | Date | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    published: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    in_progress: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    pending_approval: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    awaiting_approval: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    scheduled: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
    cancelled: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
    rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
    draft: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
    revision_requested: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  };
  return map[status?.toLowerCase()] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
}
