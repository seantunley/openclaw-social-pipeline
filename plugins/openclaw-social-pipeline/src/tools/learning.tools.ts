/**
 * Content Learning tools — give the OpenClaw agent access to the learning system.
 * The agent can query learnings, add rules, extract from edits/feedback, and
 * get the prompt injection for content generation.
 */

import type { PluginContext, ToolResult } from './types.js';
import { LearningService } from '../services/learning/learning.service.js';

function getService(context: PluginContext): LearningService {
  return new LearningService(context.db);
}

/**
 * List all content learnings with optional filters.
 */
export async function social_learning_list(
  params: { category?: string; platform?: string; active?: boolean; limit?: number },
  context: PluginContext,
): Promise<ToolResult> {
  try {
    const service = getService(context);
    const learnings = await service.list(params);
    return { success: true, data: { total: learnings.length, learnings } };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Get applicable learnings for a platform + optional campaign.
 * Returns both the structured learnings and the prompt injection text.
 */
export async function social_learning_get_applicable(
  params: { platform: string; campaign_id?: string; min_confidence?: number },
  context: PluginContext,
): Promise<ToolResult> {
  try {
    const service = getService(context);
    const result = await service.getApplicableLearnings({
      platform: params.platform,
      campaignId: params.campaign_id,
      minConfidence: params.min_confidence,
    });
    return { success: true, data: result };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Extract learnings from a draft edit (original vs edited version).
 */
export async function social_learning_extract_from_edit(
  params: {
    original_draft: string;
    edited_draft: string;
    platform: string;
    run_id?: string;
    campaign_id?: string;
  },
  context: PluginContext,
): Promise<ToolResult> {
  if (!params.original_draft || !params.edited_draft) {
    return { success: false, data: null, error: 'original_draft and edited_draft are required' };
  }

  try {
    const service = getService(context);
    const result = await service.extractFromEdit({
      originalDraft: params.original_draft,
      editedDraft: params.edited_draft,
      platform: params.platform,
      runId: params.run_id,
      campaignId: params.campaign_id,
    });
    return { success: true, data: result };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Extract learnings from approval feedback (rejection or revision notes).
 */
export async function social_learning_extract_from_feedback(
  params: {
    notes: string;
    action: 'rejection' | 'revision_request';
    draft_content?: string;
    platform: string;
    run_id?: string;
  },
  context: PluginContext,
): Promise<ToolResult> {
  if (!params.notes) {
    return { success: false, data: null, error: 'notes are required' };
  }

  try {
    const service = getService(context);
    const result = await service.extractFromFeedback({
      notes: params.notes,
      action: params.action,
      draftContent: params.draft_content,
      platform: params.platform,
      runId: params.run_id,
    });
    return { success: true, data: result };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Add an explicit operator rule (confidence 1.0, never decays).
 * Example: "Never use clickbait headlines on LinkedIn"
 */
export async function social_learning_add_rule(
  params: { category: string; content: string; platform?: string; tags?: string[] },
  context: PluginContext,
): Promise<ToolResult> {
  if (!params.category || !params.content) {
    return { success: false, data: null, error: 'category and content are required' };
  }

  try {
    const service = getService(context);
    const id = await service.addRule(params);
    return { success: true, data: { id, confidence: 1.0, source_type: 'operator_rule' } };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}

/**
 * Deactivate a learning (soft delete).
 */
export async function social_learning_deactivate(
  params: { learning_id: string },
  context: PluginContext,
): Promise<ToolResult> {
  if (!params.learning_id) {
    return { success: false, data: null, error: 'learning_id is required' };
  }

  try {
    const service = getService(context);
    await service.deactivate(params.learning_id);
    return { success: true, data: { id: params.learning_id, active: false } };
  } catch (err) {
    return { success: false, data: null, error: (err as Error).message };
  }
}
