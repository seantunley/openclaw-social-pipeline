import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Megaphone, Play, ChevronRight } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import { cn, formatDate } from '@/lib/utils';

export default function Campaigns() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    platforms: [] as string[],
    description: '',
  });
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const res = await fetch('/api/campaigns');
      if (!res.ok) throw new Error('Failed to fetch campaigns');
      return res.json();
    },
  });

  const createCampaign = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create campaign');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setShowCreate(false);
      setFormData({ name: '', platforms: [], description: '' });
    },
  });

  const campaigns = data?.campaigns || data || [];
  const platformOptions = ['twitter', 'linkedin', 'instagram', 'facebook', 'tiktok'];

  const togglePlatform = (platform: string) => {
    setFormData((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter((p) => p !== platform)
        : [...prev.platforms, platform],
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">Manage your content campaigns</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Campaign
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 rounded-xl bg-white/5 border border-white/10 animate-skeleton-pulse"
            />
          ))}
        </div>
      ) : (campaigns as any[]).length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(campaigns as any[]).map((campaign: any) => (
            <div
              key={campaign.id || campaign._id}
              onClick={() => setSelectedCampaign(campaign)}
              className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-5 cursor-pointer hover:border-white/20 hover:bg-white/[0.07] transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-indigo-500/10 p-2.5">
                    <Megaphone className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-zinc-100">{campaign.name}</h3>
                    <StatusBadge status={campaign.status || 'active'} />
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-600" />
              </div>
              {campaign.description && (
                <p className="mt-3 text-sm text-zinc-400 line-clamp-2">
                  {campaign.description}
                </p>
              )}
              <div className="mt-4 flex items-center justify-between">
                <div className="flex gap-1.5">
                  {(campaign.platforms || []).map((p: string) => (
                    <span
                      key={p}
                      className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-zinc-300 capitalize"
                    >
                      {p}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted">
                  <Play className="h-3 w-3" />
                  {campaign.runCount ?? 0} runs
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <Megaphone className="h-12 w-12 mb-4 text-zinc-600" />
          <p className="text-lg font-medium text-zinc-400">No campaigns yet</p>
          <p className="text-sm mt-1">Create your first campaign to get started</p>
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setFormData({ name: '', platforms: [], description: '' });
        }}
        title="Create Campaign"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Campaign Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g., Q1 Product Launch"
              className="w-full rounded-lg bg-zinc-800 border border-white/10 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Platforms
            </label>
            <div className="flex flex-wrap gap-2">
              {platformOptions.map((p) => (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm capitalize border transition-colors',
                    formData.platforms.includes(p)
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                      : 'bg-white/5 border-white/10 text-zinc-400 hover:border-white/20'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="Brief description of the campaign..."
              rows={3}
              className="w-full rounded-lg bg-zinc-800 border border-white/10 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={() => createCampaign.mutate(formData)}
              disabled={!formData.name.trim() || createCampaign.isPending}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {createCampaign.isPending ? 'Creating...' : 'Create Campaign'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!selectedCampaign}
        onClose={() => setSelectedCampaign(null)}
        title={selectedCampaign?.name || 'Campaign Detail'}
        className="max-w-2xl"
      >
        {selectedCampaign && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <StatusBadge status={selectedCampaign.status || 'active'} />
              <div className="flex gap-1.5 ml-auto">
                {(selectedCampaign.platforms || []).map((p: string) => (
                  <span
                    key={p}
                    className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-zinc-300 capitalize"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
            {selectedCampaign.description && (
              <p className="text-sm text-zinc-300">{selectedCampaign.description}</p>
            )}
            <div>
              <h4 className="text-sm font-medium text-zinc-300 mb-2">Recent Runs</h4>
              {(selectedCampaign.runs || []).length > 0 ? (
                <div className="space-y-2">
                  {selectedCampaign.runs.map((run: any) => (
                    <div
                      key={run.id || run._id}
                      onClick={() => {
                        setSelectedCampaign(null);
                        navigate(`/runs/${run.id || run._id}`);
                      }}
                      className="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-4 py-3 cursor-pointer hover:bg-white/[0.07] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <StatusBadge status={run.status} />
                        <span className="text-sm text-zinc-300 capitalize">
                          {run.platform}
                        </span>
                      </div>
                      <span className="text-xs text-muted">{formatDate(run.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">No runs for this campaign</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
