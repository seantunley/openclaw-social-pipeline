import { Play, Clock, CalendarDays, CheckCircle2, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import StatCard from '@/components/StatCard';
import StatusBadge from '@/components/StatusBadge';
import { useSummary } from '@/hooks/useSummary';
import { formatDate, formatRelative } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  running: '#3b82f6',
  pending_approval: '#f59e0b',
  scheduled: '#6366f1',
  failed: '#ef4444',
  cancelled: '#71717a',
};

export default function Overview() {
  const { data, isLoading } = useSummary();

  const summary = data || {
    totalRuns: 0,
    pendingApproval: 0,
    scheduled: 0,
    published: 0,
    statusBreakdown: [],
    recentFailures: [],
    upcomingScheduled: [],
  };

  const chartData = (summary.statusBreakdown || []).map((s: any) => ({
    name: s.status?.replace(/_/g, ' ') || '',
    count: s.count || 0,
    color: STATUS_COLORS[s.status] || '#71717a',
  }));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-zinc-100">Overview</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-32 rounded-xl bg-white/5 border border-white/10 animate-skeleton-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Overview</h1>
        <p className="mt-1 text-sm text-muted">Pipeline performance at a glance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Runs"
          value={summary.totalRuns}
          icon={Play}
          gradient="from-blue-500/20 to-cyan-500/20"
        />
        <StatCard
          label="Pending Approval"
          value={summary.pendingApproval}
          icon={Clock}
          gradient="from-amber-500/20 to-orange-500/20"
        />
        <StatCard
          label="Scheduled"
          value={summary.scheduled}
          icon={CalendarDays}
          gradient="from-indigo-500/20 to-purple-500/20"
        />
        <StatCard
          label="Published"
          value={summary.published}
          icon={CheckCircle2}
          gradient="from-emerald-500/20 to-teal-500/20"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-6">
          <h2 className="text-lg font-semibold text-zinc-100 mb-4">Status Breakdown</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#a1a1aa', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#a1a1aa', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111113',
                    border: '1px solid #27272a',
                    borderRadius: '8px',
                    color: '#f4f4f5',
                    fontSize: '13px',
                  }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-zinc-500 text-sm">
              No data available
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-6">
            <h2 className="text-lg font-semibold text-zinc-100 mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Recent Failures
            </h2>
            {(summary.recentFailures || []).length > 0 ? (
              <div className="space-y-3">
                {summary.recentFailures.map((run: any) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between rounded-lg bg-red-500/5 border border-red-500/10 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-200">
                        {run.campaign || run.id}
                      </p>
                      <p className="text-xs text-muted">
                        {run.failedStage || 'Unknown stage'} &middot;{' '}
                        {formatRelative(run.updatedAt)}
                      </p>
                    </div>
                    <StatusBadge status="failed" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No recent failures</p>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-6">
            <h2 className="text-lg font-semibold text-zinc-100 mb-4 flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-indigo-400" />
              Upcoming Scheduled
            </h2>
            {(summary.upcomingScheduled || []).length > 0 ? (
              <div className="space-y-3">
                {summary.upcomingScheduled.map((run: any) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-200">
                        {run.campaign || run.id}
                      </p>
                      <p className="text-xs text-muted">
                        {run.platform} &middot; {formatDate(run.scheduledAt)}
                      </p>
                    </div>
                    <StatusBadge status="scheduled" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No upcoming posts</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
