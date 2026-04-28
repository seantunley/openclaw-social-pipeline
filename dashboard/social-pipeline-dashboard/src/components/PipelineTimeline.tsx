import { CheckCircle2, Circle, Loader2, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// Stage names + display order match the engine's `social_run_stage.stage_name`
// enum exactly. Earlier this list used invented names that the engine never
// wrote, so every row showed idle.
const PIPELINE_STAGES: Array<{ key: string; label: string }> = [
  { key: 'generate', label: 'Research + draft' },
  { key: 'psychology', label: 'Marketing psychology' },
  { key: 'humanize', label: 'Humanize + compliance' },
  { key: 'media', label: 'Image generation' },
  { key: 'approve', label: 'Awaiting approval' },
  { key: 'publish', label: 'Publish via Postiz' },
  { key: 'analytics', label: 'Analytics sync' },
];

interface PipelineTimelineProps {
  currentStage?: string;
  stageStatuses?: Record<string, string>;
  onRetry?: (stage: string) => void;
}

function stageIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
    case 'running':
    case 'in_progress':
      return <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />;
    case 'failed':
    case 'error':
      return <XCircle className="h-5 w-5 text-red-400" />;
    case 'pending':
    case 'waiting':
      return <Clock className="h-5 w-5 text-amber-400" />;
    default:
      return <Circle className="h-5 w-5 text-faint" />;
  }
}

export default function PipelineTimeline({
  currentStage,
  stageStatuses = {},
  onRetry,
}: PipelineTimelineProps) {
  return (
    <div className="space-y-0">
      {PIPELINE_STAGES.map((stage, i) => {
        const status = stageStatuses[stage.key] || (currentStage === stage.key ? 'running' : 'idle');
        const isCurrent = currentStage === stage.key || status === 'running';
        const isFailed = status === 'failed' || status === 'error';

        return (
          <div key={stage.key} className="flex items-stretch">
            <div className="flex flex-col items-center mr-4">
              <div className={cn('flex-shrink-0', isCurrent && 'scale-110')}>
                {stageIcon(status)}
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div
                  className={cn(
                    'w-0.5 flex-1 min-h-[24px]',
                    status === 'completed' ? 'bg-emerald-500/40' : 'bg-zinc-700'
                  )}
                />
              )}
            </div>
            <div className={cn('pb-6 flex-1', i === PIPELINE_STAGES.length - 1 && 'pb-0')}>
              <div className="flex items-center gap-3">
                <p
                  className={cn(
                    'text-sm font-medium',
                    isCurrent ? 'text-primaryText' : status === 'completed' ? 'text-secondaryText' : 'text-muted'
                  )}
                >
                  {stage.label}
                </p>
                {isFailed && onRetry && (
                  <button
                    onClick={() => onRetry(stage.key)}
                    className="text-xs text-red-400 hover:text-red-300 underline"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
