import { useQuery } from '@tanstack/react-query';
import { fetchSummary } from '@/lib/api';

export function useSummary() {
  return useQuery({
    queryKey: ['summary'],
    queryFn: fetchSummary,
    refetchInterval: 30_000,
  });
}
