import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2, Trash } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast, { type ToastKind } from '@/components/Toast';
import {
  fetchTrash,
  restoreRun,
  purgeTrashedRun,
  emptyTrash,
} from '@/lib/api';
import { formatDate, formatRelative } from '@/lib/utils';
import { useT } from '@/lib/i18n';

export default function TrashPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);
  const [confirmState, setConfirmState] = useState<
    | { kind: 'purge-one'; id: string }
    | { kind: 'empty-trash' }
    | null
  >(null);

  const { data, isLoading } = useQuery({
    queryKey: ['trash'],
    queryFn: fetchTrash,
    refetchInterval: 30_000,
  });

  const runs = data?.runs ?? [];
  const total = runs.length;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['trash'] });
    queryClient.invalidateQueries({ queryKey: ['runs'] });
    queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  const handleRestore = async (id: string) => {
    setBusy(`restore:${id}`);
    try {
      await restoreRun(id);
      invalidateAll();
      setToast({ kind: 'success', message: t('trash.toast.restored', { id: id.slice(0, 8) }) });
    } catch (err) {
      setToast({ kind: 'error', message: t('trash.toast.restore_failed', { error: (err as Error).message }) });
    } finally {
      setBusy(null);
    }
  };

  const performPurge = async (id: string) => {
    setBusy(`purge:${id}`);
    try {
      await purgeTrashedRun(id);
      invalidateAll();
      setToast({ kind: 'success', message: t('trash.toast.purged', { id: id.slice(0, 8) }) });
    } catch (err) {
      setToast({ kind: 'error', message: t('trash.toast.purge_failed', { error: (err as Error).message }) });
    } finally {
      setBusy(null);
      setConfirmState(null);
    }
  };

  const performEmpty = async () => {
    setBusy('empty');
    try {
      const result = await emptyTrash();
      invalidateAll();
      setToast({
        kind: 'success',
        message: t('trash.toast.emptied', { count: result.purged }),
      });
    } catch (err) {
      setToast({ kind: 'error', message: t('trash.toast.empty_failed', { error: (err as Error).message }) });
    } finally {
      setBusy(null);
      setConfirmState(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primaryText flex items-center gap-2">
            <Trash className="h-6 w-6" /> {t('trash.title')}
          </h1>
          <p className="mt-1 text-sm text-muted">{t('trash.subtitle')}</p>
        </div>
        {total > 0 && (
          <button
            onClick={() => setConfirmState({ kind: 'empty-trash' })}
            disabled={busy === 'empty'}
            className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {busy === 'empty' ? t('trash.emptying') : t('trash.empty_count', { count: total })}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmState?.kind === 'purge-one'}
        title={t('trash.confirm.purge_title')}
        destructive
        busy={busy?.startsWith('purge:') ?? false}
        message={
          <>
            <p>{t('trash.confirm.purge_body')}</p>
            <p className="mt-2 text-muted">{t('trash.confirm.cannot_undo')}</p>
          </>
        }
        confirmLabel={t('trash.confirm.permanent_delete')}
        onConfirm={() => {
          if (confirmState?.kind === 'purge-one') performPurge(confirmState.id);
        }}
        onCancel={() => setConfirmState(null)}
      />

      <ConfirmDialog
        open={confirmState?.kind === 'empty-trash'}
        title={t('trash.confirm.empty_title', { count: total })}
        destructive
        busy={busy === 'empty'}
        message={
          <>
            <p>{t('trash.confirm.empty_body')}</p>
            <p className="mt-2 text-muted">{t('trash.confirm.cannot_undo')}</p>
          </>
        }
        confirmLabel={t('trash.confirm.empty_trash')}
        onConfirm={performEmpty}
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
                {t('trash.col.status')}
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
                {t('trash.col.trashed')}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">
                {t('runs.table.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-4 py-4">
                    <div className="h-5 rounded bg-surface-soft animate-skeleton-pulse" />
                  </td>
                </tr>
              ))
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center">
                  <Trash className="h-10 w-10 text-faint mx-auto mb-3" />
                  <p className="text-sm text-muted">{t('trash.empty')}</p>
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr key={run.id} className="hover:bg-surface-faint">
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-secondaryText capitalize">
                    {run.platform}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondaryText">
                    {run.campaign}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {formatDate(run.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {formatRelative(run.deletedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleRestore(run.id)}
                        disabled={busy === `restore:${run.id}`}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                        title={t('trash.action.restore_title')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {busy === `restore:${run.id}` ? t('trash.action.restoring') : t('trash.action.restore')}
                      </button>
                      <button
                        onClick={() => setConfirmState({ kind: 'purge-one', id: run.id })}
                        disabled={busy === `purge:${run.id}`}
                        className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
                        title={t('trash.action.purge_title')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
