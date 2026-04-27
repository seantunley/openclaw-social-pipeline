import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchRuns, fetchRun, createRun, retryStage, cancelRun, API_BASE, type RunFilters } from '@/lib/api';

export function useRuns(filters?: RunFilters) {
  return useQuery({
    queryKey: ['runs', filters],
    queryFn: () => fetchRuns(filters),
  });
}

export function useRun(id: string | undefined) {
  return useQuery({
    queryKey: ['run', id],
    queryFn: () => fetchRun(id!),
    enabled: !!id,
  });
}

/**
 * Live run stream. Subscribes to the SSE endpoint at
 * /api/social/runs/:id/events and refetches the full run whenever the
 * server reports a state change. Falls back to plain polling if the
 * EventSource fails (older browsers, blocked by network policy, etc).
 *
 * Phase D upgrade — Phase B's polling implementation lives in the
 * fallback path so behavior is unchanged when SSE isn't available.
 */
export function useLiveRun(id: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['run', id],
    queryFn: () => fetchRun(id!),
    enabled: !!id,
    // Polling fallback — only fires if SSE failed to attach. Once the
    // SSE listener is up it does the work and this stays idle.
    refetchInterval: (q) => {
      const status = (q.state.data as any)?.status;
      const terminal = ['pending_approval', 'approved', 'completed', 'failed', 'cancelled', 'rejected'];
      if (status && terminal.includes(status)) return false;
      // 8s — enough that the SSE path is the primary signal but slow
      // polling still recovers if the stream dies silently.
      return 8000;
    },
  });

  useEffect(() => {
    if (!id) return;
    let es: EventSource | null = null;
    let cancelled = false;
    try {
      es = new EventSource(`${API_BASE}/runs/${id}/events`);
      es.addEventListener('state', () => {
        if (cancelled) return;
        // Refetch the full run — the SSE event is just a "something
        // changed" nudge, not a complete payload.
        qc.invalidateQueries({ queryKey: ['run', id] });
      });
      es.addEventListener('done', () => {
        if (cancelled) return;
        qc.invalidateQueries({ queryKey: ['run', id] });
        es?.close();
      });
      es.onerror = () => {
        // Let the polling fallback take over. Closing avoids the
        // browser's auto-reconnect loop hammering a dead endpoint.
        es?.close();
      };
    } catch {
      // EventSource not available — polling continues to work.
    }
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [id, qc]);

  return query;
}

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => createRun(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  });
}

export function useRetryStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, stage }: { runId: string; stage: string }) =>
      retryStage(runId, stage),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['run', vars.runId] });
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelRun(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}
