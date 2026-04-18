import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface DraftCardProps {
  draft: {
    id: string;
    content: string;
    score?: number;
    variant?: string;
  };
  selected?: boolean;
  onSelect?: (id: string) => void;
}

export default function DraftCard({ draft, selected, onSelect }: DraftCardProps) {
  return (
    <div
      onClick={() => onSelect?.(draft.id)}
      className={cn(
        'relative rounded-xl border p-5 cursor-pointer transition-all duration-200',
        selected
          ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/50'
          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
      )}
    >
      {selected && (
        <div className="absolute top-3 right-3 rounded-full bg-indigo-500 p-1">
          <Check className="h-3 w-3 text-white" />
        </div>
      )}
      {draft.variant && (
        <p className="text-xs font-medium text-indigo-400 mb-2 uppercase tracking-wide">
          {draft.variant}
        </p>
      )}
      <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
        {draft.content}
      </p>
      {draft.score !== undefined && (
        <div className="mt-4 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-zinc-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
              style={{ width: `${Math.min(draft.score * 100, 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted font-medium">
            {(draft.score * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  );
}
