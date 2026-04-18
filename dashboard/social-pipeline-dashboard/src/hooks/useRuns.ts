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
