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

export default function TrashPage() {
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
      setToast({ kind: 'success', message: `Run ${id.slice(0, 8)} restored.` });
    } catch (err) {
      setToast({ kind: 'error', message: `Restore failed: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const performPurge = async (id: string) => {
    setBusy(`purge:${id}`);
    try {
      await purgeTrashedRun(id);
      invalidateAll();
      setToast({ kind: 'success', message: `Run ${id.slice(0, 8)} permanently deleted.` });
    } catch (err) {
      setToast({ kind: 'error', message: `Purge failed: ${(err as Error).message}` });
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
        message: `Permanently deleted ${result.purged} run${result.purged === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      setToast({ kind: 'error', message: `Empty trash failed: ${(err as Error).message}` });
    } finally {
      setBusy(null);
      setConfirmState(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
            <Trash className="h-6 w-6" /> Trash
          </h1>
          <p className="mt-1 text-sm text-muted">
            Soft-deleted runs. Restore to bring them back, or empty the trash to free up space.
          </p>
        </div>
        {total > 0 && (
          <button
            onClick={() => setConfirmState({ kind: 'empty-trash' })}
            disabled={busy === 'empty'}
            className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {busy === 'empty' ? 'Emptying…' : `Empty trash (${total})`}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmState?.kind === 'purge-one'}
        title="Permanently delete this run?"
        destructive
        busy={busy?.startsWith('purge:') ?? false}
        message={
          <>
            <p>This run will be permanently removed along with its drafts, stages, media, and approval records.</p>
            <p className="mt-2 text-zinc-400">This cannot be undone.</p>
          </>
        }
        confirmLabel="Permanently delete"
        onConfirm={() => {
          if (confirmState?.kind === 'purge-one') performPurge(confirmState.id);
        }}
        onCancel={() => setConfirmState(null)}
      />

      <ConfirmDialog
        open={confirmState?.kind === 'empty-trash'}
        title={`Empty trash (${total} run${total === 1 ? '' : 's'})?`}
        destructive
        busy={busy === 'empty'}
        message={
          <>
            <p>
              Every run currently in the trash will be permanently removed along with its drafts, stages, media, and approval records.
            </p>
            <p className="mt-2 text-zinc-400">This cannot be undone.</p>
          </>
        }
        confirmLabel="Empty trash"
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

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03]">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                Status (when trashed)
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
                Trashed
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-4 py-4">
                    <div className="h-5 rounded bg-white/5 animate-skeleton-pulse" />
                  </td>
                </tr>
              ))
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center">
                  <Trash className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
                  <p className="text-sm text-zinc-500">Trash is empty.</p>
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr key={run.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-300 capitalize">
                    {run.platform}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-300">
                    {run.campaign}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {formatDate(run.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {formatRelative(run.deletedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleRestore(run.id)}
                        disabled={busy === `restore:${run.id}`}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                        title="Restore this run"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {busy === `restore:${run.id}` ? 'Restoring…' : 'Restore'}
                      </button>
                      <button
                        onClick={() => setConfirmState({ kind: 'purge-one', id: run.id })}
                        disabled={busy === `purge:${run.id}`}
                        className="rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Permanently delete"
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
