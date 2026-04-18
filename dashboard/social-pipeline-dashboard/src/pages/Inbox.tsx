import { useEffect, useState } from 'react';
import {
  Inbox,
  Loader2,
  MessageCircle,
  Heart,
  Share2,
  AtSign,
  RefreshCw,
  Send,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { fetchInboxStatus, fetchInboxNotifications, replyToPost, reactToPost } from '@/lib/api';

const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  youtube: '#FF0000',
  twitter: '#1DA1F2',
  linkedin: '#0A66C2',
  tiktok: '#69C9D0',
  reddit: '#FF4500',
  pinterest: '#E60023',
  bluesky: '#0085FF',
  threads: '#ffffff',
  vk: '#4680C2',
  default: '#a78bfa',
};

const TYPE_ICONS: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  comment: { icon: <MessageCircle className="h-4 w-4" />, label: 'Comment', color: 'text-blue-400' },
  mention: { icon: <AtSign className="h-4 w-4" />, label: 'Mention', color: 'text-purple-400' },
  like: { icon: <Heart className="h-4 w-4" />, label: 'Like', color: 'text-pink-400' },
  share: { icon: <Share2 className="h-4 w-4" />, label: 'Share', color: 'text-green-400' },
  reply: { icon: <MessageCircle className="h-4 w-4" />, label: 'Reply', color: 'text-cyan-400' },
};

function getRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export default function InboxPage() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const loadInbox = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const status = await fetchInboxStatus();
      setAvailable(status.available);
      if (!status.available) return;

      const data = await fetchInboxNotifications();
      if (Array.isArray(data)) {
        setNotifications(data);
      } else if (data?.notifications) {
        setNotifications(data.notifications);
      } else if (data?.data) {
        setNotifications(data.data);
      } else {
        setNotifications([]);
      }
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadInbox();
  }, []);

  const handleReply = async (postId: string, commentId?: string) => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await replyToPost(postId, replyText.trim(), commentId);
      setReplyText('');
      setReplyingTo(null);
      loadInbox(true);
    } catch (err: any) {
      console.error('Reply failed:', err.message);
    } finally {
      setSending(false);
    }
  };

  const handleReact = async (postId: string) => {
    try {
      await reactToPost(postId);
    } catch (err: any) {
      console.error('React failed:', err.message);
    }
  };

  const filtered =
    filter === 'all'
      ? notifications
      : notifications.filter((n) => n.type === filter || n.platform === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (available === false) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-100">Inbox</h1>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1">
            Mentions, comments, and engagement across platforms
          </p>
        </div>
        <div className="rounded-xl border border-dashed border-yellow-500/30 bg-yellow-500/[0.04] p-10 text-center">
          <AlertCircle className="h-10 w-10 text-yellow-500/30 mx-auto mb-3" />
          <p className="text-sm text-zinc-400">Postiz is not configured</p>
          <p className="text-xs text-zinc-600 mt-1">
            Add your Postiz API key in Settings to enable the engagement inbox. The inbox pulls
            mentions, comments, and DMs from all connected platforms.
          </p>
          <a href="/settings" className="inline-block mt-4 text-xs text-indigo-400 hover:underline">
            Go to Settings
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-100">Inbox</h1>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1">
            Mentions, comments, and engagement across platforms &middot; {notifications.length} items
          </p>
        </div>
        <button
          onClick={() => loadInbox(true)}
          disabled={refreshing}
          className="rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex gap-1 bg-white/[0.03] rounded-lg p-0.5 border border-zinc-800 w-fit">
        {[
          { id: 'all', label: 'All' },
          { id: 'comment', label: 'Comments' },
          { id: 'mention', label: 'Mentions' },
          { id: 'like', label: 'Likes' },
          { id: 'share', label: 'Shares' },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              filter === f.id ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-16 text-center">
          <Inbox className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">
            {notifications.length === 0 ? 'No notifications yet' : 'No matching notifications'}
          </p>
          <p className="text-xs text-zinc-600 mt-1">
            Engagement from your connected platforms will appear here
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item: any, i: number) => {
            const typeInfo = TYPE_ICONS[item.type] ?? TYPE_ICONS.comment;
            const platformColor = PLATFORM_COLORS[item.platform] ?? PLATFORM_COLORS.default;
            const isReplying = replyingTo === (item.id ?? String(i));

            return (
              <div
                key={item.id ?? i}
                className="rounded-xl border border-zinc-800 bg-card p-4 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div
                    className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-white font-bold text-xs uppercase"
                    style={{ backgroundColor: platformColor + '30', color: platformColor }}
                  >
                    {(item.author?.name ?? item.username ?? item.platform ?? '?').slice(0, 2)}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Header row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-zinc-200">
                        {item.author?.name ?? item.username ?? 'Unknown'}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 ${typeInfo.color} bg-white/[0.05]`}
                      >
                        {typeInfo.icon} {typeInfo.label}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full capitalize"
                        style={{ color: platformColor, backgroundColor: platformColor + '15' }}
                      >
                        {item.platform}
                      </span>
                      <span className="text-[10px] text-zinc-600 ml-auto shrink-0">
                        {item.createdAt ? getRelativeTime(item.createdAt) : ''}
                      </span>
                    </div>

                    {/* Content */}
                    {item.content && (
                      <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">{item.content}</p>
                    )}

                    {/* Post context */}
                    {item.postTitle && (
                      <p className="text-xs text-zinc-600 mt-1 truncate">on: {item.postTitle}</p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-2.5">
                      <button
                        onClick={() => {
                          setReplyingTo(isReplying ? null : (item.id ?? String(i)));
                          setReplyText('');
                        }}
                        className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                      >
                        <MessageCircle className="h-3 w-3" /> Reply
                      </button>
                      <button
                        onClick={() => handleReact(item.postId ?? item.id)}
                        className="text-[11px] text-zinc-500 hover:text-pink-400 flex items-center gap-1 transition-colors"
                      >
                        <Heart className="h-3 w-3" /> Like
                      </button>
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" /> View
                        </a>
                      )}
                    </div>

                    {/* Reply input */}
                    {isReplying && (
                      <div className="flex gap-2 mt-3">
                        <input
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === 'Enter' &&
                            handleReply(item.postId ?? item.id, item.commentId ?? item.id)
                          }
                          placeholder="Write a reply..."
                          className="flex-1 bg-white/[0.03] border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                          autoFocus
                        />
                        <button
                          onClick={() =>
                            handleReply(item.postId ?? item.id, item.commentId ?? item.id)
                          }
                          disabled={sending || !replyText.trim()}
                          className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-sm text-white disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                        >
                          {sending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
