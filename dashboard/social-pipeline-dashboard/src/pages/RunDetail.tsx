import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Send,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
  Pencil,
  Save,
  Play,
  Activity,
  TrendingUp,
  ShieldCheck,
  BookOpen,
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import PipelineTimeline from '@/components/PipelineTimeline';
import DraftCard from '@/components/DraftCard';
import MediaCard from '@/components/MediaCard';
import PostPreview from '@/components/PostPreview';
import BeforeAfter from '@/components/BeforeAfter';
import ScheduleModal from '@/components/ScheduleModal';
import type { PlatformId } from '@/lib/platforms';
import { useRun, useRetryStage, useRuns } from '@/hooks/useRuns';
import { useApproveRun, useRejectRun } from '@/hooks/useApprovals';
import { useQuery } from '@tanstack/react-query';
import { fetchEnvStatus } from '@/lib/api';
import {
  regenerateDraft,
  regenerateMedia,
  selectDraft,
  selectMedia,
  uploadToPostiz,
  editDraft,
  rerunRun,
  improveReadability,
} from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

const TABS = [
  'Preview',
  'Brief',
  'Research',
  'SEO/GEO',
  'Psychology',
  'Drafts',
  'Humanized',
  'Compliance',
  'Readability',
  'Media',
  'Approval',
  'Postiz State',
  'Analytics',
] as const;

type Tab = (typeof TABS)[number];

// Maps tab name to its translation key. Kept in one place so the tab list
// and the strip render stay in lockstep — adding a tab means adding a
// branch here and a key in locales.
function tabLabel(t: (k: string) => string, tab: Tab): string {
  const map: Record<Tab, string> = {
    'Preview': 'rundetail.tab.preview',
    'Brief': 'rundetail.tab.brief',
    'Research': 'rundetail.tab.research',
    'SEO/GEO': 'rundetail.tab.seo_geo',
    'Psychology': 'rundetail.tab.psychology',
    'Drafts': 'rundetail.tab.drafts',
    'Humanized': 'rundetail.tab.humanized',
    'Compliance': 'rundetail.tab.compliance',
    'Readability': 'rundetail.tab.readability',
    'Media': 'rundetail.tab.media',
    'Approval': 'rundetail.tab.approval',
    'Postiz State': 'rundetail.tab.postiz',
    'Analytics': 'rundetail.tab.analytics',
  };
  return t(map[tab]);
}

export default function RunDetail() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: run, isLoading, refetch } = useRun(id);
  // Pull the pending-approval queue so we can offer a "Next pending" jump
  // from the Approval tab — Phase A audit win.
  const { data: pendingData } = useRuns({ status: 'pending_approval' });
  const pendingRuns = ((pendingData as any)?.runs || pendingData || []) as Array<{ id?: string; _id?: string }>;
  const nextPendingId = pendingRuns
    .map((r) => r.id || r._id)
    .find((rid) => rid && rid !== id) as string | undefined;
  const retryStage = useRetryStage();
  // Hide the Postiz State tab when Postiz isn't connected — it's a raw
  // JSON debug surface that's empty until POSTIZ_API_KEY is set, and an
  // empty debug tab reads as broken to non-developer operators.
  const { data: envStatus } = useQuery({
    queryKey: ['env-status'],
    queryFn: fetchEnvStatus,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const postizConnected = (envStatus?.postiz ?? []).some(
    (v) => v.name === 'POSTIZ_API_KEY' && v.set,
  );
  const visibleTabs = TABS.filter((tab) => tab !== 'Postiz State' || postizConnected);
  const approve = useApproveRun();
  const reject = useRejectRun();
  const [activeTab, setActiveTab] = useState<Tab>('Preview');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Approval flow: after a successful approve, immediately pop the schedule
  // modal so the operator picks WHEN this approved post should publish.
  // Run status stays 'approved' through the modal; scheduled_at column
  // captures the publish time.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Tracks whether the operator has manually clicked a tab. We auto-pick a
  // sensible default tab based on run status the first time the run loads,
  // but never overwrite an explicit selection.
  const [tabPinned, setTabPinned] = useState(false);

  // Default-tab logic: land on the tab that matches the operator's most
  // likely intent for the current run state. This is one of the audit's
  // Phase-A wins — Approval used to be the 11th of 13 tabs, two clicks
  // from the post-load Preview default.
  useEffect(() => {
    if (tabPinned || !run) return;
    const status = run.status as string | undefined;
    const approvalStatus = run.approvalStatus as string | undefined;
    const needsApproval = status === 'pending_approval';
    const approvedNeedsSchedule =
      (status === 'approved' || approvalStatus === 'approved') && !run.scheduledAt;
    if (needsApproval || approvedNeedsSchedule) {
      setActiveTab('Approval');
    } else if (status === 'completed') {
      setActiveTab('Analytics');
    }
    // else: leave on 'Preview' (the initial state).
  }, [run, tabPinned]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 rounded bg-surface-soft animate-skeleton-pulse" />
        <div className="h-64 rounded-xl bg-surface-soft animate-skeleton-pulse" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="text-center py-20">
        <p className="text-muted">{t('rundetail.not_found')}</p>
      </div>
    );
  }

  const handleAction = async (action: string, fn: () => Promise<any>) => {
    setActionLoading(action);
    setActionError(null);
    try {
      await fn();
      refetch();
    } catch (err) {
      // Surface the failure visibly — silent failure is the anti-pattern.
      const message = err instanceof Error ? err.message : String(err);
      console.error(err);
      setActionError(`${action} failed: ${message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const stageStatuses: Record<string, string> = run.stageStatuses || run.stages || {};

  const renderTabContent = () => {
    switch (activeTab) {
      case 'Preview': {
        return <PreviewPane run={run} runId={id!} onAction={handleAction} actionLoading={actionLoading} refetch={refetch} />;
      }
      case 'Brief':
        return (
          <div className="prose prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-secondaryText bg-surface-soft rounded-lg p-4 border border-border-strong">
              {typeof run.brief === 'string'
                ? run.brief
                : JSON.stringify(run.brief, null, 2) || 'No brief generated yet'}
            </pre>
          </div>
        );

      case 'Research':
        return (
          <div className="prose prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-secondaryText bg-surface-soft rounded-lg p-4 border border-border-strong">
              {typeof run.research === 'string'
                ? run.research
                : JSON.stringify(run.research, null, 2) || 'No research data yet'}
            </pre>
          </div>
        );

      case 'SEO/GEO':
        return <SeoGeoTab run={run} />;

      case 'Readability':
        return <ReadabilityTab run={run} runId={id!} refetch={refetch} />;

      case 'Psychology': {
        const psy = run.psychology;
        // New shape: { before, after, principlesApplied, changes }
        // Old shape (legacy): a plain string of the enhanced text.
        if (psy && typeof psy === 'object' && 'after' in psy) {
          return (
            <BeforeAfter
              beforeLabel="Pre-psychology draft"
              afterLabel="After psychology pass"
              before={psy.before}
              after={psy.after}
              appliedLabel="Principles applied"
              applied={psy.principlesApplied ?? []}
              changes={psy.changes ?? []}
            />
          );
        }
        // Fallback for older runs that have only the enhanced string.
        return (
          <BeforeAfter
            beforeLabel="Pre-psychology draft"
            afterLabel="After psychology pass"
            before={null}
            after={typeof psy === 'string' ? psy : null}
          />
        );
      }

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
                className="flex items-center gap-2 rounded-lg bg-surface-soft border border-border-strong px-3 py-2 text-sm text-secondaryText hover:bg-surface-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={cn(
                    'h-3.5 w-3.5',
                    actionLoading === 'regenerateDraft' && 'animate-spin'
                  )}
                />
                {t('rundetail.regenerate')}
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
              <p className="text-sm text-muted py-8 text-center">{t('rundetail.no_drafts')}</p>
            )}
          </div>
        );
      }

      case 'Humanized': {
        const det = run.humanizedDetail;
        if (det && (det.before || det.after)) {
          return (
            <BeforeAfter
              beforeLabel="Pre-humanizer (post-psychology)"
              afterLabel="After humanizer"
              before={det.before}
              after={det.after}
              appliedLabel="AI patterns removed"
              applied={det.patternsRemoved ?? []}
              changes={det.changes ?? []}
            />
          );
        }
        return (
          <BeforeAfter
            beforeLabel="Pre-humanizer (post-psychology)"
            afterLabel="After humanizer"
            before={null}
            after={typeof run.humanized === 'string' ? run.humanized : null}
          />
        );
      }

      case 'Compliance':
        return (
          <div className="space-y-4">
            {run.compliance || run.complianceCheck ? (
              <div className="rounded-lg bg-surface-soft border border-border-strong p-4">
                <div className="flex items-center gap-2 mb-3">
                  {(run.compliance?.passed ?? run.complianceCheck?.passed) ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-400" />
                  )}
                  <span className="text-sm font-medium text-secondaryText">
                    {(run.compliance?.passed ?? run.complianceCheck?.passed)
                      ? 'Compliance Passed'
                      : 'Compliance Issues Found'}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-secondaryText">
                  {JSON.stringify(run.compliance || run.complianceCheck, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-muted py-8 text-center">
                {t('rundetail.no_compliance')}
              </p>
            )}
          </div>
        );

      case 'Media': {
        const media = (run.media || run.mediaAssets || []) as any[];
        // Show only the most-recent ('hosted') assets by default; superseded
        // ones from prior regenerations are kept in DB but hidden here.
        const visible = media.filter((m: any) => (m.status ?? 'hosted') !== 'superseded');
        return (
          <MediaTab
            runId={id!}
            assets={visible}
            selectedMediaId={run.selectedMediaId}
            actionLoading={actionLoading}
            onRegenerate={(prompt) =>
              handleAction('regenerateMedia', () => regenerateMedia(id!, prompt))
            }
            onSelect={(aId) =>
              handleAction('selectMedia', () => selectMedia(id!, aId))
            }
          />
        );
      }

      case 'Approval':
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-surface-soft border border-border-strong p-4">
              <p className="text-sm text-muted mb-2">{t('rundetail.approval_status')}</p>
              <StatusBadge status={run.approvalStatus || run.status} />
              {run.approvalNotes && (
                <p className="mt-3 text-sm text-secondaryText">{run.approvalNotes}</p>
              )}
              {run.rejectionReason && (
                <p className="mt-3 text-sm text-red-400">
                  Reason: {run.rejectionReason}
                </p>
              )}
            </div>
            {run.status === 'pending_approval' && (
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={async () => {
                    // Approve, then open the scheduling modal so the
                    // operator picks a publish time. Approve happens first
                    // (atomic) so even if the modal is dismissed the run
                    // is marked approved — scheduled_at can be set later
                    // from the calendar drag-and-drop.
                    setActionLoading('approve');
                    setActionError(null);
                    try {
                      await approve.mutateAsync({
                        id: id!,
                        data: { notes: 'Approved from dashboard' },
                      });
                      refetch();
                      setScheduleOpen(true);
                    } catch (err) {
                      setActionError(`approve failed: ${(err as Error).message}`);
                    } finally {
                      setActionLoading(null);
                    }
                  }}
                  disabled={!!actionLoading}
                  className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {t('rundetail.approve_schedule')} {actionLoading === 'approve' && '…'}
                </button>
                <button
                  onClick={() => {
                    // Reject must carry a note — that's both an engine
                    // requirement and the input the rule-extractor uses to
                    // turn rejections into binding rules for future runs.
                    const notes = window.prompt(
                      'Why is this being rejected?\n(This becomes a learning rule for future runs.)',
                    );
                    if (!notes || !notes.trim()) return;
                    handleAction('reject', () =>
                      reject.mutateAsync({ id: id!, data: { notes: notes.trim() } }),
                    );
                  }}
                  disabled={!!actionLoading}
                  className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" />
                  {t('rundetail.reject')} {actionLoading === 'reject' && '…'}
                </button>
              </div>
            )}
            {/* Approved but not yet scheduled: surface a "Schedule publish"
                button so the operator can pick a time without re-approving.
                We accept either run.status='approved' or approvalStatus from
                the draft — older runs were left in 'running' by a bug, but
                their draft is correctly marked approved. */}
            {(run.status === 'approved' || run.approvalStatus === 'approved') && !run.scheduledAt && (
              <button
                onClick={() => setScheduleOpen(true)}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-purple to-brand-pink px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
              >
                <CheckCircle2 className="h-4 w-4" />
                {t('rundetail.schedule_publish')}
              </button>
            )}
            {/* Already scheduled: show the time and let the operator change it. */}
            {(run.status === 'approved' || run.approvalStatus === 'approved') && run.scheduledAt && (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-secondaryText font-medium">
                    Scheduled to publish {new Date(run.scheduledAt).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-muted">
                    Approved · {new Date(run.scheduledAt).toLocaleString(undefined, { weekday: 'long' })}
                  </p>
                </div>
                <button
                  onClick={() => setScheduleOpen(true)}
                  className="text-xs text-secondaryText underline hover:text-white"
                >
                  {t('rundetail.change_time')}
                </button>
              </div>
            )}
            {/* Phase-A win: after this run is past the approval gate, offer
                a one-click jump to the next pending item so the operator
                can flow through the queue without bouncing back to /runs. */}
            {nextPendingId &&
              (run.status === 'approved' ||
                run.approvalStatus === 'approved' ||
                run.status === 'rejected') && (
                <button
                  onClick={() => {
                    setTabPinned(false);
                    navigate(`/runs/${nextPendingId}`);
                  }}
                  className="flex items-center gap-2 rounded-lg border border-brand-purple/40 bg-brand-purple/10 px-4 py-2.5 text-sm font-medium text-brand-cyan hover:bg-brand-purple/20"
                >
                  {t('rundetail.next_pending')} →
                </button>
              )}

            {actionError && (
              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 whitespace-pre-wrap">
                {actionError}
              </div>
            )}

            {scheduleOpen && (
              <ScheduleModal
                mode={{ kind: 'schedule-approved', runId: id! }}
                activePlatform={(run.platform || 'linkedin') as PlatformId}
                onClose={() => setScheduleOpen(false)}
                onScheduled={() => {
                  setScheduleOpen(false);
                  refetch();
                }}
                onError={(msg) => setActionError(`schedule failed: ${msg}`)}
              />
            )}
          </div>
        );

      case 'Postiz State':
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-surface-soft border border-border-strong p-4">
              <pre className="whitespace-pre-wrap text-sm text-secondaryText">
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
          <div className="rounded-lg bg-surface-soft border border-border-strong p-4">
            {run.analytics ? (
              <pre className="whitespace-pre-wrap text-sm text-secondaryText">
                {JSON.stringify(run.analytics, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted py-8 text-center">
                {t('rundetail.no_analytics')}
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
        className="flex items-center gap-2 text-sm text-muted hover:text-secondaryText transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('rundetail.back_to_runs')}
      </button>

      <div className="flex flex-wrap items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-primaryText">
              Run {(id || '').slice(0, 8)}
            </h1>
            <StatusBadge status={run.status} />
            {/* Persistent stage badge while the pipeline is in flight.
                Drops out the moment the run reaches a terminal state so
                we don't claim "running stage X" forever. */}
            {(run.status === 'running' || run.status === 'pending') && (() => {
              const stages = ['generate', 'psychology', 'humanize', 'media', 'approve', 'publish', 'analytics'];
              const labels: Record<string, string> = {
                generate: t('rundetail.stage.generate'),
                psychology: t('rundetail.stage.psychology'),
                humanize: t('rundetail.stage.humanize'),
                media: t('rundetail.stage.media'),
                approve: t('rundetail.stage.approve'),
                publish: t('rundetail.stage.publish'),
                analytics: t('rundetail.stage.analytics'),
              };
              const ss = (run.stageStatuses || run.stages || {}) as Record<string, string>;
              const current =
                run.currentStage ||
                stages.find((s) => ss[s] === 'running' || ss[s] === 'in_progress') ||
                stages.find((s) => !['completed', 'failed', 'skipped'].includes(ss[s]));
              const idx = current ? stages.indexOf(current) + 1 : null;
              return current ? (
                <span className="rounded-full border border-brand-purple/40 bg-brand-purple/10 px-2.5 py-0.5 text-[11px] font-medium text-brand-cyan">
                  {idx ? `Stage ${idx}/${stages.length} · ` : ''}{labels[current] || current}
                </span>
              ) : null;
            })()}
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted">
            {run.platform && <span className="capitalize">{run.platform}</span>}
            {run.campaign && (
              <>
                <span className="text-faint">/</span>
                <span>{run.campaign}</span>
              </>
            )}
            <span className="text-faint">/</span>
            <span>{formatDate(run.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-xl border border-border-strong bg-surface-soft backdrop-blur-sm p-5">
            <h3 className="text-sm font-semibold text-primaryText mb-4">{t('rundetail.pipeline_progress')}</h3>
            <PipelineTimeline
              currentStage={run.currentStage}
              stageStatuses={stageStatuses}
              onRetry={(stage) =>
                retryStage.mutate({ runId: id!, stage })
              }
            />
          </div>
          <AnalysisBlock run={run} />
          <ActivityBlock stages={run.stages || []} />
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="flex gap-1 border-b border-border-strong overflow-x-auto">
            {visibleTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setTabPinned(true);
                }}
                className={cn(
                  'relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                  activeTab === tab
                    ? 'text-indigo-400'
                    : 'text-muted hover:text-secondaryText'
                )}
              >
                {tabLabel(t, tab)}
                {activeTab === tab && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
                )}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-border-strong bg-surface-soft backdrop-blur-sm p-6">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Media tab (with editable prompt + regenerate) ───────────────────────

interface MediaTabProps {
  runId: string;
  assets: any[];
  selectedMediaId?: string;
  actionLoading: string | null;
  onRegenerate: (prompt?: string) => void;
  onSelect: (assetId: string) => void;
}

function MediaTab({ assets, selectedMediaId, actionLoading, onRegenerate, onSelect }: MediaTabProps) {
  const t = useT();
  // Pull the prompt from the first hosted asset; that's the most recent
  // generation's editorial prompt. Operator edits are local-only until
  // they hit "Regenerate", at which point the new prompt is sent to the
  // engine and persisted on the resulting assets.
  const seed = assets[0]?.prompt ?? '';
  const [prompt, setPrompt] = useState<string>(seed);
  const [showPrompt, setShowPrompt] = useState(false);
  const dirty = prompt.trim() !== seed.trim();
  const busy = actionLoading === 'regenerateMedia';

  // Keep the editor in sync when the run reloads with new assets (e.g.
  // after a successful regenerate).
  useEffect(() => {
    setPrompt(seed);
  }, [seed]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border-strong bg-surface-soft p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowPrompt((v) => !v)}
            className="text-xs text-muted hover:text-secondaryText"
          >
            {showPrompt ? '▾' : '▸'} {t('rundetail.media.prompt_label')} {dirty && <span className="text-amber-400 ml-1">{t('rundetail.media.edited')}</span>}
          </button>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                type="button"
                onClick={() => setPrompt(seed)}
                className="text-xs text-muted hover:text-secondaryText"
              >
                {t('rundetail.media.reset')}
              </button>
            )}
            <button
              onClick={() => onRegenerate(dirty ? prompt.trim() : undefined)}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg border border-brand-purple/40 bg-brand-purple/15 px-3 py-1.5 text-xs font-medium text-brand-cyan hover:bg-brand-purple/25 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
              {dirty ? 'Regenerate with edited prompt' : 'Regenerate'}
            </button>
          </div>
        </div>
        {showPrompt && (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              assets.length === 0
                ? 'No prompt yet. Generate media first, or type a prompt to use for the first run.'
                : 'Edit the editorial prompt and click Regenerate.'
            }
            rows={6}
            className="w-full rounded-md border border-border-strong bg-black/40 px-3 py-2 text-xs text-secondaryText placeholder-zinc-500 font-mono focus:outline-none focus:ring-1 focus:ring-brand-purple/40"
          />
        )}
        <p className="text-[11px] text-muted">
          {assets.length} asset(s). Editing the prompt and regenerating produces a new image; previous ones become superseded but stay in the database.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {assets.map((asset: any) => (
          <MediaCard
            key={asset.id || asset._id}
            asset={asset}
            selected={asset.selected || selectedMediaId === (asset.id || asset._id)}
            onSelect={onSelect}
          />
        ))}
      </div>
      {assets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <ImageIcon className="h-10 w-10 mb-3" />
          <p className="text-sm">{t('rundetail.no_media')}</p>
        </div>
      )}
    </div>
  );
}

// ─── Preview pane (with edit + rerun) ─────────────────────────────────────

interface PreviewPaneProps {
  run: any;
  runId: string;
  onAction: (action: string, fn: () => Promise<any>) => Promise<void>;
  actionLoading: string | null;
  refetch: () => void;
}

function PreviewPane({ run, runId, onAction, actionLoading, refetch }: PreviewPaneProps) {
  const t = useT();
  const drafts = run.drafts || [];
  const primary = drafts.find((d: any) => d.selected) ?? drafts[0];
  const media = run.media || run.mediaAssets || [];
  const primaryMedia = media.find((m: any) => m.selected) ?? media[0];

  const initialContent =
    primary?.content || primary?.finalContent || primary?.humanizedContent || primary?.rawContent || '';

  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(initialContent);
  const [note, setNote] = useState('');
  const [lastResult, setLastResult] = useState<{ kind: 'edit' | 'rerun'; data: any } | null>(null);

  if (!primary) {
    return (
      <p className="text-sm text-muted py-12 text-center">
        No draft yet — wait for the pipeline to finish or generate one.
      </p>
    );
  }

  const startEdit = () => {
    setDraftText(initialContent);
    setNote('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraftText(initialContent);
    setNote('');
  };

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'edit' | 'rerun' | null>(null);

  const saveEdit = async () => {
    setActionError(null);
    setBusy('edit');
    try {
      const result = await editDraft(runId, draftText, note || undefined);
      if (!result.learning_ids?.length) {
        throw new Error('Endpoint returned 200 but saved no rules — check engine logs');
      }
      setLastResult({ kind: 'edit', data: result });
      setEditing(false);
      refetch();
    } catch (err) {
      setActionError(`Save failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  // Bypasses the parent's handleAction (which catches errors via console.error
  // and never surfaces them). We need direct control so the user sees what
  // happened — success or failure — every time.
  const runAgain = async () => {
    setActionError(null);
    setLastResult({ kind: 'rerun', data: { message: 'Starting…', applicable_learnings: 0 } });
    setBusy('rerun');
    try {
      const result = await rerunRun(runId);
      setLastResult({ kind: 'rerun', data: result });
      refetch();
    } catch (err) {
      setLastResult(null);
      setActionError(`Run again failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted">
          How the post will appear on {run.platform || 'the platform'}
        </p>
        <div className="flex items-center gap-2">
          {!editing && (
            <button
              onClick={startEdit}
              className="flex items-center gap-2 rounded-lg bg-surface-soft border border-border-strong px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-medium transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
          <button
            onClick={runAgain}
            disabled={busy === 'rerun' || lastResult?.kind === 'rerun'}
            className="flex items-center gap-2 rounded-lg bg-indigo-500/15 border border-indigo-500/30 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Create a new run with the same brief; active learnings will be applied"
          >
            <Play className={cn('h-3.5 w-3.5', busy === 'rerun' && 'animate-spin')} />
            {busy === 'rerun' ? 'Starting…' : lastResult?.kind === 'rerun' ? 'Started' : 'Run Again'}
          </button>
        </div>
      </div>

      {/* Feedback banners live RIGHT BELOW THE BUTTON ROW so the operator
          sees the result without having to scroll past a long post. */}
      {actionError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          <p className="font-medium">{actionError}</p>
          <p className="mt-1 text-xs text-red-300/70">
            Open browser console (F12) → Network tab to see the request/response. Or check the engine API logs.
          </p>
        </div>
      )}

      {lastResult?.kind === 'rerun' && (
        <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 p-4 text-sm text-indigo-200">
          <p className="font-medium">{lastResult.data.message}</p>
          <p className="mt-1 text-xs text-indigo-200/80">
            {lastResult.data.applicable_learnings} active rule
            {lastResult.data.applicable_learnings === 1 ? '' : 's'} loaded.
            A new run is processing in the background — check the Runs list in ~30s.
          </p>
        </div>
      )}

      {lastResult?.kind === 'edit' && Array.isArray(lastResult.data?.rules_extracted) && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-300">
            {lastResult.data.rules_extracted.length} rule(s) saved — future runs will follow them.
          </p>
          <ul className="mt-2 space-y-1 text-emerald-200/80">
            {lastResult.data.rules_extracted.map((r: { category: string; content: string }, i: number) => (
              <li key={i}>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                  {r.category}
                </span>{' '}
                {r.content}
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing ? (
        <div className="space-y-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
          <p className="text-xs text-indigo-300">
            Edit the post below. On save, Claude diffs your edit against the model's draft and
            extracts structured rules — every future run on {run.platform} will follow them.
          </p>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={Math.min(20, Math.max(8, draftText.split('\n').length + 2))}
            className="w-full rounded-lg bg-black/30 border border-border-strong px-3 py-2 text-sm text-primaryText font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional: tell the bot WHY you changed this (becomes a stronger rule)"
            className="w-full rounded-lg bg-black/30 border border-border-strong px-3 py-2 text-xs text-secondaryText placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex items-center justify-between gap-2">
            {(() => {
              const textChanged = draftText.trim() !== initialContent.trim();
              const hasNote = note.trim().length > 0;
              const canSave = textChanged || hasNote;
              return (
                <p className="text-[11px] text-muted">
                  {!canSave && 'Edit the text or add a note to enable Save.'}
                  {canSave && textChanged && hasNote && 'Will save text changes + note as rules.'}
                  {canSave && textChanged && !hasNote && 'Will diff the edit and extract rules from it.'}
                  {canSave && !textChanged && hasNote && 'Will save your note as a rule (no text change).'}
                </p>
              );
            })()}
            <div className="flex gap-2">
              <button
                onClick={cancelEdit}
                className="rounded-lg border border-border-strong px-3 py-1.5 text-xs text-muted hover:text-secondaryText hover:bg-surface-soft"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={saveEdit}
                disabled={
                  busy === 'edit' ||
                  (draftText.trim() === initialContent.trim() && note.trim().length === 0)
                }
                className="flex items-center gap-2 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="h-3.5 w-3.5" />
                {busy === 'edit' ? t('rundetail.preview.extracting') : t('rundetail.preview.save_learn')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <PostPreview
          platform={run.platform || 'generic'}
          content={initialContent}
          mediaUrl={primaryMedia?.url || null}
          brandName={run.campaign || 'Your Brand'}
          brandHandle={(run.campaign || 'yourbrand').toLowerCase().replace(/\s+/g, '_')}
        />
      )}

      {lastResult?.kind === 'edit' && Array.isArray(lastResult.data?.rules_extracted) && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <p className="font-medium text-emerald-300">
            {lastResult.data.rules_extracted.length} rule(s) saved — future runs on {run.platform} will follow them.
          </p>
          <ul className="mt-2 space-y-1 text-emerald-200/80">
            {lastResult.data.rules_extracted.map((r: any, i: number) => (
              <li key={i}>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                  {r.category}
                </span>{' '}
                {r.content}
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}

// ─── Readability tab ────────────────────────────────────────────────────

type Metric = 'flesch' | 'grade';

function ReadabilityTab({
  run,
  runId,
  refetch,
}: {
  run: any;
  runId: string;
  refetch: () => void;
}) {
  const t = useT();
  const drafts = (run.drafts ?? []) as any[];
  const primary = drafts.find((d) => d.selected) ?? drafts[0];
  const original: string =
    primary?.finalContent || primary?.content || run.humanized || '';

  const [improved, setImproved] = useState<string | null>(null);
  const [changes, setChanges] = useState<string[]>([]);
  const [busy, setBusy] = useState<'improve' | 'aggressive' | 'accept-original' | 'accept-improved' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('flesch');

  const originalScore = original ? fleschReadingEase(original) : null;
  const improvedScore = improved ? fleschReadingEase(improved) : null;

  const onImprove = async (mode: 'standard' | 'aggressive' = 'standard') => {
    setBusy(mode === 'aggressive' ? 'aggressive' : 'improve');
    setError(null);
    try {
      // For "push harder" we feed the current improved text back in so the
      // aggressive pass starts from the already-simplified version.
      const seed = mode === 'aggressive' ? improved ?? undefined : undefined;
      const res = await improveReadability(runId, { content: seed, mode });
      setImproved(res.improved);
      setChanges(res.changes ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onAccept = async (which: 'original' | 'improved') => {
    if (which === 'improved' && !improved) return;
    setBusy(which === 'original' ? 'accept-original' : 'accept-improved');
    setError(null);
    try {
      const content = which === 'improved' ? improved! : original;
      await editDraft(runId, content, `accepted readability=${which}`);
      setImproved(null);
      setChanges([]);
      refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!original) {
    return (
      <p className="text-sm text-muted py-8 text-center">
        No content yet — readability needs a finalised draft.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Metric toggle + target band header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-semibold text-primaryText">{t('rundetail.readability.title')}</p>
          <p className="text-[11px] text-muted">
            Scoring system:{' '}
            <span className="text-secondaryText">
              {metric === 'flesch'
                ? 'Flesch Reading Ease (0-100, higher = easier)'
                : 'Flesch–Kincaid Grade Level (US school grade)'}
            </span>
            <span className="mx-2 text-faint">·</span>
            Target:{' '}
            <span className="text-emerald-400">
              {metric === 'flesch' ? '60+ (plain)' : 'grade 8 or below'}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border-strong bg-surface-soft p-0.5 text-[11px]">
          <button
            onClick={() => setMetric('flesch')}
            className={cn(
              'px-2 py-1 rounded',
              metric === 'flesch' ? 'bg-surface-medium text-primaryText' : 'text-muted hover:text-secondaryText',
            )}
          >
            {t('rundetail.readability.flesch')}
          </button>
          <button
            onClick={() => setMetric('grade')}
            className={cn(
              'px-2 py-1 rounded',
              metric === 'grade' ? 'bg-surface-medium text-primaryText' : 'text-muted hover:text-secondaryText',
            )}
          >
            {t('rundetail.readability.grade_level')}
          </button>
        </div>
      </div>

      {/* Score + explanation */}
      <ReadabilityCard label={t('rundetail.readability.current')} score={originalScore} metric={metric} />
      <ReadabilityExplanation score={originalScore} metric={metric} />

      {/* Improve action */}
      {improved == null ? (
        <div className="rounded-xl border border-border-strong bg-surface-soft p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm text-secondaryText font-medium">{t('rundetail.readability.improve')}</p>
            <p className="text-[11px] text-muted">
              One LLM pass. Shorter sentences, simpler words. Facts and citations preserved exactly.
            </p>
          </div>
          <button
            onClick={() => onImprove('standard')}
            disabled={!!busy}
            className="flex items-center gap-2 rounded-md border border-brand-purple/40 bg-brand-purple/15 px-3 py-1.5 text-xs font-medium text-brand-cyan hover:bg-brand-purple/25 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy === 'improve' && 'animate-spin')} />
            {t('rundetail.readability.generate_improved')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <VersionCard
              label={t('rundetail.readability.original')}
              score={originalScore}
              metric={metric}
              content={original}
              tone="neutral"
              onAccept={() => onAccept('original')}
              busy={busy === 'accept-original'}
              acceptLabel={t('rundetail.readability.keep_original')}
            />
            <VersionCard
              label={t('rundetail.readability.improved')}
              score={improvedScore}
              metric={metric}
              content={improved}
              tone={
                improvedScore && originalScore && improvedScore.score > originalScore.score
                  ? 'better'
                  : 'worse'
              }
              onAccept={() => onAccept('improved')}
              busy={busy === 'accept-improved'}
              acceptLabel={t('rundetail.readability.accept_improved')}
              delta={
                originalScore && improvedScore
                  ? improvedScore.score - originalScore.score
                  : null
              }
            />
          </div>

          {/* Change log */}
          {changes.length > 0 && (
            <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
              <p className="text-xs font-semibold text-secondaryText mb-2">{t('rundetail.readability.edits_applied')}</p>
              <ul className="space-y-1">
                {changes.map((c, i) => (
                  <li key={i} className="text-[11px] text-muted flex gap-2">
                    <span className="text-brand-cyan">·</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Push harder + discard row */}
          <div className="flex items-center justify-between flex-wrap gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-secondaryText font-medium">{t('rundetail.readability.still_hard')}</p>
              <p className="text-[11px] text-muted">
                Push harder applies aggressive caps: 14-word sentence max, replace 3+ syllable words, no subordinate clauses. Iterates from the current improved version.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setImproved(null);
                  setChanges([]);
                }}
                className="text-[11px] text-muted hover:text-secondaryText"
              >
                {t('rundetail.readability.discard')}
              </button>
              <button
                onClick={() => onImprove('aggressive')}
                disabled={!!busy}
                className="flex items-center gap-2 rounded-md bg-amber-500/20 border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', busy === 'aggressive' && 'animate-spin')} />
                {t('rundetail.readability.push_harder')}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

// Flesch–Kincaid Grade Level — same word/sentence/syllable inputs, returns
// a US school-grade number. Useful when "20 / very hard" doesn't tell the
// operator how much simpler the text needs to get.
function fleschKincaidGrade(words: number, sentences: number, syllables: number): number {
  if (words === 0) return 0;
  return 0.39 * (words / Math.max(1, sentences)) + 11.8 * (syllables / words) - 15.59;
}

// Wrapper that returns either a Flesch score or a grade-level number based
// on the chosen metric. The tone (good/warn/bad) flips for grade level —
// higher Flesch is better, lower grade is better.
function getMetricView(score: ReturnType<typeof fleschReadingEase> | null, metric: Metric) {
  if (!score) return null;
  // Re-derive syllables from the Flesch formula (we already have words+sentences).
  // Flesch = 206.835 − 1.015×(W/S) − 84.6×(Syl/W) → Syl = ((206.835 − Flesch − 1.015×W/S) × W) / 84.6
  const wps = score.words / Math.max(1, score.sentences);
  const syllablesPerWord = (206.835 - score.score - 1.015 * wps) / 84.6;
  const syllables = Math.round(syllablesPerWord * score.words);

  if (metric === 'grade') {
    const grade = fleschKincaidGrade(score.words, score.sentences, syllables);
    const tone = grade <= 8 ? 'good' : grade <= 12 ? 'warn' : 'bad';
    const label = `Grade ${grade.toFixed(1)}`;
    const sub = grade <= 6 ? 'elementary' : grade <= 8 ? 'middle school' : grade <= 12 ? 'high school' : grade <= 16 ? 'college' : 'graduate';
    // Bar: invert grade onto a 0-100 scale for visual consistency. Grade 0 = 100%, grade 18+ = 0%.
    const barPct = Math.max(0, Math.min(100, 100 - (grade / 18) * 100));
    return { tone, label, sub, barPct, primary: grade.toFixed(1) };
  }
  const tone = score.score >= 60 ? 'good' : score.score >= 40 ? 'warn' : 'bad';
  return {
    tone,
    label: score.grade,
    sub: '',
    barPct: Math.min(100, Math.max(0, score.score)),
    primary: Math.round(score.score).toString(),
  };
}

function ReadabilityCard({
  label,
  score,
  metric,
}: {
  label: string;
  score: ReturnType<typeof fleschReadingEase> | null;
  metric: Metric;
}) {
  if (!score) return null;
  const view = getMetricView(score, metric);
  if (!view) return null;
  const color = { good: 'text-emerald-400', warn: 'text-amber-400', bad: 'text-red-400' }[view.tone];
  const bar = { good: 'bg-emerald-500/60', warn: 'bg-amber-500/60', bad: 'bg-red-500/60' }[view.tone];
  return (
    <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted font-medium">{label}</p>
      <div className="mt-2 flex items-baseline gap-3">
        <span className={cn('text-3xl font-semibold tabular-nums', color)}>{view.primary}</span>
        <span className="text-sm text-secondaryText capitalize">{view.label}</span>
        {view.sub && <span className="text-xs text-muted">· {view.sub}</span>}
      </div>
      <div className="mt-2 h-1 w-full rounded-full bg-surface-soft overflow-hidden">
        <div className={cn('h-full transition-all', bar)} style={{ width: `${view.barPct}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="Words" value={score.words} />
        <Stat label="Sentences" value={score.sentences} />
        <Stat label="Words/sentence" value={(score.words / Math.max(1, score.sentences)).toFixed(1)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-black/30 border border-border-strong px-2 py-1.5">
      <p className="text-muted">{label}</p>
      <p className="text-secondaryText font-medium tabular-nums">{value}</p>
    </div>
  );
}

function ReadabilityExplanation({
  score,
  metric,
}: {
  score: ReturnType<typeof fleschReadingEase> | null;
  metric: Metric;
}) {
  void metric;
  if (!score) return null;
  const wps = score.words / Math.max(1, score.sentences);
  const reasons: string[] = [];

  if (wps > 22) reasons.push(`Long sentences — averaging ${wps.toFixed(1)} words/sentence (target <20).`);
  else if (wps < 12) reasons.push(`Very short sentences — averaging ${wps.toFixed(1)} words/sentence (clipped feel).`);

  // syllables/word approximation: re-derive from score (Flesch formula reversed)
  const spw = (206.835 - score.score - 1.015 * wps) / 84.6;
  if (spw > 1.7) reasons.push(`Complex word choices — ~${spw.toFixed(2)} syllables/word (target <1.5). Watch for Latinate words like "utilize", "facilitate", "leverage".`);
  else if (spw < 1.3) reasons.push(`Very simple word choices (~${spw.toFixed(2)} syllables/word) — appropriate for casual platforms.`);

  if (score.score >= 70) reasons.push('Easy to scan on mobile feeds. Good for high-engagement platforms (Instagram, TikTok captions).');
  else if (score.score >= 60) reasons.push('Plain-language register. Good default for LinkedIn and most B2B social.');
  else if (score.score >= 40) reasons.push('Reads as professional/technical. Acceptable for niche B2B audiences but loses casual readers.');
  else reasons.push('Reads as academic or jargon-heavy. Most social audiences will bounce. Consider rewriting.');

  return (
    <div className="rounded-xl border border-border-strong bg-surface-soft p-4 space-y-2">
      <p className="text-xs font-semibold text-secondaryText flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-brand-cyan" />
        Why this score?
      </p>
      <p className="text-[11px] text-muted">
        Flesch Reading Ease: <code className="text-secondaryText">206.835 − 1.015×(words/sentence) − 84.6×(syllables/word)</code>. Higher is easier.
      </p>
      <ul className="space-y-1 mt-2">
        {reasons.map((r, i) => (
          <li key={i} className="text-[12px] text-secondaryText flex gap-2">
            <span className="text-muted">·</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VersionCard({
  label,
  score,
  metric,
  content,
  tone,
  onAccept,
  busy,
  acceptLabel,
  delta,
}: {
  label: string;
  score: ReturnType<typeof fleschReadingEase> | null;
  metric: Metric;
  content: string;
  tone: 'neutral' | 'better' | 'worse';
  onAccept: () => void;
  busy: boolean;
  acceptLabel: string;
  delta?: number | null;
}) {
  const borderColor =
    tone === 'better'
      ? 'border-emerald-500/40'
      : tone === 'worse'
        ? 'border-amber-500/40'
        : 'border-border-strong';
  const view = score ? getMetricView(score, metric) : null;
  return (
    <div className={cn('rounded-xl border bg-surface-soft p-4 space-y-3', borderColor)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-secondaryText">{label}</p>
        {view && (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-lg font-semibold tabular-nums',
                view.tone === 'good'
                  ? 'text-emerald-400'
                  : view.tone === 'warn'
                    ? 'text-amber-400'
                    : 'text-red-400',
              )}
            >
              {view.primary}
            </span>
            <span className="text-[11px] text-muted capitalize">{view.label}</span>
            {typeof delta === 'number' && Math.abs(delta) >= 0.5 && (
              <span
                className={cn(
                  'text-[11px] font-medium tabular-nums',
                  // For Flesch metric: higher delta is better (green). For grade: lower is better — invert.
                  metric === 'flesch'
                    ? delta > 0 ? 'text-emerald-400' : 'text-amber-400'
                    : delta > 0 ? 'text-amber-400' : 'text-emerald-400',
                )}
              >
                {delta > 0 ? '+' : ''}
                {delta.toFixed(1)}
                <span className="text-faint ml-0.5">Flesch</span>
              </span>
            )}
          </div>
        )}
      </div>
      <pre className="whitespace-pre-wrap text-[12px] text-secondaryText bg-black/30 rounded p-3 border border-border-strong max-h-72 overflow-y-auto">
        {content}
      </pre>
      <button
        onClick={onAccept}
        disabled={busy}
        className={cn(
          'w-full flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50',
          tone === 'better'
            ? 'bg-gradient-to-r from-brand-purple to-brand-pink text-white'
            : 'border border-border-strong bg-surface-soft text-secondaryText hover:bg-surface-medium',
        )}
      >
        {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        {acceptLabel}
      </button>
    </div>
  );
}

// ─── SEO / GEO tab ──────────────────────────────────────────────────────

function SeoGeoTab({ run }: { run: any }) {
  const t = useT();
  // Pull from generate stage (canonical source) and draft metadata (where the
  // pipeline persists `seo_details`, `eeat_signals`, `ai_citation_readiness`).
  const generate = (run.stages ?? []).find((s: any) => s.stage_name === 'generate');
  const out = generate?.output_data ?? {};
  const drafts = (run.drafts ?? []) as any[];
  const primary = drafts.find((d) => d.selected) ?? drafts[0];
  const meta = primary?.metadata ?? {};

  const seo = num(out.seo_score) ?? num(meta.seo_score);
  const geo = num(out.geo_score) ?? num(meta.geo_score);
  const combined = num(out.combined_score) ?? num(meta.combined_score) ?? num(primary?.seoScore);
  const seoDetails: Record<string, number> = (meta.seo_details ?? out.seo_details ?? {}) as Record<string, number>;
  const eeat: string[] = Array.isArray(meta.eeat_signals)
    ? meta.eeat_signals
    : Array.isArray(out.eeat_signals)
      ? out.eeat_signals
      : [];
  const aiCitation: string | null = (meta.ai_citation_readiness ?? out.ai_citation_readiness ?? null) as string | null;
  const draftedContent: string | null = primary?.rawContent ?? null;

  if (!generate && !primary) {
    return (
      <p className="text-sm text-muted py-8 text-center">SEO/GEO stage hasn't run yet</p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Headline scores */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BigScore label="SEO Score" value={seo} hint="0-100, keyword + discoverability + technical" />
        <BigScore label="GEO Score" value={geo} hint="0-100, citability + authority + entity clarity" />
        <BigScore
          label="Combined"
          value={combined}
          hint="50% SEO · 50% GEO"
          highlight
        />
      </div>

      {/* AI citation readiness */}
      {aiCitation && (
        <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-4">
          <p className="text-[10px] uppercase tracking-wider text-brand-cyan font-medium mb-2">
            {t('rundetail.seogeo.citation_readiness')}
          </p>
          <p className="text-sm text-secondaryText">{aiCitation}</p>
        </div>
      )}

      {/* Sub-scores */}
      {Object.keys(seoDetails).length > 0 && (
        <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
          <h4 className="text-sm font-semibold text-primaryText mb-3">Sub-scores</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {Object.entries(seoDetails).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="text-muted capitalize">{k.replace(/_/g, ' ')}</span>
                <span className="text-secondaryText tabular-nums font-medium">
                  {typeof v === 'number' ? `${v}/10` : String(v)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EEAT signals */}
      {eeat.length > 0 && (
        <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
          <h4 className="text-sm font-semibold text-primaryText mb-3">E-E-A-T signals surfaced</h4>
          <ul className="space-y-1.5">
            {eeat.map((s, i) => (
              <li key={i} className="text-xs text-secondaryText flex gap-2">
                <span className="text-emerald-400">✓</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Original SEO/GEO drafted content (pre-psychology / pre-humanize) */}
      {draftedContent && (
        <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
          <h4 className="text-sm font-semibold text-primaryText mb-2">SEO/GEO draft (pre-psychology)</h4>
          <p className="text-[10px] text-muted mb-3">
            What the SEO/GEO stage produced before psychology and humanizer made their passes.
          </p>
          <pre className="whitespace-pre-wrap text-sm text-secondaryText bg-black/30 rounded p-3 border border-border-strong">
            {draftedContent}
          </pre>
        </div>
      )}
    </div>
  );
}

function BigScore({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: number | null;
  hint: string;
  highlight?: boolean;
}) {
  const tone = value == null ? 'muted' : value >= 75 ? 'good' : value >= 50 ? 'warn' : 'bad';
  const color = {
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    bad: 'text-red-400',
    muted: 'text-muted',
  }[tone];
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        highlight
          ? 'border-brand-purple/40 bg-gradient-to-br from-brand-purple/10 to-brand-pink/10'
          : 'border-border-strong bg-surface-soft',
      )}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted font-medium">
        {label}
      </p>
      <p className={cn('mt-2 text-3xl font-semibold tabular-nums', color)}>
        {value == null ? '—' : Math.round(value)}
      </p>
      <p className="mt-1 text-[10px] text-muted">{hint}</p>
    </div>
  );
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'after' in (v as any) && typeof (v as any).after === 'number') {
    return (v as any).after;
  }
  return null;
}

// ─── Analysis block (SEO / Compliance / Readability) ────────────────────

function AnalysisBlock({ run }: { run: any }) {
  const t = useT();
  // Pull the strongest content available — same precedence the rest of the
  // page uses. SEO & compliance come straight from the pipeline; readability
  // is computed client-side via Flesch reading ease (no extra LLM call).
  const drafts = (run.drafts ?? []) as any[];
  const primary = drafts.find((d) => d.selected) ?? drafts[0];
  const content: string =
    primary?.finalContent || primary?.content || run.humanized || '';

  // SEO score precedence:
  //   1. draft.seoScore (column — set by pipeline since 2026-04-27)
  //   2. draft.metadata.combined_score (for older runs where seo_score is null
  //      but combined_score made it into the metadata blob)
  //   3. generate stage output_data.combined_score (last-resort fallback)
  const generateStage = (run.stages ?? []).find((s: any) => s.stage_name === 'generate');
  const seoScore: number | null =
    typeof primary?.seoScore === 'number'
      ? primary.seoScore
      : typeof primary?.metadata?.combined_score === 'number'
        ? primary.metadata.combined_score
        : typeof generateStage?.output_data?.combined_score === 'number'
          ? generateStage.output_data.combined_score
          : null;

  const compliance = run.compliance ?? run.complianceCheck ?? null;
  const readability = content ? fleschReadingEase(content) : null;

  return (
    <div className="rounded-xl border border-border-strong bg-surface-soft backdrop-blur-sm p-5">
      <h3 className="text-sm font-semibold text-primaryText mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-brand-cyan" />
        {t('rundetail.analysis')}
      </h3>
      <div className="space-y-3">
        <ScoreRow
          icon={<TrendingUp className="h-4 w-4" />}
          label="SEO Score"
          value={seoScore != null ? `${Math.round(seoScore)}/100` : 'Pending'}
          tone={seoScore == null ? 'muted' : seoScore >= 75 ? 'good' : seoScore >= 50 ? 'warn' : 'bad'}
          bar={seoScore != null ? Math.min(100, Math.max(0, seoScore)) : null}
        />
        <ScoreRow
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Compliance"
          value={
            compliance == null
              ? 'Pending'
              : compliance.passed
                ? 'Passed'
                : `${compliance.issues?.length ?? 0} issue(s)`
          }
          tone={compliance == null ? 'muted' : compliance.passed ? 'good' : 'bad'}
        />
        <ScoreRow
          icon={<BookOpen className="h-4 w-4" />}
          label="Readability"
          value={
            readability == null
              ? 'Pending'
              : `${Math.round(readability.score)} · ${readability.grade}`
          }
          tone={
            readability == null
              ? 'muted'
              : readability.score >= 60
                ? 'good'
                : readability.score >= 40
                  ? 'warn'
                  : 'bad'
          }
          bar={readability ? Math.min(100, Math.max(0, readability.score)) : null}
          hint={
            readability
              ? `${readability.words} words, ~${readability.sentences} sentences`
              : undefined
          }
        />
      </div>
      {compliance && !compliance.passed && Array.isArray(compliance.issues) && compliance.issues.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-border-strong pt-3">
          {compliance.issues.slice(0, 5).map((issue: string, i: number) => (
            <li key={i} className="text-[11px] text-amber-300/90 flex items-start gap-1.5">
              <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScoreRow({
  icon,
  label,
  value,
  tone,
  bar,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad' | 'muted';
  bar?: number | null;
  hint?: string;
}) {
  const toneColor = {
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    bad: 'text-red-400',
    muted: 'text-muted',
  }[tone];
  const barColor = {
    good: 'bg-emerald-500/60',
    warn: 'bg-amber-500/60',
    bad: 'bg-red-500/60',
    muted: 'bg-zinc-700',
  }[tone];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-secondaryText">
          <span className={toneColor}>{icon}</span>
          {label}
        </span>
        <span className={cn('font-medium tabular-nums', toneColor)}>{value}</span>
      </div>
      {bar != null && (
        <div className="h-1 w-full rounded-full bg-surface-soft overflow-hidden">
          <div className={cn('h-full transition-all', barColor)} style={{ width: `${bar}%` }} />
        </div>
      )}
      {hint && <p className="text-[11px] text-muted leading-tight">{hint}</p>}
    </div>
  );
}

// Flesch reading ease — 90+ very easy, 60-70 plain, 30-50 difficult, <30 very hard.
// Approximate syllable count via vowel-group heuristic; good enough for a UI hint
// without a syllable-dictionary dep.
function fleschReadingEase(text: string): {
  score: number;
  grade: string;
  words: number;
  sentences: number;
} {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const sentences = Math.max(1, (cleaned.match(/[.!?]+(?=\s|$)/g) ?? []).length);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  if (words.length === 0) return { score: 0, grade: '—', words: 0, sentences: 0 };
  const score =
    206.835 -
    1.015 * (words.length / sentences) -
    84.6 * (syllables / words.length);
  let grade = 'difficult';
  if (score >= 80) grade = 'very easy';
  else if (score >= 70) grade = 'easy';
  else if (score >= 60) grade = 'plain';
  else if (score >= 50) grade = 'fairly difficult';
  else if (score >= 30) grade = 'difficult';
  else grade = 'very hard';
  return { score, grade, words: words.length, sentences };
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

// ─── Activity block (run timeline) ──────────────────────────────────────

function ActivityBlock({ stages }: { stages: any[] }) {
  const t = useT();
  // Sort chronologically: started_at if set, otherwise order_index.
  const events = (stages ?? [])
    .map((s) => ({
      name: s.stage_name ?? s.stageName ?? 'unknown',
      status: s.status ?? 'pending',
      startedAt: s.started_at ?? s.startedAt ?? null,
      completedAt: s.completed_at ?? s.completedAt ?? null,
      orderIndex: s.order_index ?? s.orderIndex ?? 0,
      error: s.error_message ?? s.errorMessage ?? null,
    }))
    .sort((a, b) => {
      if (a.startedAt && b.startedAt) return a.startedAt.localeCompare(b.startedAt);
      if (a.startedAt) return -1;
      if (b.startedAt) return 1;
      return a.orderIndex - b.orderIndex;
    });

  return (
    <div className="rounded-xl border border-border-strong bg-surface-soft backdrop-blur-sm p-5">
      <h3 className="text-sm font-semibold text-primaryText mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-brand-cyan" />
        {t('rundetail.activity')}
      </h3>
      {events.length === 0 ? (
        <p className="text-xs text-muted">{t('rundetail.no_activity')}</p>
      ) : (
        <ol className="relative space-y-3 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-surface-medium">
          {events.map((e, i) => (
            <li key={i} className="relative pl-6">
              <span
                className={cn(
                  'absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 border-zinc-950',
                  e.status === 'completed' && 'bg-emerald-500',
                  e.status === 'running' && 'bg-blue-500 animate-pulse',
                  e.status === 'failed' && 'bg-red-500',
                  e.status === 'pending' && 'bg-zinc-600',
                  e.status === 'skipped' && 'bg-zinc-700',
                )}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-secondaryText capitalize leading-tight">{e.name}</span>
                <span className="text-[11px] text-muted tabular-nums leading-tight">
                  {e.startedAt && e.completedAt
                    ? formatDuration(e.startedAt, e.completedAt)
                    : e.status}
                </span>
              </div>
              {e.error && (
                <p className="mt-0.5 text-[11px] text-red-300/80 line-clamp-2 leading-tight">{e.error}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function formatActivityTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
