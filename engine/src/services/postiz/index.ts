export type { SocialPublisher } from './types.js';
export * from './types.js';
export { PostizCliAdapter } from './cli-adapter.js';
export { PostizApiAdapter } from './api-adapter.js';
export type { PostizApiConfig } from './api-adapter.js';

import type { SocialPublisher } from './types.js';
import { PostizCliAdapter } from './cli-adapter.js';
import { PostizApiAdapter } from './api-adapter.js';

export interface PostizAdapterConfig {
  mode: 'cli' | 'api';
  apiBaseUrl?: string;
  apiKey?: string;
}

/**
 * Factory function that returns the appropriate Postiz adapter based on config.
 *
 * - `mode: 'cli'`  — shells out to `npx postiz` (no extra config needed)
 * - `mode: 'api'`  — calls the Postiz REST API (requires apiBaseUrl + apiKey)
 */
export function createPostizAdapter(config: PostizAdapterConfig): SocialPublisher {
  if (config.mode === 'api') {
    if (!config.apiBaseUrl) {
      throw new Error('apiBaseUrl is required when using Postiz API mode');
    }
    if (!config.apiKey) {
      throw new Error('apiKey is required when using Postiz API mode');
    }
    return new PostizApiAdapter({
      baseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
    });
  }

  return new PostizCliAdapter();
}
