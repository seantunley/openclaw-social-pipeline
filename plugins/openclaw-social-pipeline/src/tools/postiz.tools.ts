import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  socialRun,
  socialRunStage,
  socialDraft,
  socialMediaAsset,
  socialPublishRecord,
  socialAnalyticsSnapshot,
} from '../db/schema.js';
import type { PluginContext, ToolParams, ToolResult } from './types.js';

// ── social_postiz_auth_status ───────────────────────────────────────────────────

export async function social_postiz_auth_status(
  _params: ToolParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { logger, services } = context;

  try {
    const result = await services.postiz.checkAuth();
    logger.info('Postiz auth status checked', { authenticated: result.authenticated });
    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to check Postiz auth', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_postiz_integrations_list ─────────────────────────────────────────────

export async function social_postiz_integrations_list(
  _params: ToolParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { logger, services } = context;

  try {
    const integrations = await services.postiz.listIntegrations();
    logger.info('Postiz integrations listed', { count: integrations.length });
    return { success: true, data: integrations };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to list Postiz integrations', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_postiz_upload_media ──────────────────────────────────────────────────

interface UploadMediaParams extends ToolParams {
  run_id: string;
  asset_id: string;
}

export async function social_postiz_upload_media(
  params: UploadMediaParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }
  if (!params.asset_id) {
    return { success: false, data: null, error: 'asset_id is required' };
  }

  try {
    const asset = db
      .select()
      .from(socialMediaAsset)
      .where(eq(socialMediaAsset.id, params.asset_id))
      .get();

    if (!asset) {
      return { success: false, data: null, error: `Media asset ${params.asset_id} not found` };
    }

    if (!asset.hosted_url) {
      return { success: false, data: null, error: 'Asset has no hosted URL. Generate media first.' };
    }

    db.update(socialMediaAsset)
      .set({ status: 'uploading' })
      .where(eq(socialMediaAsset.id, params.asset_id))
      .run();

    const result = await services.postiz.uploadMedia(asset.hosted_url, {
      type: asset.type,
      aspect_ratio: asset.aspect_ratio,
    });

    const meta = JSON.parse(asset.metadata);
    meta.postiz_media_id = result.id;
    meta.postiz_media_url = result.url;

    db.update(socialMediaAsset)
      .set({ status: 'hosted', metadata: JSON.stringify(meta) })
      .where(eq(socialMediaAsset.id, params.asset_id))
      .run();

    logger.info('Media uploaded to Postiz', { assetId: params.asset_id, postizMediaId: result.id });
    return { success: true, data: { asset_id: params.asset_id, postiz_media_id: result.id, url: result.url } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to upload media to Postiz', { error: message });

    db.update(socialMediaAsset)
      .set({ status: 'failed' })
      .where(eq(socialMediaAsset.id, params.asset_id))
      .run();

    return { success: false, data: null, error: message };
  }
}

// ── social_postiz_create_post ───────────────────────────────────────────────────

interface CreatePostParams extends ToolParams {
  run_id: string;
  integration_id: string;
  content?: string;
}

export async function social_postiz_create_post(
  params: CreatePostParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }
  if (!params.integration_id) {
    return { success: false, data: null, error: 'integration_id is required' };
  }

  try {
    const run = db.select().from(socialRun).where(eq(socialRun.id, params.run_id)).get();
    if (!run) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    // Get approved draft or ready draft
    const draft = db
      .select()
      .from(socialDraft)
      .where(and(eq(socialDraft.run_id, params.run_id), eq(socialDraft.status, 'approved')))
      .get()
      ?? db
        .select()
        .from(socialDraft)
        .where(and(eq(socialDraft.run_id, params.run_id), eq(socialDraft.status, 'ready')))
        .get();

    if (!draft && !params.content) {
      return { success: false, data: null, error: 'No approved draft found and no content provided' };
    }

    const content = params.content ?? draft!.final_content ?? draft!.raw_content;

    // Find uploaded media IDs
    const mediaIds: string[] = [];
    if (draft) {
      const assets = db
        .select()
        .from(socialMediaAsset)
        .where(eq(socialMediaAsset.draft_id, draft.id))
        .all();

      for (const asset of assets) {
        const meta = JSON.parse(asset.metadata);
        if (meta.postiz_media_id) {
          mediaIds.push(meta.postiz_media_id);
        }
      }
    }

    const result = await services.postiz.createPost({
      content,
      integrationId: params.integration_id,
      mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
    });

    // Create publish record
    const publishId = uuidv4();
    const now = new Date().toISOString();

    db.insert(socialPublishRecord)
      .values({
        id: publishId,
        draft_id: draft?.id ?? '',
        run_id: params.run_id,
        platform: draft?.platform ?? 'unknown',
        status: 'scheduled',
        postiz_post_id: result.id,
        postiz_integration_id: params.integration_id,
        scheduled_at: null,
        published_at: null,
        platform_post_id: null,
        platform_post_url: null,
        error_message: null,
        metadata: '{}',
        created_at: now,
        updated_at: now,
      })
      .run();

    // Update publish stage
    const stage = db
      .select()
      .from(socialRunStage)
      .where(and(eq(socialRunStage.run_id, params.run_id), eq(socialRunStage.stage_name, 'publish')))
      .get();

    if (stage) {
      db.update(socialRunStage)
        .set({
          status: 'completed',
          output_data: JSON.stringify({ postiz_post_id: result.id, publish_record_id: publishId }),
          completed_at: now,
        })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    logger.info('Postiz post created', { runId: params.run_id, postizPostId: result.id });
    return {
      success: true,
      data: { publish_record_id: publishId, postiz_post_id: result.id, content_length: content.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to create Postiz post', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_postiz_schedule_post ─────────────────────────────────────────────────

interface SchedulePostParams extends ToolParams {
  run_id: string;
  post_id: string;
  scheduled_for: string;
}

export async function social_postiz_schedule_post(
  params: SchedulePostParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }
  if (!params.post_id) {
    return { success: false, data: null, error: 'post_id is required' };
  }
  if (!params.scheduled_for) {
    return { success: false, data: null, error: 'scheduled_for is required (ISO 8601 datetime)' };
  }

  try {
    await services.postiz.schedulePost({
      postId: params.post_id,
      scheduledFor: params.scheduled_for,
    });

    // Update publish record
    const record = db
      .select()
      .from(socialPublishRecord)
      .where(eq(socialPublishRecord.postiz_post_id, params.post_id))
      .get();

    if (record) {
      db.update(socialPublishRecord)
        .set({
          status: 'scheduled',
          scheduled_at: params.scheduled_for,
          updated_at: new Date().toISOString(),
        })
        .where(eq(socialPublishRecord.id, record.id))
        .run();
    }

    logger.info('Post scheduled', { postId: params.post_id, scheduledFor: params.scheduled_for });
    return {
      success: true,
      data: { post_id: params.post_id, scheduled_for: params.scheduled_for },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to schedule post', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_postiz_set_post_status ───────────────────────────────────────────────

interface SetPostStatusParams extends ToolParams {
  post_id: string;
  status: string;
}

export async function social_postiz_set_post_status(
  params: SetPostStatusParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.post_id) {
    return { success: false, data: null, error: 'post_id is required' };
  }
  if (!params.status) {
    return { success: false, data: null, error: 'status is required' };
  }

  try {
    await services.postiz.setPostStatus({
      postId: params.post_id,
      status: params.status,
    });

    // Sync publish record
    const record = db
      .select()
      .from(socialPublishRecord)
      .where(eq(socialPublishRecord.postiz_post_id, params.post_id))
      .get();

    if (record) {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (params.status === 'published') {
        updates.status = 'published';
        updates.published_at = new Date().toISOString();
      } else if (params.status === 'failed') {
        updates.status = 'failed';
      }

      db.update(socialPublishRecord)
        .set(updates)
        .where(eq(socialPublishRecord.id, record.id))
        .run();
    }

    logger.info('Post status updated', { postId: params.post_id, status: params.status });
    return { success: true, data: { post_id: params.post_id, status: params.status } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to set post status', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_postiz_list_posts ────────────────────────────────────────────────────

interface ListPostsParams extends ToolParams {
  integration_id?: string;
  status?: string;
}

export async function social_postiz_list_posts(
  params: ListPostsParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { logger, services } = context;

  try {
    const posts = await services.postiz.listPosts({
      integrationId: params.integration_id,
      status: params.status,
    });

    logger.info('Postiz posts listed', { count: posts.length });
    return { success: true, data: posts };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to list Postiz posts', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_postiz_post_analytics ────────────────────────────────────────────────

interface PostAnalyticsParams extends ToolParams {
  post_id: string;
}

export async function social_postiz_post_analytics(
  params: PostAnalyticsParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.post_id) {
    return { success: false, data: null, error: 'post_id is required' };
  }

  try {
    const analytics = await services.postiz.getPostAnalytics(params.post_id);

    // Store snapshot
    const record = db
      .select()
      .from(socialPublishRecord)
      .where(eq(socialPublishRecord.postiz_post_id, params.post_id))
      .get();

    if (record) {
      const now = new Date().toISOString();
      const snapshotId = uuidv4();

      db.insert(socialAnalyticsSnapshot)
        .values({
          id: snapshotId,
          publish_record_id: record.id,
          draft_id: record.draft_id,
          platform: record.platform,
          snapshot_at: now,
          impressions: (analytics.impressions as number) ?? 0,
          reach: (analytics.reach as number) ?? 0,
          engagements: (analytics.engagements as number) ?? 0,
          likes: (analytics.likes as number) ?? 0,
          comments: (analytics.comments as number) ?? 0,
          shares: (analytics.shares as number) ?? 0,
          saves: (analytics.saves as number) ?? 0,
          clicks: (analytics.clicks as number) ?? 0,
          video_views: (analytics.video_views as number) ?? 0,
          video_watch_time_seconds: (analytics.video_watch_time_seconds as number) ?? 0,
          followers_gained: (analytics.followers_gained as number) ?? 0,
          engagement_rate: (analytics.engagement_rate as number) ?? 0,
          raw_data: JSON.stringify(analytics),
          created_at: now,
        })
        .run();

      // Update analytics stage
      const stage = db
        .select()
        .from(socialRunStage)
        .where(
          and(
            eq(socialRunStage.run_id, record.run_id),
            eq(socialRunStage.stage_name, 'analytics'),
          ),
        )
        .get();

      if (stage) {
        db.update(socialRunStage)
          .set({
            status: 'completed',
            output_data: JSON.stringify({ snapshot_id: snapshotId }),
            completed_at: now,
          })
          .where(eq(socialRunStage.id, stage.id))
          .run();
      }
    }

    logger.info('Post analytics retrieved', { postId: params.post_id });
    return { success: true, data: analytics };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to get post analytics', { error: message });
    return { success: false, data: null, error: message };
  }
}

// ── social_postiz_platform_analytics ────────────────────────────────────────────

interface PlatformAnalyticsParams extends ToolParams {
  integration_id: string;
  start_date?: string;
  end_date?: string;
}

export async function social_postiz_platform_analytics(
  params: PlatformAnalyticsParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { logger, services } = context;

  if (!params.integration_id) {
    return { success: false, data: null, error: 'integration_id is required' };
  }

  try {
    const analytics = await services.postiz.getPlatformAnalytics({
      integrationId: params.integration_id,
      startDate: params.start_date,
      endDate: params.end_date,
    });

    logger.info('Platform analytics retrieved', { integrationId: params.integration_id });
    return { success: true, data: analytics };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to get platform analytics', { error: message });
    return { success: false, data: null, error: message };
  }
}
