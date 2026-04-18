import { CheckCircle2, Circle, Loader2, XCircle, Clock } from 'lucide-react';
import { cn, formatStatus } from '@/lib/utils';

const PIPELINE_STAGES = [
  'brief_generation',
  'research',
  'psychology_analysis',
  'content_strategy',
  'draft_generation',
  'draft_selection',
  'humanizer',
  'compliance_check',
  'media_prompt_generation',
  'media_generation',
  'media_selection',
  'final_assembly',
  'approval',
  'postiz_upload',
  'published',
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
      return <Circle className="h-5 w-5 text-zinc-600" />;
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
        const status = stageStatuses[stage] || (currentStage === stage ? 'running' : 'idle');
        const isCurrent = currentStage === stage;
        const isFailed = status === 'failed' || status === 'error';

        return (
          <div key={stage} className="flex items-stretch">
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
                    isCurrent ? 'text-zinc-100' : status === 'completed' ? 'text-zinc-300' : 'text-zinc-500'
                  )}
                >
                  {formatStatus(stage)}
                </p>
                {isFailed && onRetry && (
                  <button
                    onClick={() => onRetry(stage)}
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
