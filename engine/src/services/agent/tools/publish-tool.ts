/**
 * publishToPostiz — sends an approved draft to Postiz, with optional schedule.
 *
 * Per the original brief: "Tool: publishToPostiz(draftId, platform, scheduledAt?)."
 * We accept a runId OR a draftId so the agent can chain after approveDraft
 * (which returns a runId) without an extra lookup.
 *
 * Loud failures: missing draft / missing media / no integration / network
 * failure — all throw with the specific error so the operator + LLM see
 * exactly what went wrong.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../../../db/index.js";
import { socialDraft, socialMediaAsset, socialPublishRecord } from "../../../db/schema.js";
import { createPostizAdapter } from "../../postiz/index.js";

export const publishToPostizSchema = z.object({
  runId: z.string().optional().describe("Run id to publish (alternative to draftId)."),
  draftId: z.string().optional().describe("Draft id to publish (alternative to runId)."),
  platform: z
    .string()
    .min(2)
    .max(40)
    .optional()
    .describe("Override platform; defaults to the draft's platform."),
  scheduledAt: z
    .string()
    .optional()
    .describe("ISO timestamp to schedule the post. Omit for immediate publish."),
});
export type PublishToPostizInput = z.infer<typeof publishToPostizSchema>;

export interface PublishToPostizOutput {
  ok: boolean;
  runId: string | null;
  draftId: string | null;
  postId?: string;
  scheduledAt?: string;
  error?: string;
}

export async function publishToPostizTool(
  input: PublishToPostizInput,
): Promise<PublishToPostizOutput> {
  if (!input.runId && !input.draftId) {
    return {
      ok: false,
      runId: null,
      draftId: null,
      error: "publishToPostiz requires either runId or draftId.",
    };
  }
  const db = getDb();

  const draft = (input.draftId
    ? db.select().from(socialDraft).where(eq(socialDraft.id, input.draftId)).get()
    : db.select().from(socialDraft).where(eq(socialDraft.run_id, input.runId!)).get()) as
    | {
        id: string;
        run_id: string;
        platform: string;
        status: string;
        final_content: string;
        raw_content: string;
      }
    | undefined;

  if (!draft) {
    return {
      ok: false,
      runId: input.runId ?? null,
      draftId: input.draftId ?? null,
      error: `No draft found for ${input.runId ? `runId=${input.runId}` : `draftId=${input.draftId}`}.`,
    };
  }
  if (draft.status !== "approved") {
    return {
      ok: false,
      runId: draft.run_id,
      draftId: draft.id,
      error: `Draft ${draft.id} is in status '${draft.status}'. Approve it first (use approveDraft) before publishing.`,
    };
  }

  const platform = input.platform ?? draft.platform;
  const postiz = createPostizAdapter({
    mode: (process.env.POSTIZ_MODE ?? "api") as "cli" | "api",
    apiBaseUrl: process.env.POSTIZ_API_URL ?? "http://localhost:5000",
    apiKey: process.env.POSTIZ_API_KEY ?? "",
  });

  // Resolve the Postiz integration for this platform.
  let integrationId = process.env.POSTIZ_DEFAULT_INTEGRATION_ID ?? "";
  if (!integrationId) {
    const integrations = await postiz.listIntegrations();
    const match = integrations.find(
      (i: { platform?: string; id: string }) => i.platform === platform,
    );
    if (!match) {
      return {
        ok: false,
        runId: draft.run_id,
        draftId: draft.id,
        error: `No Postiz integration found for platform '${platform}'. Connect it in Postiz first or set POSTIZ_DEFAULT_INTEGRATION_ID.`,
      };
    }
    integrationId = match.id;
  }

  // Upload media if any.
  const asset = db
    .select()
    .from(socialMediaAsset)
    .where(eq(socialMediaAsset.draft_id, draft.id))
    .get() as { id: string; type: string; hosted_url: string | null; metadata: string } | undefined;

  const mediaIds: string[] = [];
  if (asset?.hosted_url) {
    const tempPath = await downloadToTemp(asset.hosted_url, asset.type);
    try {
      const uploaded = await postiz.uploadMedia({ file_path: tempPath });
      mediaIds.push(uploaded.id);
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  const post = await postiz.createPost({
    content: draft.final_content || draft.raw_content,
    integration_id: integrationId,
    media_ids: mediaIds.length > 0 ? mediaIds : undefined,
    scheduled_for: input.scheduledAt,
  });

  const now = new Date().toISOString();
  db.insert(socialPublishRecord)
    .values({
      id: uuidv4(),
      draft_id: draft.id,
      run_id: draft.run_id,
      platform,
      postiz_integration_id: integrationId,
      postiz_post_id: post.id ?? null,
      platform_post_url: post.url ?? null,
      status: input.scheduledAt ? "scheduled" : "published",
      scheduled_at: input.scheduledAt ?? null,
      published_at: input.scheduledAt ? null : now,
    })
    .run();

  return {
    ok: true,
    runId: draft.run_id,
    draftId: draft.id,
    postId: post.id,
    scheduledAt: input.scheduledAt,
  };
}

async function downloadToTemp(url: string, kind: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Failed to download media from ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = kind === "video" ? ".mp4" : ".png";
  const dir = await mkdtemp(join(tmpdir(), "agent-media-"));
  const path = join(dir, `asset${ext}`);
  await writeFile(path, buf);
  return path;
}
