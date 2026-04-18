import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Loader2,
  Plus,
  X,
  Shield,
  TrendingUp,
  BarChart3,
  MessageCircle,
  Pencil,
  Trash2,
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import { cn } from '@/lib/utils';
import { fetchLearnings, addLearningRule, deactivateLearning } from '@/lib/api';

const CATEGORIES = [
  'tone', 'structure', 'hook', 'cta', 'vocabulary',
  'platform', 'topic', 'media', 'timing', 'audience',
  'avoidance', 'psychology',
];

const CATEGORY_COLORS: Record<string, string> = {
  tone: 'text-purple-400 bg-purple-500/15',
  structure: 'text-blue-400 bg-blue-500/15',
  hook: 'text-amber-400 bg-amber-500/15',
  cta: 'text-emerald-400 bg-emerald-500/15',
  vocabulary: 'text-red-400 bg-red-500/15',
  platform: 'text-cyan-400 bg-cyan-500/15',
  topic: 'text-indigo-400 bg-indigo-500/15',
  media: 'text-pink-400 bg-pink-500/15',
  timing: 'text-yellow-400 bg-yellow-500/15',
  audience: 'text-teal-400 bg-teal-500/15',
  avoidance: 'text-rose-400 bg-rose-500/15',
  psychology: 'text-violet-400 bg-violet-500/15',
};

const SOURCE_ICONS: Record<string, { icon: React.ReactNode; label: string }> = {
  draft_edit: { icon: <Pencil className="w-3 h-3" />, label: 'From Edit' },
  rejection: { icon: <X className="w-3 h-3" />, label: 'From Rejection' },
  revision_request: { icon: <MessageCircle className="w-3 h-3" />, label: 'From Revision' },
  analytics: { icon: <BarChart3 className="w-3 h-3" />, label: 'From Analytics' },
  operator_rule: { icon: <Shield className="w-3 h-3" />, label: 'Operator Rule' },
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.8 ? 'bg-emerald-500' :
    value >= 0.5 ? 'bg-amber-500' :
    'bg-zinc-500';

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-500 w-8">{pct}%</span>
    </div>
  );
}

export default function LearningsPage() {
  const [filter, setFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRule, setNewRule] = useState({ category: 'tone', content: '', platform: '' });
  const queryClient = useQueryClient();

  const { data: learnings = [], isLoading } = useQuery({
    queryKey: ['learnings', filter],
    queryFn: () => fetchLearnings(filter === 'all' ? undefined : filter),
  });

  const addRuleMutation = useMutation({
    mutationFn: () => addLearningRule(newRule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learnings'] });
      setShowAddModal(false);
      setNewRule({ category: 'tone', content: '', platform: '' });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateLearning,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['learnings'] }),
  });

  const grouped: Record<string, any[]> = {};
  for (const l of learnings) {
    const cat = l.category || 'other';
    (grouped[cat] ??= []).push(l);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <Brain className="w-6 h-6 text-indigo-400" />
            Content Learnings
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1">
            Patterns learned from edits, rejections, and analytics — applied to future content
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Rule
        </button>
      </div>

      {/* Category filter */}
      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs transition-colors',
            filter === 'all' ? 'bg-white/10 text-white' : 'bg-white/[0.03] text-zinc-500 hover:text-zinc-300'
          )}
        >
          All ({learnings.length})
        </button>
        {CATEGORIES.filter((c) => grouped[c]?.length).map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs capitalize transition-colors',
              filter === cat ? 'bg-white/10 text-white' : 'bg-white/[0.03] text-zinc-500 hover:text-zinc-300'
            )}
          >
            {cat} ({grouped[cat]?.length ?? 0})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      ) : learnings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-16 text-center">
          <Brain className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">No learnings yet</p>
          <p className="text-xs text-zinc-600 mt-1">
            The system learns from draft edits, rejections, and analytics performance
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {(filter === 'all' ? learnings : learnings.filter((l: any) => l.category === filter)).map((learning: any) => {
            const catColor = CATEGORY_COLORS[learning.category] ?? 'text-zinc-400 bg-zinc-500/15';
            const source = SOURCE_ICONS[learning.source_type] ?? SOURCE_ICONS.operator_rule;

            return (
              <div
                key={learning.id}
                className={cn(
                  'rounded-xl border bg-card p-4 transition-colors',
                  learning.active ? 'border-zinc-800 hover:border-zinc-700' : 'border-zinc-900 opacity-50'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className={cn('text-[10px] px-2 py-0.5 rounded-full capitalize', catColor)}>
                        {learning.category}
                      </span>
                      {learning.platform && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                          {learning.platform}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600 flex items-center gap-1">
                        {source.icon} {source.label}
                      </span>
                      {learning.reinforcement_count > 1 && (
                        <span className="text-[10px] text-zinc-600 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" /> {learning.reinforcement_count}x reinforced
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-200">{learning.content}</p>
                    {(learning.tags ?? []).length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {learning.tags.map((tag: string) => (
                          <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <ConfidenceBar value={learning.confidence} />
                    {learning.active && (
                      <button
                        onClick={() => deactivateMutation.mutate(learning.id)}
                        className="text-zinc-600 hover:text-red-400 transition-colors"
                        title="Deactivate"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Rule Modal */}
      {showAddModal && (
        <Modal open={showAddModal} onClose={() => setShowAddModal(false)}>
          <h3 className="text-lg font-semibold text-zinc-100 mb-4">Add Content Rule</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Explicit rules have 100% confidence and never decay. Use for hard brand rules.
          </p>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Category</label>
              <select
                value={newRule.category}
                onChange={(e) => setNewRule({ ...newRule, category: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Platform (optional)</label>
              <input
                value={newRule.platform}
                onChange={(e) => setNewRule({ ...newRule, platform: e.target.value })}
                placeholder="e.g. linkedin (leave empty for all)"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Rule</label>
              <textarea
                value={newRule.content}
                onChange={(e) => setNewRule({ ...newRule, content: e.target.value })}
                placeholder="e.g. Never use clickbait headlines on LinkedIn"
                rows={3}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={() => addRuleMutation.mutate()}
                disabled={!newRule.content.trim() || addRuleMutation.isPending}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs disabled:opacity-50 flex items-center gap-1.5"
              >
                {addRuleMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                Save Rule
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
