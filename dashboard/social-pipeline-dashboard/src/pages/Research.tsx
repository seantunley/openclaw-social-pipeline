import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Loader2,
  FlaskConical,
  TrendingUp,
  Leaf,
  FileText,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ArrowRight,
  Check,
  X,
  Archive,
  Sparkles,
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import {
  fetchResearch,
  updateResearchStatus,
  promoteResearch,
} from '@/lib/api';

const TYPE_BADGES: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  trend: { icon: <TrendingUp className="w-3 h-3" />, label: 'Trend', color: 'text-amber-400 bg-amber-500/15' },
  evergreen: { icon: <Leaf className="w-3 h-3" />, label: 'Evergreen', color: 'text-emerald-400 bg-emerald-500/15' },
  research: { icon: <FlaskConical className="w-3 h-3" />, label: 'Research', color: 'text-blue-400 bg-blue-500/15' },
};

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: '#0A66C2',
  twitter: '#1DA1F2',
  instagram: '#E1306C',
  facebook: '#1877F2',
  tiktok: '#69C9D0',
  youtube: '#FF0000',
  reddit: '#FF4500',
  pinterest: '#E60023',
  bluesky: '#0085FF',
  threads: '#999',
  vk: '#4680C2',
};

function ResearchRow({ item, onUpdate }: { item: any; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const typeBadge = TYPE_BADGES[item.content_type] ?? TYPE_BADGES.research;

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateResearchStatus(item.id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research'] });
      onUpdate();
    },
  });

  const promoteMutation = useMutation({
    mutationFn: () => promoteResearch(item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research'] });
      onUpdate();
    },
  });

  return (
    <div className="rounded-xl border border-zinc-800 bg-card hover:border-zinc-700 transition-colors">
      {/* Collapsed row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-200 truncate">{item.title || item.topic}</p>
          {item.brief && (
            <p className="text-xs text-zinc-500 truncate mt-0.5">{item.brief}</p>
          )}
        </div>

        <span className={cn('text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1', typeBadge.color)}>
          {typeBadge.icon} {typeBadge.label}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {(item.platforms ?? []).slice(0, 4).map((p: string) => (
            <span
              key={p}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold uppercase"
              style={{
                backgroundColor: (PLATFORM_COLORS[p] ?? '#666') + '25',
                color: PLATFORM_COLORS[p] ?? '#666',
              }}
            >
              {p.slice(0, 2)}
            </span>
          ))}
        </div>

        <StatusBadge status={item.status} />

        <span className="text-[10px] text-zinc-600 shrink-0 w-20 text-right">
          {item.researched_at?.split('T')[0]}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-zinc-800 p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {item.angle && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Angle</p>
                <p className="text-sm text-zinc-300">{item.angle}</p>
              </div>
            )}
            {item.why_now && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Why Now</p>
                <p className="text-sm text-zinc-300">{item.why_now}</p>
              </div>
            )}
          </div>

          {item.source_summary && (
            <div className="bg-white/[0.02] border border-zinc-800 rounded-lg p-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">What Sources Say</p>
              <p className="text-sm text-zinc-400">{item.source_summary}</p>
            </div>
          )}

          {item.suggested_format && (
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Suggested Format</p>
              <span className="text-xs px-2 py-1 rounded-md bg-zinc-800 text-zinc-300">
                <FileText className="w-3 h-3 inline mr-1" />
                {item.suggested_format.replace(/_/g, ' ')}
              </span>
            </div>
          )}

          {(item.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.tags.map((tag: string) => (
                <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {(item.sources ?? []).length > 0 && (
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Sources</p>
              <div className="space-y-1">
                {item.sources.map((s: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded capitalize"
                      style={{
                        color: PLATFORM_COLORS[s.platform] ?? '#999',
                        backgroundColor: (PLATFORM_COLORS[s.platform] ?? '#999') + '15',
                      }}
                    >
                      {s.platform}
                    </span>
                    <span className="text-zinc-400 flex-1 truncate">{s.signal}</span>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:text-zinc-400">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {(item.status === 'pending' || item.status === 'approved') && (
            <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
              {item.status === 'pending' && (
                <>
                  <button
                    onClick={() => statusMutation.mutate('approved')}
                    disabled={statusMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 text-xs transition-colors"
                  >
                    <Check className="w-3 h-3" /> Approve
                  </button>
                  <button
                    onClick={() => statusMutation.mutate('rejected')}
                    disabled={statusMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 text-xs transition-colors"
                  >
                    <X className="w-3 h-3" /> Reject
                  </button>
                </>
              )}
              <button
                onClick={() => promoteMutation.mutate()}
                disabled={promoteMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 text-xs transition-colors ml-auto"
              >
                {promoteMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ArrowRight className="w-3 h-3" />
                )}
                Create Content Run
              </button>
              <button
                onClick={() => statusMutation.mutate('archived')}
                disabled={statusMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
              >
                <Archive className="w-3 h-3" /> Archive
              </button>
            </div>
          )}

          {item.status === 'promoted' && item.promoted_run_id && (
            <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
              <a
                href={`/runs/${item.promoted_run_id}`}
                className="flex items-center gap-1.5 text-xs text-indigo-400 hover:underline"
              >
                <ArrowRight className="w-3 h-3" /> View content run
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ResearchPage() {
  const [filter, setFilter] = useState('all');
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['research', filter],
    queryFn: () => fetchResearch(filter === 'all' ? undefined : filter),
  });

  const counts = {
    all: items.length,
    pending: items.filter((i: any) => i.status === 'pending').length,
    approved: items.filter((i: any) => i.status === 'approved').length,
    promoted: items.filter((i: any) => i.status === 'promoted').length,
    rejected: items.filter((i: any) => i.status === 'rejected').length,
  };

  // When filter is applied server-side, show all from current query
  const displayed = filter === 'all' ? items : items;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-indigo-400" />
            Research Library
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1">
            Research findings from pipeline runs — review, approve, and promote to content
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-white/[0.03] rounded-lg p-0.5 border border-zinc-800 w-fit">
        {[
          { id: 'all', label: 'All' },
          { id: 'pending', label: 'Pending' },
          { id: 'approved', label: 'Approved' },
          { id: 'promoted', label: 'Promoted' },
          { id: 'rejected', label: 'Rejected' },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              filter === f.id ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            {f.label}
            {counts[f.id as keyof typeof counts] > 0 && (
              <span className="ml-1.5 text-[10px] text-zinc-600">
                ({counts[f.id as keyof typeof counts]})
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-16 text-center">
          <FlaskConical className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">No research findings yet</p>
          <p className="text-xs text-zinc-600 mt-1">
            Research outputs from pipeline runs will appear here for review
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((item: any) => (
            <ResearchRow
              key={item.id}
              item={item}
              onUpdate={() => queryClient.invalidateQueries({ queryKey: ['research'] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
