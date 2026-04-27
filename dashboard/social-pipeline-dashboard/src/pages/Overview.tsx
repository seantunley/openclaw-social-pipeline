import { Link } from 'react-router-dom';
import { Play, Clock, CalendarDays, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import StatCard from '@/components/StatCard';
import StatusBadge from '@/components/StatusBadge';
import { useSummary } from '@/hooks/useSummary';
import { formatDate, formatRelative } from '@/lib/utils';
import { useT } from '@/lib/i18n';

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  running: '#3b82f6',
  pending_approval: '#f59e0b',
  scheduled: '#6366f1',
  failed: '#ef4444',
  cancelled: '#71717a',
};

export default function Overview() {
  const t = useT();
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
        <h1 className="text-2xl font-bold text-primaryText">{t('overview.title')}</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-32 rounded-xl bg-surface-soft border border-border-strong animate-skeleton-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-primaryText">{t('overview.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('overview.subtitle')}</p>
      </div>

      {/* Phase E: "What needs your attention" — surfaces actionable
          counts at the top of the page so the operator's first read is
          "what should I work on now," not "here are stats." Hidden when
          there's nothing pending. */}
      {(summary.pendingApproval > 0 || (summary.recentFailures || []).length > 0) && (
        <div className="rounded-xl border border-brand-purple/30 bg-brand-purple/5 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-brand-cyan">
              {t('overview.needs_attention')}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {summary.pendingApproval > 0 && (
              <Link
                to="/approvals"
                className="group flex items-center justify-between rounded-lg border border-border-strong bg-surface-faint px-4 py-3 hover:bg-surface-soft transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-amber-400" />
                  <div>
                    <p className="text-sm font-medium text-primaryText">
                      {t('overview.attention.pending', { count: summary.pendingApproval })}
                    </p>
                    <p className="text-[11px] text-muted">{t('overview.attention.pending_hint')}</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted group-hover:text-secondaryText" />
              </Link>
            )}
            {(summary.recentFailures || []).length > 0 && (
              <Link
                to="/runs?status=failed"
                className="group flex items-center justify-between rounded-lg border border-border-strong bg-surface-faint px-4 py-3 hover:bg-surface-soft transition-colors"
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                  <div>
                    <p className="text-sm font-medium text-primaryText">
                      {t('overview.attention.failures', { count: (summary.recentFailures || []).length })}
                    </p>
                    <p className="text-[11px] text-muted">{t('overview.attention.failures_hint')}</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted group-hover:text-secondaryText" />
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('overview.stat.total_runs')}
          value={summary.totalRuns}
          icon={Play}
          gradient="from-blue-500/20 to-cyan-500/20"
        />
        <StatCard
          label={t('overview.stat.pending_approval')}
          value={summary.pendingApproval}
          icon={Clock}
          gradient="from-amber-500/20 to-orange-500/20"
        />
        <StatCard
          label={t('overview.stat.scheduled')}
          value={summary.scheduled}
          icon={CalendarDays}
          gradient="from-indigo-500/20 to-purple-500/20"
        />
        <StatCard
          label={t('overview.stat.published')}
          value={summary.published}
          icon={CheckCircle2}
          gradient="from-emerald-500/20 to-teal-500/20"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-border-strong bg-surface-soft backdrop-blur-sm p-6">
          <h2 className="text-lg font-semibold text-primaryText mb-4">{t('overview.status_breakdown')}</h2>
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
              {t('overview.no_data')}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-border-strong bg-surface-soft backdrop-blur-sm p-6">
            <h2 className="text-lg font-semibold text-primaryText mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              {t('overview.recent_failures')}
            </h2>
            {(summary.recentFailures || []).length > 0 ? (
              <div className="space-y-3">
                {summary.recentFailures.map((run: any) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between rounded-lg bg-red-500/5 border border-red-500/10 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-secondaryText">
                        {run.campaign || run.id}
                      </p>
                      <p className="text-xs text-muted">
                        {run.failedStage || t('overview.unknown_stage')} &middot;{' '}
                        {formatRelative(run.updatedAt)}
                      </p>
                    </div>
                    <StatusBadge status="failed" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">{t('overview.no_failures')}</p>
            )}
          </div>

          <div className="rounded-xl border border-border-strong bg-surface-soft backdrop-blur-sm p-6">
            <h2 className="text-lg font-semibold text-primaryText mb-4 flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-indigo-400" />
              {t('overview.upcoming_scheduled')}
            </h2>
            {(summary.upcomingScheduled || []).length > 0 ? (
              <div className="space-y-3">
                {summary.upcomingScheduled.map((run: any) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between rounded-lg bg-surface-soft px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-secondaryText">
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
              <p className="text-sm text-muted">{t('overview.no_upcoming')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
