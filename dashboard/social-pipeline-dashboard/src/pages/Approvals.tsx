import ApprovalCard from '@/components/ApprovalCard';
import { useRuns } from '@/hooks/useRuns';
import { useApproveRun, useRejectRun, useRequestRevision } from '@/hooks/useApprovals';
import { CheckSquare } from 'lucide-react';

export default function Approvals() {
  const { data, isLoading } = useRuns({ status: 'pending_approval' });
  const approve = useApproveRun();
  const rejectMut = useRejectRun();
  const reviseMut = useRequestRevision();

  const runs = data?.runs || data || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Pending Approvals</h1>
        <p className="mt-1 text-sm text-muted">Review and approve content before publishing</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 rounded-xl bg-white/5 border border-white/10 animate-skeleton-pulse"
            />
          ))}
        </div>
      ) : (runs as any[]).length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(runs as any[]).map((run: any) => (
            <ApprovalCard
              key={run.id || run._id}
              run={{
                id: run.id || run._id,
                platform: run.platform,
                campaign: run.campaign || run.campaignName,
                status: run.status,
                content:
                  run.humanized ||
                  run.humanizedContent ||
                  (run.drafts?.[0]?.content
                    ? run.drafts[0].content.slice(0, 200)
                    : undefined),
                mediaThumbnail:
                  run.media?.[0]?.thumbnailUrl ||
                  run.mediaAssets?.[0]?.thumbnailUrl,
                createdAt: run.createdAt,
              }}
              onApprove={(id, notes) =>
                approve.mutate({ id, data: { notes } })
              }
              onReject={(id, reason) =>
                rejectMut.mutate({ id, data: { reason } })
              }
              onRevise={(id, notes) =>
                reviseMut.mutate({ id, data: { notes } })
              }
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <CheckSquare className="h-12 w-12 mb-4 text-zinc-600" />
          <p className="text-lg font-medium text-zinc-400">All caught up</p>
          <p className="text-sm mt-1">No content pending approval</p>
        </div>
      )}
    </div>
  );
}
