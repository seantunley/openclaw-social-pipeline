import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Send,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import PipelineTimeline from '@/components/PipelineTimeline';
import DraftCard from '@/components/DraftCard';
import MediaCard from '@/components/MediaCard';
import { useRun, useRetryStage } from '@/hooks/useRuns';
import { useApproveRun, useRejectRun } from '@/hooks/useApprovals';
import {
  regenerateDraft,
  regenerateMedia,
  selectDraft,
  selectMedia,
  uploadToPostiz,
} from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';

const TABS = [
  'Brief',
  'Research',
  'Psychology',
  'Drafts',
  'Humanized',
  'Compliance',
  'Media',
  'Approval',
  'Postiz State',
  'Analytics',
] as const;

type Tab = (typeof TABS)[number];

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: run, isLoading, refetch } = useRun(id);
  const retryStage = useRetryStage();
  const approve = useApproveRun();
  const reject = useRejectRun();
  const [activeTab, setActiveTab] = useState<Tab>('Brief');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 rounded bg-white/5 animate-skeleton-pulse" />
        <div className="h-64 rounded-xl bg-white/5 animate-skeleton-pulse" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="text-center py-20">
        <p className="text-zinc-500">Run not found</p>
      </div>
    );
  }

  const handleAction = async (action: string, fn: () => Promise<any>) => {
    setActionLoading(action);
    try {
      await fn();
      refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const stageStatuses: Record<string, string> = run.stageStatuses || run.stages || {};

  const renderTabContent = () => {
    switch (activeTab) {
      case 'Brief':
        return (
          <div className="prose prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-zinc-300 bg-white/5 rounded-lg p-4 border border-white/10">
              {typeof run.brief === 'string'
                ? run.brief
                : JSON.stringify(run.brief, null, 2) || 'No brief generated yet'}
            </pre>
          </div>
        );

      case 'Research':
        return (
          <div className="prose prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-zinc-300 bg-white/5 rounded-lg p-4 border border-white/10">
              {typeof run.research === 'string'
                ? run.research
                : JSON.stringify(run.research, null, 2) || 'No research data yet'}
            </pre>
          </div>
        );

      case 'Psychology':
        return (
          <div className="prose prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-zinc-300 bg-white/5 rounded-lg p-4 border border-white/10">
              {typeof run.psychology === 'string'
                ? run.psychology
                : JSON.stringify(run.psychology || run.psychologyAnalysis, null, 2) ||
                  'No psychology analysis yet'}
            </pre>
          </div>
        );

      case 'Drafts': {
        const drafts = run.drafts || [];
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">{drafts.length} draft variant(s)</p>
              <button
                onClick={() =>
                  handleAction('regenerateDraft', () => regenerateDraft(id!))
                }
                disabled={actionLoading === 'regenerateDraft'}
                className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-zinc-300 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={cn(
                    'h-3.5 w-3.5',
                    actionLoading === 'regenerateDraft' && 'animate-spin'
                  )}
                />
                Regenerate
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {drafts.map((draft: any) => (
                <DraftCard
                  key={draft.id || draft._id}
                  draft={draft}
                  selected={draft.selected || run.selectedDraftId === (draft.id || draft._id)}
                  onSelect={(dId) =>
                    handleAction('selectDraft', () => selectDraft(id!, dId))
                  }
                />
              ))}
            </div>
            {drafts.length === 0 && (
              <p className="text-sm text-zinc-500 py-8 text-center">No drafts generated yet</p>
            )}
          </div>
        );
      }

      case 'Humanized':
        return (
          <div className="prose prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-zinc-300 bg-white/5 rounded-lg p-4 border border-white/10">
              {typeof run.humanized === 'string'
                ? run.humanized
                : JSON.stringify(run.humanized || run.humanizedContent, null, 2) ||
                  'No humanized content yet'}
            </pre>
          </div>
        );

      case 'Compliance':
        return (
          <div className="space-y-4">
            {run.compliance || run.complianceCheck ? (
              <div className="rounded-lg bg-white/5 border border-white/10 p-4">
                <div className="flex items-center gap-2 mb-3">
                  {(run.compliance?.passed ?? run.complianceCheck?.passed) ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-400" />
                  )}
                  <span className="text-sm font-medium text-zinc-200">
                    {(run.compliance?.passed ?? run.complianceCheck?.passed)
                      ? 'Compliance Passed'
                      : 'Compliance Issues Found'}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-zinc-300">
                  {JSON.stringify(run.compliance || run.complianceCheck, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-zinc-500 py-8 text-center">
                No compliance data yet
              </p>
            )}
          </div>
        );

      case 'Media': {
        const media = run.media || run.mediaAssets || [];
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">{media.length} media asset(s)</p>
              <button
                onClick={() =>
                  handleAction('regenerateMedia', () => regenerateMedia(id!))
                }
                disabled={actionLoading === 'regenerateMedia'}
                className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-zinc-300 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={cn(
                    'h-3.5 w-3.5',
                    actionLoading === 'regenerateMedia' && 'animate-spin'
                  )}
                />
                Regenerate Media
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {media.map((asset: any) => (
                <MediaCard
                  key={asset.id || asset._id}
                  asset={asset}
                  selected={
                    asset.selected || run.selectedMediaId === (asset.id || asset._id)
                  }
                  onSelect={(aId) =>
                    handleAction('selectMedia', () => selectMedia(id!, aId))
                  }
                />
              ))}
            </div>
            {media.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                <ImageIcon className="h-10 w-10 mb-3" />
                <p className="text-sm">No media generated yet</p>
              </div>
            )}
          </div>
        );
      }

      case 'Approval':
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-white/5 border border-white/10 p-4">
              <p className="text-sm text-muted mb-2">Approval Status</p>
              <StatusBadge status={run.approvalStatus || run.status} />
              {run.approvalNotes && (
                <p className="mt-3 text-sm text-zinc-300">{run.approvalNotes}</p>
              )}
              {run.rejectionReason && (
                <p className="mt-3 text-sm text-red-400">
                  Reason: {run.rejectionReason}
                </p>
              )}
            </div>
            {run.status === 'pending_approval' && (
              <div className="flex gap-3">
                <button
                  onClick={() =>
                    handleAction('approve', () =>
                      approve.mutateAsync({ id: id!, data: {} })
                    )
                  }
                  disabled={!!actionLoading}
                  className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Approve
                </button>
                <button
                  onClick={() =>
                    handleAction('reject', () =>
                      reject.mutateAsync({
                        id: id!,
                        data: { reason: 'Rejected from detail view' },
                      })
                    )
                  }
                  disabled={!!actionLoading}
                  className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </button>
              </div>
            )}
          </div>
        );

      case 'Postiz State':
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-white/5 border border-white/10 p-4">
              <pre className="whitespace-pre-wrap text-sm text-zinc-300">
                {JSON.stringify(run.postiz || run.postizState || {}, null, 2)}
              </pre>
            </div>
            {['approved', 'completed'].includes(run.status) && (
              <button
                onClick={() =>
                  handleAction('uploadPostiz', () => uploadToPostiz(id!))
                }
                disabled={!!actionLoading}
                className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-600 transition-colors disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {actionLoading === 'uploadPostiz' ? 'Uploading...' : 'Send to Postiz'}
              </button>
            )}
          </div>
        );

      case 'Analytics':
        return (
          <div className="rounded-lg bg-white/5 border border-white/10 p-4">
            {run.analytics ? (
              <pre className="whitespace-pre-wrap text-sm text-zinc-300">
                {JSON.stringify(run.analytics, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-zinc-500 py-8 text-center">
                No analytics data available yet
              </p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/runs')}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Runs
      </button>

      <div className="flex flex-wrap items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100">
              Run {(id || '').slice(0, 8)}
            </h1>
            <StatusBadge status={run.status} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted">
            {run.platform && <span className="capitalize">{run.platform}</span>}
            {run.campaign && (
              <>
                <span className="text-zinc-600">/</span>
                <span>{run.campaign}</span>
              </>
            )}
            <span className="text-zinc-600">/</span>
            <span>{formatDate(run.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-4">Pipeline Progress</h3>
            <PipelineTimeline
              currentStage={run.currentStage}
              stageStatuses={stageStatuses}
              onRetry={(stage) =>
                retryStage.mutate({ runId: id!, stage })
              }
            />
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="flex gap-1 border-b border-white/10 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                  activeTab === tab
                    ? 'text-indigo-400'
                    : 'text-zinc-500 hover:text-zinc-300'
                )}
              >
                {tab}
                {activeTab === tab && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
                )}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-6">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
