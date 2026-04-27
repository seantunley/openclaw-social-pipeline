import { ArrowRight } from 'lucide-react';

interface BeforeAfterProps {
  before: string | null;
  after: string | null;
  appliedLabel?: string;
  applied?: string[];
  changes?: string[];
  beforeLabel?: string;
  afterLabel?: string;
}

/**
 * Side-by-side before/after with the rules that were applied below.
 * Used by the Psychology and Humanized tabs to make the transformation
 * legible — text-only diffs left readers guessing what changed.
 */
export default function BeforeAfter({
  before,
  after,
  appliedLabel = 'Applied',
  applied = [],
  changes = [],
  beforeLabel = 'Before',
  afterLabel = 'After',
}: BeforeAfterProps) {
  if (!before && !after) {
    return (
      <p className="text-sm text-zinc-500 py-12 text-center">
        No data captured for this stage on this run.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
        <Pane label={beforeLabel} text={before} tone="neutral" />
        <div className="hidden lg:flex items-center justify-center text-zinc-600">
          <ArrowRight className="h-5 w-5" />
        </div>
        <Pane label={afterLabel} text={after} tone="emerald" />
      </div>

      {applied.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
            {appliedLabel}
          </p>
          <div className="flex flex-wrap gap-2">
            {applied.map((a, i) => (
              <span
                key={i}
                className="rounded-full bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-1 text-xs font-medium text-indigo-300"
              >
                {a.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {changes.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
            Changes
          </p>
          <ul className="space-y-1.5">
            {changes.map((c, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm text-zinc-300"
              >
                <span className="text-emerald-400 shrink-0">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {applied.length === 0 && changes.length === 0 && (
        <p className="text-xs text-zinc-500 italic">
          No structured detail captured for this run (older pipeline run, or the LLM
          didn't return structured output).
        </p>
      )}
    </div>
  );
}

function Pane({
  label,
  text,
  tone,
}: {
  label: string;
  text: string | null;
  tone: 'neutral' | 'emerald';
}) {
  const border =
    tone === 'emerald'
      ? 'border-emerald-500/30 bg-emerald-500/5'
      : 'border-white/10 bg-white/5';
  const labelColor = tone === 'emerald' ? 'text-emerald-300' : 'text-zinc-400';

  return (
    <div className={`flex flex-col rounded-xl border ${border}`}>
      <div className={`px-4 py-2 text-[10px] uppercase tracking-widest font-semibold ${labelColor}`}>
        {label}
      </div>
      <pre className="flex-1 whitespace-pre-wrap text-sm text-zinc-200 font-sans px-4 pb-4 leading-relaxed">
        {text || (
          <span className="text-zinc-500 italic">— empty —</span>
        )}
      </pre>
    </div>
  );
}
