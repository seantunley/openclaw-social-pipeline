import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, X } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { useRuns, useCancelRun } from '@/hooks/useRuns';
import { formatDate, cn } from '@/lib/utils';

const STATUS_OPTIONS = [
  'all',
  'running',
  'pending_approval',
  'approved',
  'scheduled',
  'published',
  'failed',
  'cancelled',
];

const PLATFORM_OPTIONS = ['all', 'twitter', 'linkedin', 'instagram', 'facebook', 'tiktok'];

export default function Runs() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');

  const { data, isLoading } = useRuns({
    search: search || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    platform: platformFilter !== 'all' ? platformFilter : undefined,
  });

  const cancelRun = useCancelRun();

  const runs = data?.runs || data || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Pipeline Runs</h1>
        <p className="mt-1 text-sm text-muted">View and manage content pipeline runs</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search runs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg bg-white/5 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-zinc-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s} className="bg-card">
                {s === 'all' ? 'All Statuses' : s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
          >
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p} value={p} className="bg-card">
                {p === 'all' ? 'All Platforms' : p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03]">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                Platform
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                Campaign
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                Scheduled
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-4 py-4">
                    <div className="h-5 rounded bg-white/5 animate-skeleton-pulse" />
                  </td>
                </tr>
              ))
            ) : (runs as any[]).length > 0 ? (
              (runs as any[]).map((run: any) => (
                <tr
                  key={run.id || run._id}
                  onClick={() => navigate(`/runs/${run.id || run._id}`)}
                  className="cursor-pointer hover:bg-white/[0.03] transition-colors"
                >
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-300 capitalize">
                    {run.platform || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-300">
                    {run.campaign || run.campaignName || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {formatDate(run.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {formatDate(run.scheduledAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/runs/${run.id || run._id}`);
                        }}
                        className="rounded-md px-2.5 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                      >
                        View
                      </button>
                      {['running', 'pending', 'pending_approval'].includes(run.status) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelRun.mutate(run.id || run._id);
                          }}
                          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-zinc-500">
                  No runs found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
