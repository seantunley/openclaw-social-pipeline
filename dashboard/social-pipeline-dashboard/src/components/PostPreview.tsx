import { useState } from 'react';
import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, MoreHorizontal, Image as ImageIcon, Globe, Repeat2, ChevronLeft, ChevronRight } from 'lucide-react';

interface PostPreviewProps {
  platform: string;
  content: string;
  mediaUrl?: string | null;
  /**
   * Carousel slide URLs in author order (cover = index 0). When provided
   * and length > 1, the preview renders a swipeable strip with dots
   * indicator. `mediaUrl` is ignored in that case.
   */
  mediaUrls?: string[];
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
/**
 * Strip slide-divider markup (`## Slide N`, `**Slide N**`, `---` rules) and
 * collapse the per-slide text blocks. Used when rendering carousel captions
 * — Instagram carousels have ONE caption under the cover post, so the
 * slide-structure markers that drove image generation must not leak into
 * the visible copy. Single-image runs pass through unchanged.
 */
function stripCarouselMarkers(body: string): string {
  return body
    // Drop slide heading lines entirely: "## Slide 1", "**Slide 2**", etc.
    .replace(/^\s*##?\s*Slide\s+\d+\s*$/gim, '')
    .replace(/^\s*\*\*Slide\s+\d+\*\*\s*$/gim, '')
    // Drop standalone horizontal rules used as slide dividers.
    .replace(/^\s*---\s*$/gm, '')
    // Collapse runs of blank lines left behind.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function PostPreview({
  platform,
  content,
  mediaUrl,
  mediaUrls,
  brandName = 'Your Brand',
  brandHandle = 'yourbrand',
}: PostPreviewProps) {
  const p = platform.toLowerCase();
  const isCarousel = Array.isArray(mediaUrls) && mediaUrls.length > 1;
  const effectiveUrl = mediaUrl ?? mediaUrls?.[0] ?? null;
  const displayContent = isCarousel ? stripCarouselMarkers(content) : content;

  if (p === 'instagram' || p === 'instagram_reel' || p === 'instagram_carousel') {
    return <InstagramPreview content={displayContent} mediaUrl={effectiveUrl} mediaUrls={isCarousel ? mediaUrls : undefined} brandHandle={brandHandle} />;
  }
  if (p === 'facebook') {
    return <FacebookPreview content={displayContent} mediaUrl={effectiveUrl} mediaUrls={isCarousel ? mediaUrls : undefined} brandName={brandName} />;
  }
  if (p === 'linkedin') {
    return <LinkedInPreview content={displayContent} mediaUrl={effectiveUrl} mediaUrls={isCarousel ? mediaUrls : undefined} brandName={brandName} />;
  }
  if (p === 'twitter' || p === 'x') {
    return <TwitterPreview content={displayContent} mediaUrl={effectiveUrl} brandName={brandName} brandHandle={brandHandle} />;
  }
  // Fallback: clean text card
  return <GenericPreview content={displayContent} mediaUrl={effectiveUrl} brandName={brandName} platform={platform} />;
}

/**
 * Reusable swipeable carousel viewer. Used inside platform-specific previews
 * that support carousels (IG, FB, LinkedIn). Operator can click the chevrons
 * or the dots to step through; we don't bother with real swipe gestures
 * since this is a preview, not the published surface.
 */
function CarouselViewer({ urls, aspect = 'aspect-square' }: { urls: string[]; aspect?: string }) {
  const [idx, setIdx] = useState(0);
  const total = urls.length;
  const current = urls[idx];
  const prev = () => setIdx((i) => (i - 1 + total) % total);
  const next = () => setIdx((i) => (i + 1) % total);
  return (
    <div className={`relative w-full ${aspect} overflow-hidden bg-zinc-900`}>
      {current ? (
        <img src={current} alt={`slide ${idx + 1}`} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted">
          <ImageIcon className="h-12 w-12" />
        </div>
      )}
      <button
        onClick={prev}
        aria-label="previous slide"
        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1 text-white opacity-80 hover:opacity-100"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        onClick={next}
        aria-label="next slide"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1 text-white opacity-80 hover:opacity-100"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
        {idx + 1} / {total}
      </div>
      <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
        {urls.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            aria-label={`go to slide ${i + 1}`}
            className={`h-1.5 w-1.5 rounded-full transition-opacity ${i === idx ? 'bg-white' : 'bg-white/50'}`}
          />
        ))}
      </div>
    </div>
  );
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

function InstagramPreview({ content, mediaUrl, mediaUrls, brandHandle }: { content: string; mediaUrl?: string | null; mediaUrls?: string[]; brandHandle: string }) {
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

      {mediaUrls && mediaUrls.length > 1 ? (
        <CarouselViewer urls={mediaUrls} aspect="aspect-square" />
      ) : mediaUrl ? (
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

function FacebookPreview({ content, mediaUrl, mediaUrls, brandName }: { content: string; mediaUrl?: string | null; mediaUrls?: string[]; brandName: string }) {
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

      {mediaUrls && mediaUrls.length > 1 ? (
        <CarouselViewer urls={mediaUrls} aspect="aspect-[4/3]" />
      ) : mediaUrl ? (
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

function LinkedInPreview({ content, mediaUrl, mediaUrls, brandName }: { content: string; mediaUrl?: string | null; mediaUrls?: string[]; brandName: string }) {
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

      {mediaUrls && mediaUrls.length > 1 ? (
        <CarouselViewer urls={mediaUrls} aspect="aspect-square" />
      ) : mediaUrl ? (
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
