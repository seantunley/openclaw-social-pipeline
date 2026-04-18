import { cn } from '@/lib/utils';
import { Check, Image, Video, RefreshCw } from 'lucide-react';

interface MediaCardProps {
  asset: {
    id: string;
    url?: string;
    thumbnailUrl?: string;
    type: 'image' | 'video';
    prompt?: string;
    aspectRatio?: string;
  };
  selected?: boolean;
  onSelect?: (id: string) => void;
  onRegenerate?: (id: string) => void;
}

export default function MediaCard({ asset, selected, onSelect, onRegenerate }: MediaCardProps) {
  const TypeIcon = asset.type === 'video' ? Video : Image;

  return (
    <div
      className={cn(
        'group relative rounded-xl border overflow-hidden transition-all duration-200 cursor-pointer',
        selected
          ? 'border-indigo-500 ring-1 ring-indigo-500/50'
          : 'border-white/10 hover:border-white/20'
      )}
      onClick={() => onSelect?.(asset.id)}
    >
      <div className="aspect-square bg-zinc-800 relative">
        {asset.thumbnailUrl || asset.url ? (
          <img
            src={asset.thumbnailUrl || asset.url}
            alt="Generated media"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <TypeIcon className="h-10 w-10 text-zinc-600" />
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-zinc-300 backdrop-blur-sm">
            <TypeIcon className="h-3 w-3" />
            {asset.type}
          </span>
        </div>
        {selected && (
          <div className="absolute top-2 right-2 rounded-full bg-indigo-500 p-1">
            <Check className="h-3 w-3 text-white" />
          </div>
        )}
        {onRegenerate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRegenerate(asset.id);
            }}
            className="absolute bottom-2 right-2 rounded-lg bg-black/60 p-2 text-zinc-400 hover:text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {asset.prompt && (
        <div className="p-3 bg-card">
          <p className="text-xs text-muted line-clamp-2">{asset.prompt}</p>
        </div>
      )}
      {asset.aspectRatio && (
        <div className="px-3 pb-3 bg-card">
          <span className="text-xs text-zinc-500">{asset.aspectRatio}</span>
        </div>
      )}
    </div>
  );
}
