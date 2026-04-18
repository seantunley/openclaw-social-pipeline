/**
 * Inbox tools — give the OpenClaw agent access to Postiz social inbox
 * (mentions, comments, likes, shares, DMs across all connected platforms)
 */

import type { ToolResult } from './types.js';

// ---------------------------------------------------------------------------
// Postiz inbox helpers
// ---------------------------------------------------------------------------

function getPostizConfig(): { apiUrl: string; apiKey: string } {
  const apiKey = process.env.POSTIZ_API_KEY ?? '';
  const apiUrl = process.env.POSTIZ_API_BASE_URL ?? 'https://api.postiz.com';
  return { apiUrl, apiKey };
}

async function postizFetch(path: string, opts?: RequestInit): Promise<any> {
  const { apiUrl, apiKey } = getPostizConfig();
  if (!apiKey) return null;
  const res = await fetch(`${apiUrl}/public/v1${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(15000),
    ...opts,
  });
  if (!res.ok) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Check if the Postiz inbox is available (API key configured)
 */
export async function social_inbox_status(): Promise<ToolResult> {
  const { apiKey } = getPostizConfig();
  return {
    success: true,
    data: { available: !!apiKey },
  };
}

/**
 * List inbox notifications — mentions, comments, likes, shares from all platforms.
 * Returns the latest engagement items from Postiz.
 */
export async function social_inbox_list(params: {
  page?: number;
  filter?: 'all' | 'comment' | 'mention' | 'like' | 'share' | 'reply';
}): Promise<ToolResult> {
  const { apiKey } = getPostizConfig();
  if (!apiKey) {
    return { success: false, data: null, error: 'Postiz API key not configured. Set POSTIZ_API_KEY in .env' };
  }

  const page = params.page ?? 1;
  const data = await postizFetch(`/notifications?page=${page}`);
  if (!data) {
    return { success: false, data: null, error: 'Could not fetch inbox from Postiz' };
  }

  let notifications: any[] = [];
  if (Array.isArray(data)) {
    notifications = data;
  } else if (data?.notifications) {
    notifications = data.notifications;
  } else if (data?.data) {
    notifications = data.data;
  }

  // Apply filter if specified
  if (params.filter && params.filter !== 'all') {
    notifications = notifications.filter((n: any) => n.type === params.filter);
  }

  return {
    success: true,
    data: {
      total: notifications.length,
      page,
      notifications: notifications.map((n: any) => ({
        id: n.id,
        type: n.type,
        platform: n.platform,
        author: n.author?.name ?? n.username ?? 'Unknown',
        content: n.content,
        postTitle: n.postTitle,
        postId: n.postId,
        commentId: n.commentId,
        url: n.url,
        createdAt: n.createdAt,
      })),
    },
  };
}

/**
 * Get comments for a specific post
 */
export async function social_inbox_post_comments(params: {
  post_id: string;
}): Promise<ToolResult> {
  if (!params.post_id) {
    return { success: false, data: null, error: 'post_id is required' };
  }

  const data = await postizFetch(`/posts/${params.post_id}/comments`);
  if (!data) {
    return { success: false, data: null, error: 'Could not fetch comments from Postiz' };
  }

  return { success: true, data };
}

/**
 * Reply to a comment or post via Postiz
 */
export async function social_inbox_reply(params: {
  post_id: string;
  content: string;
  comment_id?: string;
}): Promise<ToolResult> {
  if (!params.post_id) {
    return { success: false, data: null, error: 'post_id is required' };
  }
  if (!params.content) {
    return { success: false, data: null, error: 'content is required' };
  }

  const data = await postizFetch(`/posts/${params.post_id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content: params.content, parentId: params.comment_id }),
  });

  if (!data) {
    return { success: false, data: null, error: 'Could not post reply via Postiz' };
  }

  return { success: true, data };
}

/**
 * Like/react to a post or comment via Postiz
 */
export async function social_inbox_react(params: {
  post_id: string;
  reaction?: string;
}): Promise<ToolResult> {
  if (!params.post_id) {
    return { success: false, data: null, error: 'post_id is required' };
  }

  const data = await postizFetch(`/posts/${params.post_id}/react`, {
    method: 'POST',
    body: JSON.stringify({ reaction: params.reaction ?? 'like' }),
  });

  if (!data) {
    return { success: false, data: null, error: 'Could not react via Postiz' };
  }

  return { success: true, data };
}
