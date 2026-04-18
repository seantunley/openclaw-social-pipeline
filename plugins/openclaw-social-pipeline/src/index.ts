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
  registerTool: (name: string, handler: ToolHandler) => void;
  config: Record<string, unknown>;
}

export interface ToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: OpenClawPluginContext) => Promise<unknown>;
}

// Tool name constants for consistent referencing
export const TOOL_NAMES = {
  CREATE_CAMPAIGN: "create-campaign",
  GENERATE_DRAFTS: "generate-drafts",
  HUMANIZE_CONTENT: "humanize-content",
  APPLY_PSYCHOLOGY: "apply-psychology",
  GENERATE_MEDIA: "generate-media",
  SUBMIT_FOR_APPROVAL: "submit-for-approval",
  PUBLISH_CONTENT: "publish-content",
  SYNC_ANALYTICS: "sync-analytics",
  LIST_CAMPAIGNS: "list-campaigns",
  GET_RUN_STATUS: "get-run-status",
} as const;

/**
 * Register the social pipeline plugin with OpenClaw.
 *
 * This is the main entry point called by the OpenClaw plugin loader.
 * It initializes the database and registers all tool handlers.
 */
export function registerPlugin(ctx: OpenClawPluginContext): void {
  const { logger, dataDir } = ctx;

  logger.info("Initializing @openclaw/social-pipeline plugin", {
    dataDir,
  });

  // Initialize the database using the plugin's data directory
  const { initDb: init } = require("./db/index.js") as typeof import("./db/index.js");
  const db = init({
    dbPath: `${dataDir}/social-pipeline.db`,
    walMode: true,
  });

  logger.info("Database initialized successfully");

  // Register all tools
  const toolDefinitions: Array<{
    name: string;
    description: string;
  }> = [
    {
      name: TOOL_NAMES.CREATE_CAMPAIGN,
      description: "Create a new social media campaign with target platforms and goals.",
    },
    {
      name: TOOL_NAMES.GENERATE_DRAFTS,
      description: "Generate content draft variants for a campaign across target platforms.",
    },
    {
      name: TOOL_NAMES.HUMANIZE_CONTENT,
      description: "Run the humanizer pass to remove AI writing patterns from drafts.",
    },
    {
      name: TOOL_NAMES.APPLY_PSYCHOLOGY,
      description: "Enhance drafts with marketing psychology principles and mental models.",
    },
    {
      name: TOOL_NAMES.GENERATE_MEDIA,
      description: "Generate images or video assets for social media drafts.",
    },
    {
      name: TOOL_NAMES.SUBMIT_FOR_APPROVAL,
      description: "Submit finalized drafts for human review and approval.",
    },
    {
      name: TOOL_NAMES.PUBLISH_CONTENT,
      description: "Publish approved content to platforms via Postiz CLI or API.",
    },
    {
      name: TOOL_NAMES.SYNC_ANALYTICS,
      description: "Pull analytics snapshots from Postiz for published content.",
    },
    {
      name: TOOL_NAMES.LIST_CAMPAIGNS,
      description: "List campaigns with optional filters for status, platform, and date range.",
    },
    {
      name: TOOL_NAMES.GET_RUN_STATUS,
      description: "Get detailed status of a pipeline run including all stages.",
    },
  ];

  for (const tool of toolDefinitions) {
    ctx.registerTool(tool.name, {
      name: tool.name,
      description: tool.description,
      parameters: {},
      execute: async (args, toolCtx) => {
        // Dynamic import of tool handler
        const handlerModule = await import(`./tools/${tool.name}.js`);
        return handlerModule.default(args, toolCtx, db);
      },
    });
    logger.debug(`Registered tool: ${tool.name}`);
  }

  logger.info(
    `@openclaw/social-pipeline plugin registered ${toolDefinitions.length} tools`
  );
}
