/**
 * LiveRunPanel — in-place pipeline view for a freshly-started run.
 *
 * Shown inline in Composer right after AI Generate fires. Replaces the
 * previous fire-and-forget toast handoff: instead of "go look in
 * Approvals," the operator watches the 7-stage pipeline run live in the
 * same view they kicked it off from.
 *
 * Polls via useLiveRun (stops once the run reaches a terminal state).
 * Phase D will swap the polling for an SSE event stream without changing
 * this component's surface — the props stay the same.
 */

import { Link } from 'react-router-dom';
import { ExternalLink, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import PipelineTimeline from './PipelineTimeline';
import { useLiveRun } from '@/hooks/useRuns';
import { cn } from '@/lib/utils';

interface LiveRunPanelProps {
  runId: string;
  onDismiss: () => void;
}

export default function LiveRunPanel({ runId, onDismiss }: LiveRunPanelProps) {
  const { data: run, isLoading } = useLiveRun(runId);

  const status = (run?.status ?? 'running') as string;
  const approvalStatus = (run?.approvalStatus ?? '') as string;
  const stageStatuses: Record<string, string> = run?.stageStatuses || run?.stages || {};
  const errorMessage: string | undefined = run?.error_message || run?.errorMessage;

  // Headline copy reflects where in the lifecycle the run is. Specific
  // states get specific framing — vague "Working…" is the worst-case
  // fallback.
  const headline = (() => {
    if (status === 'failed') return 'Run failed';
    if (status === 'cancelled') return 'Run cancelled';
    if (status === 'pending_approval') return 'Ready for your review';
    if (status === 'approved' || approvalStatus === 'approved') return 'Approved';
    if (status === 'completed') return 'Completed';
    if (status === 'running') return 'Running pipeline…';
    return 'Working…';
  })();

  const accent = (() => {
    if (status === 'failed') return 'border-red-500/40 bg-red-500/5';
    if (status === 'pending_approval') return 'border-brand-purple/40 bg-brand-purple/10';
    if (status === 'approved' || status === 'completed') return 'border-emerald-500/40 bg-emerald-500/5';
    return 'border-border-strong bg-surface-soft';
  })();

  // Pull a one-line excerpt of the current draft so the operator sees
  // content emerging as stages complete. Falls back through the chain that
  // matches what the engine writes at each stage.
  const draft = run?.drafts?.[0] || null;
  const excerpt: string | null =
    run?.humanizedContent ||
    run?.humanized ||
    draft?.final_content ||
    draft?.humanized_content ||
    draft?.raw_content ||
    null;

  return (
    <div className={cn('rounded-xl border p-4 space-y-4', accent)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-primaryText">{headline}</p>
            <code className="text-[11px] text-muted truncate">{runId}</code>
          </div>
          <p className="mt-0.5 text-[11px] text-muted">
            {run?.platform && (
              <>
                <span className="capitalize">{run.platform}</span> ·{' '}
              </>
            )}
            {run?.brief?.topic || run?.topic || (isLoading ? 'Starting…' : '—')}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Link
            to={`/runs/${runId}`}
            className="flex items-center gap-1 rounded-md border border-border-strong px-2 py-1 text-[11px] text-secondaryText hover:bg-surface-medium"
          >
            Open full details
            <ExternalLink className="h-3 w-3" />
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss live run panel"
            className="rounded p-1 text-muted hover:bg-surface-medium hover:text-secondaryText"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <PipelineTimeline currentStage={run?.currentStage} stageStatuses={stageStatuses} />

      {excerpt && (
        <div className="rounded-md border border-border-strong bg-surface-faint p-3">
          <p className="mb-1 text-[10px] uppercase tracking-widest text-muted">Latest draft</p>
          <p className="text-sm text-secondaryText whitespace-pre-wrap line-clamp-6">{excerpt}</p>
        </div>
      )}

      {status === 'pending_approval' && (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/runs/${runId}`}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-purple to-brand-pink px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approve & schedule
          </Link>
        </div>
      )}

      {status === 'failed' && errorMessage && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300 whitespace-pre-wrap">{errorMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
}
