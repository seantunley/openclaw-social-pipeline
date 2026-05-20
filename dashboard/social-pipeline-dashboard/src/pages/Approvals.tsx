import { useNavigate } from 'react-router-dom';
import ApprovalCard from '@/components/ApprovalCard';
import { useRuns } from '@/hooks/useRuns';
import { useApproveRun, useRejectRun, useRequestRevision } from '@/hooks/useApprovals';
import { CheckSquare } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function Approvals() {
  const navigate = useNavigate();
  const t = useT();
  const { data, isLoading } = useRuns({ status: 'pending_approval' });
  const approve = useApproveRun();
  const rejectMut = useRejectRun();
  const reviseMut = useRequestRevision();

  const runs = (data?.runs || data || []) as any[];
  const firstId = runs[0]?.id || runs[0]?._id;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primaryText">{t('approvals.title')}</h1>
          <p className="mt-1 text-sm text-muted">
            {runs.length > 0
              ? t('approvals.waiting_count', { count: runs.length })
              : t('approvals.subtitle')}
          </p>
        </div>
        {firstId && (
          <button
            onClick={() => navigate(`/runs/${firstId}`)}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-purple to-brand-pink px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            {t('approvals.review_next')} →
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 rounded-xl bg-surface-soft border border-border-strong animate-skeleton-pulse"
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
                topic: run.topic || run.config_snapshot?.brief?.topic,
                platform: run.platform,
                campaign: run.campaign || run.campaignName,
                status: run.status,
                content:
                  run.draftPreview ||
                  run.humanized ||
                  run.humanizedContent ||
                  (run.drafts?.[0]?.content
                    ? run.drafts[0].content.slice(0, 600)
                    : undefined),
                mediaThumbnail:
                  run.mediaThumbnail ||
                  run.media?.[0]?.thumbnailUrl ||
                  run.mediaAssets?.[0]?.thumbnailUrl,
                createdAt: run.createdAt,
                scheduledAt: run.scheduledAt,
              }}
              onOpen={(id) => navigate(`/runs/${id}`)}
              onApprove={(id, notes) =>
                approve.mutate({ id, data: { notes } })
              }
              onReject={(id, reason) =>
                rejectMut.mutate({ id, data: { notes: reason } })
              }
              onRevise={(id, notes) =>
                reviseMut.mutate({ id, data: { notes } })
              }
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-muted">
          <CheckSquare className="h-12 w-12 mb-4 text-faint" />
          <p className="text-lg font-medium text-secondaryText">{t('approvals.all_caught_up')}</p>
          <p className="text-sm mt-1">{t('approvals.empty')}</p>
        </div>
      )}
    </div>
  );
}
