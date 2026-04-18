export interface AuthStatus {
  authenticated: boolean;
  user?: string;
  expires_at?: string;
}

export interface Integration {
  id: string;
  platform: string;
  name: string;
  status: string;
  profile_url?: string;
}

export interface UploadInput {
  file_path: string;
  filename?: string;
}

export interface UploadedMedia {
  id: string;
  url: string;
  type: string;
}

export interface CreatePostInput {
  integration_id: string;
  content: string;
  media_ids?: string[];
  scheduled_for?: string;
}

export interface PostRecord {
  id: string;
  integration_id: string;
  content: string;
  status: string;
  media_ids: string[];
  scheduled_for?: string;
  published_at?: string;
  url?: string;
}

export interface SchedulePostInput {
  post_id: string;
  scheduled_for: string;
}

export interface SetStatusInput {
  post_id: string;
  status: string;
}

export interface ListPostsInput {
  integration_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface PostAnalytics {
  post_id: string;
  impressions: number;
  clicks: number;
  likes: number;
  shares: number;
  comments: number;
  engagement_rate: number;
}

export interface PlatformAnalytics {
  integration_id: string;
  followers: number;
  total_posts: number;
  avg_engagement: number;
  top_posts: PostAnalytics[];
}

export interface DateRange {
  start: string;
  end: string;
}

export interface SocialPublisher {
  authStatus(): Promise<AuthStatus>;
  listIntegrations(): Promise<Integration[]>;
  uploadMedia(input: UploadInput): Promise<UploadedMedia>;
  createPost(input: CreatePostInput): Promise<PostRecord>;
  schedulePost(input: SchedulePostInput): Promise<PostRecord>;
  setPostStatus(input: SetStatusInput): Promise<PostRecord>;
  listPosts(input?: ListPostsInput): Promise<PostRecord[]>;
  getPostAnalytics(postId: string): Promise<PostAnalytics>;
  getPlatformAnalytics(
    integrationId: string,
    range?: DateRange
  ): Promise<PlatformAnalytics>;
}
