import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { socialRun, socialRunStage, socialDraft, socialMediaAsset } from '../db/schema.js';
import type { PluginContext, ToolParams, ToolResult, StageName } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────────

function getRunWithSelectedDraft(db: PluginContext['db'], runId: string) {
  const run = db.select().from(socialRun).where(eq(socialRun.id, runId)).get();
  if (!run) return null;

  // Find the "ready" draft, or fall back to first draft
  const readyDraft = db
    .select()
    .from(socialDraft)
    .where(and(eq(socialDraft.run_id, runId), eq(socialDraft.status, 'ready')))
    .get();

  const draft = readyDraft ?? db
    .select()
    .from(socialDraft)
    .where(eq(socialDraft.run_id, runId))
    .get();

  return { run, draft };
}

function getStage(db: PluginContext['db'], runId: string, stageName: StageName) {
  return db
    .select()
    .from(socialRunStage)
    .where(and(eq(socialRunStage.run_id, runId), eq(socialRunStage.stage_name, stageName)))
    .get();
}

// ── social_image_generate ───────────────────────────────────────────────────────

interface ImageGenerateParams extends ToolParams {
  run_id: string;
  prompt?: string;
  aspect_ratio?: string;
}

export async function social_image_generate(
  params: ImageGenerateParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }

  try {
    const data = getRunWithSelectedDraft(db, params.run_id);
    if (!data) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const { run, draft } = data;
    if (!draft) {
      return { success: false, data: null, error: 'No drafts found for this run. Generate drafts first.' };
    }

    const stage = getStage(db, params.run_id, 'media');
    const now = new Date().toISOString();

    if (stage) {
      db.update(socialRunStage)
        .set({ status: 'running', started_at: now })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    const config = JSON.parse(run.config_snapshot);
    const prompt = params.prompt ?? `Create a social media image for: ${draft.final_content || draft.raw_content}`;
    const aspectRatio = params.aspect_ratio ?? config.aspect_ratio ?? '1:1';

    // Create asset record first
    const assetId = uuidv4();
    db.insert(socialMediaAsset)
      .values({
        id: assetId,
        draft_id: draft.id,
        type: 'image',
        status: 'generating',
        prompt,
        provider: '',
        model: '',
        source_url: null,
        hosted_url: null,
        media_mode: 'image',
        aspect_ratio: aspectRatio,
        width: null,
        height: null,
        duration_seconds: null,
        file_size_bytes: null,
        mime_type: null,
        carousel_index: null,
        metadata: '{}',
        created_at: now,
      })
      .run();

    const result = await services.pipeline.generateImage({ prompt, aspectRatio });

    db.update(socialMediaAsset)
      .set({
        status: 'hosted',
        source_url: result.url,
        hosted_url: result.url,
      })
      .where(eq(socialMediaAsset.id, assetId))
      .run();

    // Update draft status
    db.update(socialDraft)
      .set({ status: 'media_pending', updated_at: new Date().toISOString() })
      .where(eq(socialDraft.id, draft.id))
      .run();

    if (stage) {
      const completedAt = new Date().toISOString();
      db.update(socialRunStage)
        .set({
          status: 'completed',
          output_data: JSON.stringify({ asset_id: assetId, url: result.url }),
          completed_at: completedAt,
          duration_ms: new Date(completedAt).getTime() - new Date(now).getTime(),
        })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    logger.info('Image generated', { runId: params.run_id, assetId });
    return { success: true, data: { asset_id: assetId, url: result.url, prompt, aspect_ratio: aspectRatio } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Image generation failed', { runId: params.run_id, error: message });

    const stage = getStage(db, params.run_id, 'media');
    if (stage) {
      db.update(socialRunStage)
        .set({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    return { success: false, data: null, error: message };
  }
}

// ── social_video_generate ───────────────────────────────────────────────────────

interface VideoGenerateParams extends ToolParams {
  run_id: string;
  prompt?: string;
  aspect_ratio?: string;
  duration?: number;
}

export async function social_video_generate(
  params: VideoGenerateParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger, services } = context;

  if (!params.run_id) {
    return { success: false, data: null, error: 'run_id is required' };
  }

  try {
    const data = getRunWithSelectedDraft(db, params.run_id);
    if (!data) {
      return { success: false, data: null, error: `Run ${params.run_id} not found` };
    }

    const { run, draft } = data;
    if (!draft) {
      return { success: false, data: null, error: 'No drafts found for this run. Generate drafts first.' };
    }

    const stage = getStage(db, params.run_id, 'media');
    const now = new Date().toISOString();

    if (stage) {
      db.update(socialRunStage)
        .set({ status: 'running', started_at: now })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    const config = JSON.parse(run.config_snapshot);
    const prompt = params.prompt ?? `Create a social media video for: ${draft.final_content || draft.raw_content}`;
    const aspectRatio = params.aspect_ratio ?? config.aspect_ratio ?? '16:9';
    const duration = params.duration ?? 15;

    const assetId = uuidv4();
    db.insert(socialMediaAsset)
      .values({
        id: assetId,
        draft_id: draft.id,
        type: 'video',
        status: 'generating',
        prompt,
        provider: '',
        model: '',
        source_url: null,
        hosted_url: null,
        media_mode: 'video',
        aspect_ratio: aspectRatio,
        width: null,
        height: null,
        duration_seconds: duration,
        file_size_bytes: null,
        mime_type: null,
        carousel_index: null,
        metadata: '{}',
        created_at: now,
      })
      .run();

    const result = await services.pipeline.generateVideo({ prompt, aspectRatio, duration });

    db.update(socialMediaAsset)
      .set({
        status: 'hosted',
        source_url: result.url,
        hosted_url: result.url,
      })
      .where(eq(socialMediaAsset.id, assetId))
      .run();

    db.update(socialDraft)
      .set({ status: 'media_pending', updated_at: new Date().toISOString() })
      .where(eq(socialDraft.id, draft.id))
      .run();

    if (stage) {
      const completedAt = new Date().toISOString();
      db.update(socialRunStage)
        .set({
          status: 'completed',
          output_data: JSON.stringify({ asset_id: assetId, url: result.url }),
          completed_at: completedAt,
          duration_ms: new Date(completedAt).getTime() - new Date(now).getTime(),
        })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    logger.info('Video generated', { runId: params.run_id, assetId });
    return { success: true, data: { asset_id: assetId, url: result.url, prompt, aspect_ratio: aspectRatio, duration } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Video generation failed', { runId: params.run_id, error: message });

    const stage = getStage(db, params.run_id, 'media');
    if (stage) {
      db.update(socialRunStage)
        .set({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
        .where(eq(socialRunStage.id, stage.id))
        .run();
    }

    return { success: false, data: null, error: message };
  }
}

// ── social_media_regenerate ─────────────────────────────────────────────────────

interface MediaRegenerateParams extends ToolParams {
  run_id: string;
  asset_id: string;
  new_prompt?: string;
}

export async function social_media_regenerate(
  params: MediaRegenerateParams,
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

    const prompt = params.new_prompt ?? asset.prompt;

    db.update(socialMediaAsset)
      .set({ status: 'generating', prompt })
      .where(eq(socialMediaAsset.id, params.asset_id))
      .run();

    let result: { url: string };

    if (asset.type === 'video') {
      result = await services.pipeline.generateVideo({
        prompt,
        aspectRatio: asset.aspect_ratio,
        duration: asset.duration_seconds ?? undefined,
      });
    } else {
      result = await services.pipeline.generateImage({
        prompt,
        aspectRatio: asset.aspect_ratio,
      });
    }

    db.update(socialMediaAsset)
      .set({
        status: 'hosted',
        source_url: result.url,
        hosted_url: result.url,
        prompt,
      })
      .where(eq(socialMediaAsset.id, params.asset_id))
      .run();

    logger.info('Media regenerated', { runId: params.run_id, assetId: params.asset_id });
    return { success: true, data: { asset_id: params.asset_id, url: result.url, prompt } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Media regeneration failed', { assetId: params.asset_id, error: message });

    db.update(socialMediaAsset)
      .set({ status: 'failed' })
      .where(eq(socialMediaAsset.id, params.asset_id))
      .run();

    return { success: false, data: null, error: message };
  }
}

// ── social_media_select ─────────────────────────────────────────────────────────

interface MediaSelectParams extends ToolParams {
  run_id: string;
  asset_id: string;
}

export async function social_media_select(
  params: MediaSelectParams,
  context: PluginContext,
): Promise<ToolResult> {
  const { db, logger } = context;

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

    if (asset.status !== 'hosted') {
      return { success: false, data: null, error: `Asset is not ready (status: ${asset.status})` };
    }

    // Get the draft this asset belongs to, and get all assets for that draft
    const draftAssets = db
      .select()
      .from(socialMediaAsset)
      .where(eq(socialMediaAsset.draft_id, asset.draft_id))
      .all();

    // Deselect all, then select the chosen one
    // (We use metadata to track selection since schema has no "selected" column on media)
    for (const a of draftAssets) {
      const meta = JSON.parse(a.metadata);
      meta.selected = a.id === params.asset_id;
      db.update(socialMediaAsset)
        .set({ metadata: JSON.stringify(meta) })
        .where(eq(socialMediaAsset.id, a.id))
        .run();
    }

    logger.info('Media selected', { runId: params.run_id, assetId: params.asset_id });
    return { success: true, data: { run_id: params.run_id, selected_asset_id: params.asset_id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to select media', { error: message });
    return { success: false, data: null, error: message };
  }
}
