import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Video, Filter, RefreshCw } from 'lucide-react';
import MediaCard from '@/components/MediaCard';
import Modal from '@/components/Modal';
import { cn } from '@/lib/utils';
import { regenerateMedia } from '@/lib/api';
import { useT } from '@/lib/i18n';

export default function MediaStudio() {
  const t = useT();
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video'>('all');
  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  const [regenerating, setRegenerating] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['media'],
    queryFn: async () => {
      const res = await fetch('/api/social/media-assets');
      if (!res.ok) throw new Error('Failed to fetch media');
      return res.json();
    },
  });

  const allMedia = data?.media || data || [];
  const filtered =
    typeFilter === 'all'
      ? allMedia
      : (allMedia as any[]).filter((m: any) => m.type === typeFilter);

  const handleRegenerate = async (assetId: string) => {
    const asset = (allMedia as any[]).find(
      (m: any) => (m.id || m._id) === assetId
    );
    if (!asset?.runId) return;
    setRegenerating(true);
    try {
      await regenerateMedia(asset.runId);
      refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primaryText">{t('media_studio.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('media_studio.subtitle')}</p>
      </div>

      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted" />
        {(['all', 'image', 'video'] as const).map((kind) => (
          <button
            key={kind}
            onClick={() => setTypeFilter(kind)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium border transition-colors',
              typeFilter === kind
                ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-300'
                : 'bg-surface-soft border-border-strong text-muted hover:border-border-strong/60'
            )}
          >
            {kind === 'image' && <ImageIcon className="h-3.5 w-3.5" />}
            {kind === 'video' && <Video className="h-3.5 w-3.5" />}
            {t(`media_studio.filter.${kind}`)}
            {kind !== 'all' && (
              <span className="ml-1 text-xs text-muted">
                ({(allMedia as any[]).filter((m: any) => m.type === kind).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-xl bg-surface-soft border border-border-strong animate-skeleton-pulse"
            />
          ))}
        </div>
      ) : (filtered as any[]).length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {(filtered as any[]).map((asset: any) => (
            <div key={asset.id || asset._id}>
              <MediaCard
                asset={asset}
                selected={asset.selected}
                onSelect={() => setSelectedAsset(asset)}
                onRegenerate={() => handleRegenerate(asset.id || asset._id)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-muted">
          <ImageIcon className="h-12 w-12 mb-4 text-faint" />
          <p className="text-lg font-medium text-secondaryText">{t('media_studio.empty_title')}</p>
          <p className="text-sm mt-1">{t('media_studio.empty_body')}</p>
        </div>
      )}

      <Modal
        open={!!selectedAsset}
        onClose={() => setSelectedAsset(null)}
        title={t('media_studio.detail_title')}
        className="max-w-3xl"
      >
        {selectedAsset && (
          <div className="space-y-4">
            <div className="rounded-lg overflow-hidden bg-elevated border border-border-strong">
              {selectedAsset.url || selectedAsset.thumbnailUrl ? (
                <img
                  src={selectedAsset.url || selectedAsset.thumbnailUrl}
                  alt="Generated media"
                  className="w-full max-h-[400px] object-contain"
                />
              ) : (
                <div className="flex items-center justify-center h-64">
                  <ImageIcon className="h-16 w-16 text-faint" />
                </div>
              )}
            </div>
            {selectedAsset.prompt && (
              <div>
                <p className="text-xs font-medium text-muted mb-1">{t('media_studio.prompt')}</p>
                <p className="text-sm text-secondaryText bg-surface-soft rounded-lg p-3 border border-border-strong">
                  {selectedAsset.prompt}
                </p>
              </div>
            )}
            <div className="flex items-center gap-4">
              {selectedAsset.aspectRatio && (
                <div>
                  <p className="text-xs text-muted">{t('media_studio.aspect_ratio')}</p>
                  <p className="text-sm text-secondaryText">{selectedAsset.aspectRatio}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted">{t('media_studio.type')}</p>
                <p className="text-sm text-secondaryText capitalize">{selectedAsset.type}</p>
              </div>
              {selectedAsset.selected !== undefined && (
                <div>
                  <p className="text-xs text-muted">{t('media_studio.status')}</p>
                  <p className="text-sm text-secondaryText">
                    {selectedAsset.selected ? t('media_studio.selected') : t('media_studio.not_selected')}
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => handleRegenerate(selectedAsset.id || selectedAsset._id)}
                disabled={regenerating}
                className="flex items-center gap-2 rounded-lg bg-surface-soft border border-border-strong px-4 py-2 text-sm text-secondaryText hover:bg-surface-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn('h-4 w-4', regenerating && 'animate-spin')} />
                {t('media_studio.regenerate')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
