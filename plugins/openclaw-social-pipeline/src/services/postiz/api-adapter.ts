import type {
  AuthStatus,
  CreatePostInput,
  DateRange,
  Integration,
  ListPostsInput,
  PlatformAnalytics,
  PostAnalytics,
  PostRecord,
  SchedulePostInput,
  SetStatusInput,
  SocialPublisher,
  UploadedMedia,
  UploadInput,
} from './types.js';

export interface PostizApiConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * Adapter that implements SocialPublisher via the Postiz REST API.
 * Uses native `fetch()` (available in Node 18+).
 */
export class PostizApiAdapter implements SocialPublisher {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: PostizApiConfig) {
    // Strip trailing slash for consistent URL building
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  // ------------------------------------------------------------------ helpers

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extra,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const init: RequestInit = {
      method,
      headers: this.headers(),
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url.toString(), init);

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as Record<string, unknown>;
        detail = (errBody.message ?? errBody.error ?? JSON.stringify(errBody)) as string;
      } catch {
        detail = await res.text();
      }
      throw new Error(
        `Postiz API ${method} ${path} failed (${res.status}): ${detail}`
      );
    }

    // Handle 204 No Content
    if (res.status === 204) {
      return undefined as unknown as T;
    }

    return (await res.json()) as T;
  }

  private async uploadFile<T>(path: string, filePath: string, filename?: string): Promise<T> {
    // Use dynamic import to avoid top-level fs dependency in non-Node envs
    const { createReadStream } = await import('node:fs');
    const { basename } = await import('node:path');
    const { Readable } = await import('node:stream');

    const resolvedName = filename ?? basename(filePath);
    const stream = createReadStream(filePath);

    // Build multipart form data
    const formData = new FormData();
    // Convert Node stream to web ReadableStream for FormData compatibility
    const webStream = Readable.toWeb(stream) as ReadableStream;
    const blob = new Blob([await new Response(webStream).arrayBuffer()]);
    formData.append('file', blob, resolvedName);

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        // Do NOT set Content-Type — fetch sets the multipart boundary automatically
      },
      body: formData,
    });

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as Record<string, unknown>;
        detail = (errBody.message ?? errBody.error ?? JSON.stringify(errBody)) as string;
      } catch {
        detail = await res.text();
      }
      throw new Error(`Postiz API file upload failed (${res.status}): ${detail}`);
    }

    return (await res.json()) as T;
  }

  // --------------------------------------------------------------- interface

  async authStatus(): Promise<AuthStatus> {
    return this.request<AuthStatus>('GET', '/api/auth/status');
  }

  async listIntegrations(): Promise<Integration[]> {
    return this.request<Integration[]>('GET', '/api/integrations');
  }

  async uploadMedia(input: UploadInput): Promise<UploadedMedia> {
    return this.uploadFile<UploadedMedia>(
      '/api/media/upload',
      input.file_path,
      input.filename
    );
  }

  async createPost(input: CreatePostInput): Promise<PostRecord> {
    return this.request<PostRecord>('POST', '/api/posts', {
      integration_id: input.integration_id,
      content: input.content,
      media_ids: input.media_ids ?? [],
      scheduled_for: input.scheduled_for,
    });
  }

  async schedulePost(input: SchedulePostInput): Promise<PostRecord> {
    return this.request<PostRecord>('PUT', `/api/posts/${input.post_id}/schedule`, {
      scheduled_for: input.scheduled_for,
    });
  }

  async setPostStatus(input: SetStatusInput): Promise<PostRecord> {
    return this.request<PostRecord>('PUT', `/api/posts/${input.post_id}/status`, {
      status: input.status,
    });
  }

  async listPosts(input?: ListPostsInput): Promise<PostRecord[]> {
    return this.request<PostRecord[]>('GET', '/api/posts', undefined, {
      integration_id: input?.integration_id,
      status: input?.status,
      limit: input?.limit,
      offset: input?.offset,
    });
  }

  async getPostAnalytics(postId: string): Promise<PostAnalytics> {
    return this.request<PostAnalytics>('GET', `/api/analytics/posts/${postId}`);
  }

  async getPlatformAnalytics(
    integrationId: string,
    range?: DateRange
  ): Promise<PlatformAnalytics> {
    return this.request<PlatformAnalytics>(
      'GET',
      `/api/analytics/platforms/${integrationId}`,
      undefined,
      {
        start: range?.start,
        end: range?.end,
      }
    );
  }
}
