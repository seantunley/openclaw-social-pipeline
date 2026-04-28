import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, MoreHorizontal, Image as ImageIcon, Globe, Repeat2 } from 'lucide-react';

interface PostPreviewProps {
  platform: string;
  content: string;
  mediaUrl?: string | null;
  brandName?: string;
  brandHandle?: string;
}

/**
 * Renders the draft as it would appear on the chosen platform.
 *
 * Real platform UI is moving target — this is a recognisable approximation,
 * not pixel-perfect. The point is to let the operator see structure + length
 * + line breaks + hashtag placement before publishing.
 */
export default function PostPreview({
  platform,
  content,
  mediaUrl,
  brandName = 'Your Brand',
  brandHandle = 'yourbrand',
}: PostPreviewProps) {
  const p = platform.toLowerCase();

  if (p === 'instagram' || p === 'instagram_reel' || p === 'instagram_carousel') {
    return <InstagramPreview content={content} mediaUrl={mediaUrl} brandHandle={brandHandle} />;
  }
  if (p === 'facebook') {
    return <FacebookPreview content={content} mediaUrl={mediaUrl} brandName={brandName} />;
  }
  if (p === 'linkedin') {
    return <LinkedInPreview content={content} mediaUrl={mediaUrl} brandName={brandName} />;
  }
  if (p === 'twitter' || p === 'x') {
    return <TwitterPreview content={content} mediaUrl={mediaUrl} brandName={brandName} brandHandle={brandHandle} />;
  }
  // Fallback: clean text card
  return <GenericPreview content={content} mediaUrl={mediaUrl} brandName={brandName} platform={platform} />;
}

function Avatar({ initials, color }: { initials: string; color: string }) {
  return (
    <div
      className={`flex h-10 w-10 items-center justify-center rounded-full ${color} text-sm font-semibold text-white shrink-0`}
    >
      {initials}
    </div>
  );
}

function MediaPlaceholder({ aspect = 'aspect-square' }: { aspect?: string }) {
  return (
    <div className={`flex w-full items-center justify-center ${aspect} bg-gradient-to-br from-zinc-700 to-zinc-900 text-muted`}>
      <div className="flex flex-col items-center gap-2">
        <ImageIcon className="h-12 w-12" />
        <span className="text-xs">Image not generated</span>
      </div>
    </div>
  );
}

// ── Instagram ────────────────────────────────────────────────────────────────

function InstagramPreview({ content, mediaUrl, brandHandle }: { content: string; mediaUrl?: string | null; brandHandle: string }) {
  const lines = content.split('\n');
  const firstLine = lines[0];
  const rest = lines.slice(1).join('\n');

  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-xl border border-zinc-300/30 bg-white text-black shadow-2xl">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-[2px]">
          <Avatar initials={brandHandle[0]?.toUpperCase() ?? 'B'} color="bg-zinc-200 text-faint" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold">{brandHandle}</p>
          <p className="text-xs text-muted">Sponsored</p>
        </div>
        <MoreHorizontal className="h-5 w-5 text-faint" />
      </div>

      {mediaUrl ? (
        <img src={mediaUrl} alt="" className="aspect-square w-full object-cover" />
      ) : (
        <MediaPlaceholder aspect="aspect-square" />
      )}

      <div className="flex items-center gap-3.5 px-3 pt-3">
        <Heart className="h-6 w-6 text-zinc-900" />
        <MessageCircle className="h-6 w-6 text-zinc-900" />
        <Send className="h-6 w-6 text-zinc-900" />
        <Bookmark className="ml-auto h-6 w-6 text-zinc-900" />
      </div>

      <div className="px-3 py-2 text-sm leading-snug">
        <p className="font-semibold">42,318 likes</p>
        <p className="mt-1 whitespace-pre-wrap">
          <span className="font-semibold">{brandHandle}</span>{' '}
          <span>{firstLine}</span>
        </p>
        {rest && (
          <p className="mt-1 whitespace-pre-wrap text-faint">{rest}</p>
        )}
        <p className="mt-2 text-xs uppercase tracking-wide text-muted">3 hours ago</p>
      </div>
    </div>
  );
}

// ── Facebook ─────────────────────────────────────────────────────────────────

function FacebookPreview({ content, mediaUrl, brandName }: { content: string; mediaUrl?: string | null; brandName: string }) {
  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-lg border border-zinc-300/30 bg-white text-black shadow-2xl font-sans">
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar initials={brandName[0]?.toUpperCase() ?? 'B'} color="bg-blue-600" />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold">{brandName}</p>
          <p className="flex items-center gap-1 text-xs text-muted">
            <span>3h</span>
            <span>·</span>
            <Globe className="h-3 w-3" />
          </p>
        </div>
        <MoreHorizontal className="h-5 w-5 text-faint" />
      </div>

      <div className="px-4 pb-3 text-[15px] leading-snug whitespace-pre-wrap">
        {content}
      </div>

      {mediaUrl ? (
        <img src={mediaUrl} alt="" className="w-full object-cover" />
      ) : (
        <MediaPlaceholder aspect="aspect-[4/3]" />
      )}

      <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-2 text-sm text-faint">
        <button className="flex flex-1 items-center justify-center gap-2 py-1.5 hover:bg-zinc-100 rounded">
          <ThumbsUp className="h-4 w-4" />
          Like
        </button>
        <button className="flex flex-1 items-center justify-center gap-2 py-1.5 hover:bg-zinc-100 rounded">
          <MessageCircle className="h-4 w-4" />
          Comment
        </button>
        <button className="flex flex-1 items-center justify-center gap-2 py-1.5 hover:bg-zinc-100 rounded">
          <Send className="h-4 w-4" />
          Share
        </button>
      </div>
    </div>
  );
}

// ── LinkedIn ─────────────────────────────────────────────────────────────────

function LinkedInPreview({ content, mediaUrl, brandName }: { content: string; mediaUrl?: string | null; brandName: string }) {
  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-lg border border-zinc-300/30 bg-white text-black shadow-2xl">
      <div className="flex items-start gap-3 px-4 py-3">
        <Avatar initials={brandName[0]?.toUpperCase() ?? 'B'} color="bg-[#0a66c2]" />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold">{brandName}</p>
          <p className="truncate text-xs text-muted">Sponsored · Following</p>
          <p className="flex items-center gap-1 text-xs text-muted">
            <span>3h</span>
            <span>·</span>
            <Globe className="h-3 w-3" />
          </p>
        </div>
      </div>

      <div className="px-4 pb-3 text-[14px] leading-snug whitespace-pre-wrap">
        {content}
      </div>

      {mediaUrl ? (
        <img src={mediaUrl} alt="" className="w-full object-cover" />
      ) : (
        <MediaPlaceholder aspect="aspect-square" />
      )}

      <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-2 text-xs font-semibold text-faint">
        <button className="flex flex-1 items-center justify-center gap-2 py-2 hover:bg-zinc-100 rounded">
          <ThumbsUp className="h-4 w-4" />
          Like
        </button>
        <button className="flex flex-1 items-center justify-center gap-2 py-2 hover:bg-zinc-100 rounded">
          <MessageCircle className="h-4 w-4" />
          Comment
        </button>
        <button className="flex flex-1 items-center justify-center gap-2 py-2 hover:bg-zinc-100 rounded">
          <Repeat2 className="h-4 w-4" />
          Repost
        </button>
        <button className="flex flex-1 items-center justify-center gap-2 py-2 hover:bg-zinc-100 rounded">
          <Send className="h-4 w-4" />
          Send
        </button>
      </div>
    </div>
  );
}

// ── Twitter / X ──────────────────────────────────────────────────────────────

function TwitterPreview({ content, mediaUrl, brandName, brandHandle }: { content: string; mediaUrl?: string | null; brandName: string; brandHandle: string }) {
  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-zinc-700 bg-black text-primaryText shadow-2xl">
      <div className="flex items-start gap-3 px-4 py-3">
        <Avatar initials={brandName[0]?.toUpperCase() ?? 'B'} color="bg-zinc-700" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-1">
            <span className="text-[15px] font-bold">{brandName}</span>
            <span className="text-[14px] text-muted">@{brandHandle} · 3h</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[15px] leading-snug">{content}</p>
          {mediaUrl ? (
            <img src={mediaUrl} alt="" className="mt-3 w-full rounded-2xl object-cover" />
          ) : (
            <div className="mt-3 overflow-hidden rounded-2xl">
              <MediaPlaceholder aspect="aspect-video" />
            </div>
          )}
          <div className="mt-3 flex items-center justify-between text-muted">
            <span className="flex items-center gap-1.5 text-xs"><MessageCircle className="h-4 w-4" /> 24</span>
            <span className="flex items-center gap-1.5 text-xs"><Repeat2 className="h-4 w-4" /> 187</span>
            <span className="flex items-center gap-1.5 text-xs"><Heart className="h-4 w-4" /> 1.2K</span>
            <span className="flex items-center gap-1.5 text-xs"><Send className="h-4 w-4" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Generic ──────────────────────────────────────────────────────────────────

function GenericPreview({ content, mediaUrl, brandName, platform }: { content: string; mediaUrl?: string | null; brandName: string; platform: string }) {
  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar initials={brandName[0]?.toUpperCase() ?? 'B'} color="bg-zinc-700" />
          <div>
            <p className="text-sm font-semibold">{brandName}</p>
            <p className="text-xs text-muted capitalize">{platform}</p>
          </div>
        </div>
      </div>
      {mediaUrl ? (
        <img src={mediaUrl} alt="" className="w-full object-cover" />
      ) : (
        <MediaPlaceholder aspect="aspect-square" />
      )}
      <div className="px-4 py-3 text-sm whitespace-pre-wrap">{content}</div>
    </div>
  );
}
