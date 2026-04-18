import type { FastifyPluginAsync } from 'fastify';

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

export const inboxRoutes: FastifyPluginAsync = async (app) => {
  // Check if inbox is available (Postiz configured)
  app.get('/status', async () => {
    const { apiKey } = getPostizConfig();
    return { available: !!apiKey };
  });

  // Get notifications / mentions / comments from Postiz
  app.get('/', async (req, reply) => {
    const { page } = req.query as { page?: string };
    const data = await postizFetch(`/notifications?page=${page ?? '1'}`);
    if (!data) return reply.status(502).send({ error: 'Could not fetch inbox from Postiz' });
    return data;
  });

  // Get comments for a specific post
  app.get('/post/:postId/comments', async (req, reply) => {
    const { postId } = req.params as { postId: string };
    const data = await postizFetch(`/posts/${postId}/comments`);
    if (!data) return reply.status(502).send({ error: 'Could not fetch comments' });
    return data;
  });

  // Reply to a comment
  app.post('/post/:postId/reply', async (req, reply) => {
    const { postId } = req.params as { postId: string };
    const { commentId, content } = req.body as { commentId?: string; content: string };
    if (!content) return reply.status(400).send({ error: 'content is required' });

    const data = await postizFetch(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, parentId: commentId }),
    });
    if (!data) return reply.status(502).send({ error: 'Could not post reply via Postiz' });
    return data;
  });

  // Like/react to a post or comment
  app.post('/post/:postId/react', async (req, reply) => {
    const { postId } = req.params as { postId: string };
    const { reaction } = req.body as { reaction?: string };

    const data = await postizFetch(`/posts/${postId}/react`, {
      method: 'POST',
      body: JSON.stringify({ reaction: reaction ?? 'like' }),
    });
    if (!data) return reply.status(502).send({ error: 'Could not react via Postiz' });
    return data;
  });
};
