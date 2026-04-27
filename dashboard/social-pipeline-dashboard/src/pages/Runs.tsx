import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Search, Filter, X, Trash2 } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast, { type ToastKind } from '@/components/Toast';
import { useRuns, useCancelRun } from '@/hooks/useRuns';
import { deleteRun, cleanupCancelledRuns } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

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
  const t = useT();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');

  const { data, isLoading } = useRuns({
    search: search || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    platform: platformFilter !== 'all' ? platformFilter : undefined,
  });

  const cancelRun = useCancelRun();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<
    | { kind: 'delete-one'; id: string }
    | { kind: 'cleanup-cancelled' }
    | null
  >(null);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);

  const runs = data?.runs || data || [];
  const cancelledCount = (runs as any[]).filter((r: any) => r.status === 'cancelled').length;

  const performDelete = async (id: string) => {
    setBusy(`delete:${id}`);
    try {
      await deleteRun(id);
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      setToast({ kind: 'success', message: t('runs.toast.deleted', { id: id.slice(0, 8) }) });
    } catch (err) {
      setToast({ kind: 'error', message: t('runs.toast.delete_failed', { error: (err as Error).message }) });
    } finally {
      setBusy(null);
      setConfirmState(null);
    }
  };

  const performCleanupCancelled = async () => {
    setBusy('cleanup');
    try {
      const result = await cleanupCancelledRuns();
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      setToast({
        kind: 'success',
        message: t('runs.toast.cleanup_done', { count: result.trashed }),
      });
    } catch (err) {
      setToast({ kind: 'error', message: t('runs.toast.cleanup_failed', { error: (err as Error).message }) });
    } finally {
      setBusy(null);
      setConfirmState(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primaryText">{t('runs.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('runs.subtitle')}</p>
        </div>
        {cancelledCount > 0 && (
          <button
            onClick={() => setConfirmState({ kind: 'cleanup-cancelled' })}
            disabled={busy === 'cleanup'}
            className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {busy === 'cleanup'
              ? t('runs.removing')
              : t('runs.delete_cancelled', { count: cancelledCount })}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            type="text"
            placeholder={t('runs.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg bg-surface-soft border border-border-strong pl-10 pr-4 py-2.5 text-sm text-primaryText placeholder-muted focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-secondaryText"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg bg-surface-soft border border-border-strong px-3 py-2.5 text-sm text-secondaryText focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s} className="bg-card">
                {s === 'all' ? t('runs.filter.all_statuses') : t(`runs.status.${s}`)}
              </option>
            ))}
          </select>

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="rounded-lg bg-surface-soft border border-border-strong px-3 py-2.5 text-sm text-secondaryText focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
          >
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p} value={p} className="bg-card">
                {p === 'all' ? t('runs.filter.all_platforms') : p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ConfirmDialog
        open={confirmState?.kind === 'delete-one'}
        title={t('runs.confirm.delete_title')}
        destructive
        busy={busy?.startsWith('delete:') ?? false}
        message={
          <>
            <p>{t('runs.confirm.delete_body')}</p>
          </>
        }
        confirmLabel={t('runs.confirm.move_to_trash')}
        onConfirm={() => {
          if (confirmState?.kind === 'delete-one') performDelete(confirmState.id);
        }}
        onCancel={() => setConfirmState(null)}
      />

      <ConfirmDialog
        open={confirmState?.kind === 'cleanup-cancelled'}
        title={t('runs.confirm.cleanup_title', { count: cancelledCount })}
        destructive
        busy={busy === 'cleanup'}
        message={
          <>
            <p>{t('runs.confirm.cleanup_body')}</p>
          </>
        }
        confirmLabel={t('runs.confirm.trash_count', { count: cancelledCount })}
        onConfirm={performCleanupCancelled}
        onCancel={() => setConfirmState(null)}
      />

      {toast && (
        <Toast
          kind={toast.kind}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      )}

      <div className="rounded-xl border border-border-strong overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-strong bg-surface-faint">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                {t('runs.table.status')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                {t('runs.table.platform')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                {t('runs.table.campaign')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                {t('runs.table.created')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                {t('runs.table.scheduled')}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">
                {t('runs.table.actions')}
              </th>
            </tr>
          </thead>
          <tbody className={cn('divide-y', '[&>tr]:border-border-strong')}>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-4 py-4">
                    <div className="h-5 rounded bg-surface-soft animate-skeleton-pulse" />
                  </td>
                </tr>
              ))
            ) : (runs as any[]).length > 0 ? (
              (runs as any[]).map((run: any) => (
                <tr
                  key={run.id || run._id}
                  onClick={() => navigate(`/runs/${run.id || run._id}`)}
                  className="cursor-pointer hover:bg-surface-faint transition-colors border-t border-border-strong/40"
                >
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-secondaryText capitalize">
                    {run.platform || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondaryText">
                    {run.campaign || run.campaignName || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {formatDate(run.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
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
                        {t('runs.actions.view')}
                      </button>
                      {['running', 'pending', 'pending_approval'].includes(run.status) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelRun.mutate(run.id || run._id);
                          }}
                          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          {t('runs.actions.cancel')}
                        </button>
                      )}
                      {['cancelled', 'failed', 'completed'].includes(run.status) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmState({ kind: 'delete-one', id: run.id || run._id });
                          }}
                          disabled={busy === `delete:${run.id || run._id}`}
                          className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
                          title={t('runs.actions.delete_title')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted">
                  {t('runs.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
