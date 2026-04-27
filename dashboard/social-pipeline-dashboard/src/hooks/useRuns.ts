import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchRuns, fetchRun, createRun, retryStage, cancelRun, type RunFilters } from '@/lib/api';

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
 * Variant of useRun that polls while the run is still in-progress.
 * Stops as soon as the run reaches a terminal state (pending_approval,
 * approved, completed, failed, cancelled). Used by Composer's live
 * pipeline panel; superseded by the SSE event stream in Phase D.
 */
export function useLiveRun(id: string | undefined) {
  return useQuery({
    queryKey: ['run', id],
    queryFn: () => fetchRun(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.status;
      const terminal = ['pending_approval', 'approved', 'completed', 'failed', 'cancelled', 'rejected'];
      if (status && terminal.includes(status)) return false;
      return 2000;
    },
  });
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
