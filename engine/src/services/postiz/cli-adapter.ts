import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);

/**
 * Adapter that implements SocialPublisher by shelling out to the Postiz CLI.
 * Each method maps to an `npx postiz <subcommand>` invocation and parses
 * the JSON output that the CLI returns.
 */
export class PostizCliAdapter implements SocialPublisher {
  /**
   * Execute a Postiz CLI command and return the parsed JSON result.
   */
  private async exec<T>(args: string[]): Promise<T> {
    try {
      const { stdout, stderr } = await execFileAsync('npx', ['postiz', ...args], {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        shell: true,
      });

      if (stderr && !stdout) {
        throw new Error(`Postiz CLI error: ${stderr.trim()}`);
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        throw new Error(`Postiz CLI returned empty output for: postiz ${args.join(' ')}`);
      }

      // The CLI may emit non-JSON preamble lines before the actual JSON.
      // Find the first line starting with '{' or '['.
      const lines = trimmed.split('\n');
      const jsonStart = lines.findIndex(
        (l) => l.trimStart().startsWith('{') || l.trimStart().startsWith('[')
      );

      if (jsonStart === -1) {
        throw new Error(
          `Postiz CLI did not return JSON for: postiz ${args.join(' ')}\nOutput: ${trimmed}`
        );
      }

      const jsonStr = lines.slice(jsonStart).join('\n');
      return JSON.parse(jsonStr) as T;
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        throw new Error(`Failed to parse Postiz CLI JSON output: ${(err as Error).message}`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Postiz CLI command failed (postiz ${args.join(' ')}): ${msg}`);
    }
  }

  async authStatus(): Promise<AuthStatus> {
    return this.exec<AuthStatus>(['auth', 'status', '--json']);
  }

  async listIntegrations(): Promise<Integration[]> {
    return this.exec<Integration[]>(['integrations', 'list', '--json']);
  }

  async uploadMedia(input: UploadInput): Promise<UploadedMedia> {
    const args = ['media', 'upload', input.file_path, '--json'];
    if (input.filename) {
      args.push('--filename', input.filename);
    }
    return this.exec<UploadedMedia>(args);
  }

  async createPost(input: CreatePostInput): Promise<PostRecord> {
    const args = [
      'posts',
      'create',
      '--integration',
      input.integration_id,
      '--content',
      input.content,
      '--json',
    ];

    if (input.media_ids?.length) {
      args.push('--media', input.media_ids.join(','));
    }
    if (input.scheduled_for) {
      args.push('--schedule', input.scheduled_for);
    }

    return this.exec<PostRecord>(args);
  }

  async schedulePost(input: SchedulePostInput): Promise<PostRecord> {
    return this.exec<PostRecord>([
      'posts',
      'schedule',
      input.post_id,
      '--time',
      input.scheduled_for,
      '--json',
    ]);
  }

  async setPostStatus(input: SetStatusInput): Promise<PostRecord> {
    return this.exec<PostRecord>([
      'posts',
      'status',
      input.post_id,
      '--status',
      input.status,
      '--json',
    ]);
  }

  async listPosts(input?: ListPostsInput): Promise<PostRecord[]> {
    const args = ['posts', 'list', '--json'];

    if (input?.integration_id) {
      args.push('--integration', input.integration_id);
    }
    if (input?.status) {
      args.push('--status', input.status);
    }
    if (input?.limit !== undefined) {
      args.push('--limit', String(input.limit));
    }
    if (input?.offset !== undefined) {
      args.push('--offset', String(input.offset));
    }

    return this.exec<PostRecord[]>(args);
  }

  async getPostAnalytics(postId: string): Promise<PostAnalytics> {
    return this.exec<PostAnalytics>(['analytics', 'post', postId, '--json']);
  }

  async getPlatformAnalytics(
    integrationId: string,
    range?: DateRange
  ): Promise<PlatformAnalytics> {
    const args = ['analytics', 'platform', integrationId, '--json'];

    if (range) {
      args.push('--start', range.start, '--end', range.end);
    }

    return this.exec<PlatformAnalytics>(args);
  }
}
