// ---------------------------------------------------------------------------
// @openclaw/social-pipeline — Plugin Entry Point
// ---------------------------------------------------------------------------

// Re-export schemas
export {
  socialPipelineConfigSchema,
  type SocialPipelineConfig,
  type GeneralConfig,
  type HumanizerConfig,
  type MarketingPsychologyConfig,
  type MediaConfig,
  type PostizConfig,
  type PipelineConfig,
  type Platform,
  type MediaMode,
  type AspectRatio,
  type PostingWindow,
  platformEnum,
  mediaMode,
  aspectRatio,
} from "./schemas/config.schema.js";

export {
  socialCampaignSchema,
  socialRunSchema,
  socialRunStageSchema,
  socialDraftSchema,
  socialMediaAssetSchema,
  socialApprovalSchema,
  socialPublishRecordSchema,
  socialAnalyticsSnapshotSchema,
  type SocialCampaign,
  type SocialRun,
  type SocialRunStage,
  type SocialDraft,
  type SocialMediaAsset,
  type SocialApproval,
  type SocialPublishRecord,
  type SocialAnalyticsSnapshot,
  campaignStatus,
  runStatus,
  stageStatus,
  draftStatus,
  assetType,
  assetStatus,
  approvalDecision,
  publishStatus,
  stageName,
} from "./schemas/run.schema.js";

// Re-export database
export {
  initDb,
  getDb,
  getSqlite,
  closeDb,
  schema,
  type InitDbOptions,
} from "./db/index.js";

// Re-export Drizzle table definitions
export {
  socialCampaign,
  socialRun,
  socialRunStage,
  socialDraft,
  socialMediaAsset,
  socialApproval,
  socialPublishRecord,
  socialAnalyticsSnapshot,
  socialConfig,
} from "./db/schema.js";

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export interface OpenClawPluginContext {
  pluginId: string;
  dataDir: string;
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
    debug: (msg: string, meta?: Record<string, unknown>) => void;
  };
  registerTool: (tool: any) => void;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool → implementation mapping
//
// Keys are the public tool names (matching openclaw.plugin.json).
// Values point to the real module + named export that implements the tool.
// ---------------------------------------------------------------------------

const TOOL_MAP: Record<string, { module: string; export: string; description: string }> = {
  // Campaign
  "create-campaign":     { module: "./tools/campaign.tools.js",  export: "social_campaign_create",              description: "Create a new social media campaign with target platforms and goals." },
  "update-campaign":     { module: "./tools/campaign.tools.js",  export: "social_campaign_update",              description: "Update an existing campaign." },
  "create-brief":        { module: "./tools/campaign.tools.js",  export: "social_brief_create",                 description: "Create a content brief for a campaign." },
  "list-briefs":         { module: "./tools/campaign.tools.js",  export: "social_brief_list",                   description: "List content briefs." },

  // Runs
  "create-run":          { module: "./tools/run.tools.js",       export: "social_run_create",                   description: "Create a new content pipeline run." },
  "list-runs":           { module: "./tools/run.tools.js",       export: "social_run_list",                     description: "List content runs with optional filters." },
  "get-run-status":      { module: "./tools/run.tools.js",       export: "social_run_get",                      description: "Get detailed status of a pipeline run including all stages." },
  "retry-stage":         { module: "./tools/run.tools.js",       export: "social_run_retry_stage",              description: "Retry a failed pipeline stage." },
  "cancel-run":          { module: "./tools/run.tools.js",       export: "social_run_cancel",                   description: "Cancel a content run." },

  // Drafting
  "generate-research":   { module: "./tools/draft.tools.js",     export: "social_research_generate",            description: "Generate topic research for a run." },
  "generate-drafts":     { module: "./tools/draft.tools.js",     export: "social_draft_generate",               description: "Generate content draft variants." },
  "score-drafts":        { module: "./tools/draft.tools.js",     export: "social_draft_score",                  description: "Score all draft variants for a run." },
  "select-draft":        { module: "./tools/draft.tools.js",     export: "social_draft_select",                 description: "Select a draft variant." },

  // Skills
  "humanize-content":    { module: "./tools/skill.tools.js",     export: "social_apply_humanizer",              description: "Run the humanizer pass to remove AI writing patterns." },
  "apply-psychology":    { module: "./tools/skill.tools.js",     export: "social_apply_marketing_psychology",   description: "Enhance drafts with marketing psychology principles." },

  // Media
  "generate-image":      { module: "./tools/media.tools.js",     export: "social_image_generate",               description: "Generate an image for a run." },
  "generate-video":      { module: "./tools/media.tools.js",     export: "social_video_generate",               description: "Generate a video for a run." },
  "regenerate-media":    { module: "./tools/media.tools.js",     export: "social_media_regenerate",             description: "Regenerate a specific media asset." },
  "select-media":        { module: "./tools/media.tools.js",     export: "social_media_select",                 description: "Select a media asset for the run." },

  // Approval
  "submit-for-approval": { module: "./tools/approval.tools.js",  export: "social_submit_for_approval",          description: "Submit content for human review." },
  "approve-draft":       { module: "./tools/approval.tools.js",  export: "social_approve",                      description: "Approve content for publishing." },
  "reject-draft":        { module: "./tools/approval.tools.js",  export: "social_reject",                       description: "Reject content with feedback." },
  "request-revision":    { module: "./tools/approval.tools.js",  export: "social_request_revision",             description: "Request revision on content." },

  // Postiz publishing
  "postiz-auth-status":  { module: "./tools/postiz.tools.js",    export: "social_postiz_auth_status",           description: "Check Postiz connection status." },
  "postiz-integrations": { module: "./tools/postiz.tools.js",    export: "social_postiz_integrations_list",     description: "List connected Postiz platforms." },
  "postiz-upload-media": { module: "./tools/postiz.tools.js",    export: "social_postiz_upload_media",          description: "Upload media to Postiz." },
  "publish-content":     { module: "./tools/postiz.tools.js",    export: "social_postiz_create_post",           description: "Create and publish a post via Postiz." },
  "schedule-content":    { module: "./tools/postiz.tools.js",    export: "social_postiz_schedule_post",         description: "Schedule a post for future publishing." },
  "postiz-set-status":   { module: "./tools/postiz.tools.js",    export: "social_postiz_set_post_status",       description: "Update a Postiz post status." },
  "postiz-list-posts":   { module: "./tools/postiz.tools.js",    export: "social_postiz_list_posts",            description: "List posts in Postiz." },
  "sync-analytics":      { module: "./tools/postiz.tools.js",    export: "social_postiz_post_analytics",        description: "Pull analytics for a published post." },
  "platform-analytics":  { module: "./tools/postiz.tools.js",    export: "social_postiz_platform_analytics",    description: "Get platform-level analytics." },

  // Config
  "config-get":          { module: "./tools/config.tools.js",    export: "social_config_get",                   description: "Get pipeline configuration." },
  "config-set":          { module: "./tools/config.tools.js",    export: "social_config_set",                   description: "Update pipeline configuration." },
  "dashboard-summary":   { module: "./tools/config.tools.js",    export: "social_dashboard_summary",            description: "Get dashboard summary stats." },
  "pipeline-state":      { module: "./tools/config.tools.js",    export: "social_dashboard_pipeline_state",     description: "Get current pipeline state." },

  // Inbox
  "inbox-status":        { module: "./tools/inbox.tools.js",     export: "social_inbox_status",                 description: "Check if the Postiz social inbox is available." },
  "inbox-list":          { module: "./tools/inbox.tools.js",     export: "social_inbox_list",                   description: "List inbox notifications — mentions, comments, likes, shares." },
  "inbox-post-comments": { module: "./tools/inbox.tools.js",     export: "social_inbox_post_comments",          description: "Get all comments for a specific post." },
  "inbox-reply":         { module: "./tools/inbox.tools.js",     export: "social_inbox_reply",                  description: "Reply to a comment or post via Postiz." },
  "inbox-react":         { module: "./tools/inbox.tools.js",     export: "social_inbox_react",                  description: "Like or react to a post or comment." },

  // Research library
  "research-list":       { module: "./tools/research.tools.js",  export: "social_research_list",                description: "List research findings from pipeline runs." },
  "research-get":        { module: "./tools/research.tools.js",  export: "social_research_get",                 description: "Get full details of a research finding." },
  "research-save":       { module: "./tools/research.tools.js",  export: "social_research_save",                description: "Save a research finding to the library." },
  "research-update":     { module: "./tools/research.tools.js",  export: "social_research_update_status",       description: "Approve, reject, or archive a research finding." },
  "research-promote":    { module: "./tools/research.tools.js",  export: "social_research_promote",             description: "Promote a research finding to a content run." },

  // SEO & GEO
  "seo-geo-score":       { module: "./tools/seo-geo.tools.js",   export: "social_seo_geo_score",                description: "Score a post for SEO + GEO readiness." },
  "seo-geo-enhance":     { module: "./tools/seo-geo.tools.js",   export: "social_seo_geo_enhance",              description: "Enhance a post for SEO and AI search citation." },
  "seo-geo-generate":    { module: "./tools/seo-geo.tools.js",   export: "social_seo_geo_generate",             description: "Generate a fully SEO/GEO-optimized post from scratch." },

  // Content learning
  "learning-list":           { module: "./tools/learning.tools.js", export: "social_learning_list",              description: "List content learnings." },
  "learning-get-applicable": { module: "./tools/learning.tools.js", export: "social_learning_get_applicable",    description: "Get applicable learnings for a platform." },
  "learning-extract-edit":   { module: "./tools/learning.tools.js", export: "social_learning_extract_from_edit", description: "Extract learnings from a draft edit." },
  "learning-extract-feedback": { module: "./tools/learning.tools.js", export: "social_learning_extract_from_feedback", description: "Extract learnings from rejection feedback." },
  "learning-add-rule":       { module: "./tools/learning.tools.js", export: "social_learning_add_rule",          description: "Add an explicit content rule (100% confidence)." },
  "learning-deactivate":     { module: "./tools/learning.tools.js", export: "social_learning_deactivate",        description: "Deactivate a content learning." },
};

/**
 * Register the social pipeline plugin with OpenClaw.
 *
 * This is the main entry point called by the OpenClaw plugin loader.
 * It initializes the database and registers all tool handlers.
 */
export function registerPlugin(ctx: OpenClawPluginContext): void {
  // Capture plugin context in closure — tool execute() receives the
  // session/agent context, NOT the plugin context, so we must close over
  // logger, config, and dataDir here.
  const pluginLogger = ctx.logger;
  const pluginConfig = ctx.config;
  const pluginDataDir = ctx.dataDir;

  pluginLogger.info("Initializing @openclaw/social-pipeline plugin", {
    dataDir: pluginDataDir,
  });

  // Initialize the database using the plugin's data directory
  const { initDb: init } = require("./db/index.js") as typeof import("./db/index.js");
  const db = init({
    dbPath: `${pluginDataDir}/social-pipeline.db`,
    walMode: true,
  });

  pluginLogger.info("Database initialized successfully");

  // Build the plugin context object passed to every tool handler
  const pluginCtx = {
    db,
    logger: pluginLogger,
    config: pluginConfig,
    dataDir: pluginDataDir,
    services: {},
    skills: {},
  };

  // Register every tool from the mapping table
  let registered = 0;
  for (const [name, meta] of Object.entries(TOOL_MAP)) {
    ctx.registerTool({
      name,
      label: name,
      description: meta.description,
      parameters: { type: "object", properties: {}, additionalProperties: true },
      execute: async (
        _toolCallId: string,
        params: unknown,
        _signal?: unknown,
        _onUpdate?: unknown,
        _toolCtx?: unknown,
      ) => {
        try {
          const mod = await import(meta.module);
          const fn = mod[meta.export];
          if (typeof fn !== "function") {
            throw new Error(
              `Tool "${name}": export "${meta.export}" not found in ${meta.module}`
            );
          }
          const result = await fn(params, pluginCtx);
          return {
            content: [
              {
                type: "text",
                text:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
            details: result,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          pluginLogger.error(`Tool "${name}" failed: ${message}`);
          return {
            content: [
              { type: "text", text: JSON.stringify({ error: message }) },
            ],
            isError: true,
          };
        }
      },
    } as any);
    registered++;
    pluginLogger.debug(`Registered tool: ${name}`);
  }

  pluginLogger.info(
    `@openclaw/social-pipeline plugin registered ${registered} tools`
  );
}

// OpenClaw loader looks for register or activate exports
export const register = registerPlugin;
export const activate = registerPlugin;
export default registerPlugin;
