/**
 * Telegram bot entry point.
 *
 * Single-operator surface for the social pipeline. Authorized user messages
 * a topic; bot runs research -> SEO/GEO draft -> humanize -> image, then
 * sends an approval card with inline buttons. Approve publishes via Postiz.
 *
 * Run with:  npm run start:bot   (requires .env populated)
 */

import { Telegraf, Markup, Context } from 'telegraf';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb } from '../db/index.js';
import {
  socialRun,
  socialDraft,
  socialMediaAsset,
  socialApproval,
  socialPublishRecord,
} from '../db/schema.js';
import { createPostizAdapter } from '../services/postiz/index.js';
import { runBotPipeline } from './pipeline.js';
import { escapeMd, formatApprovalCard } from './format.js';
import { chat as agentChat } from '../services/agent/runtime.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_ID_RAW = process.env.TELEGRAM_AUTHORIZED_USER_ID;
const DEFAULT_PLATFORM = process.env.BOT_DEFAULT_PLATFORM ?? 'linkedin';
const POSTIZ_INTEGRATION_ID = process.env.POSTIZ_DEFAULT_INTEGRATION_ID ?? '';
const POSTIZ_MODE = (process.env.POSTIZ_MODE ?? 'api') as 'cli' | 'api';
const POSTIZ_API_URL = process.env.POSTIZ_API_URL ?? 'http://localhost:5000';
const POSTIZ_API_KEY = process.env.POSTIZ_API_KEY ?? '';

if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}
if (!AUTHORIZED_ID_RAW) {
  console.error('TELEGRAM_AUTHORIZED_USER_ID is required');
  process.exit(1);
}
const AUTHORIZED_ID = Number(AUTHORIZED_ID_RAW);
if (!Number.isFinite(AUTHORIZED_ID)) {
  console.error('TELEGRAM_AUTHORIZED_USER_ID must be a numeric user id');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Engine wiring
// ---------------------------------------------------------------------------

const db = initDb();
const postiz = createPostizAdapter({
  mode: POSTIZ_MODE,
  apiBaseUrl: POSTIZ_API_URL,
  apiKey: POSTIZ_API_KEY,
});

// ---------------------------------------------------------------------------
// Bot setup
// ---------------------------------------------------------------------------

const bot = new Telegraf(BOT_TOKEN);

// Auth gate — reject anyone other than the configured operator.
bot.use(async (ctx, next) => {
  const fromId = ctx.from?.id;
  if (fromId !== AUTHORIZED_ID) {
    if (ctx.message || ctx.callbackQuery) {
      await ctx.reply('Not authorized.');
    }
    return;
  }
  return next();
});

bot.start((ctx) =>
  ctx.reply(
    'Ready. Default is chat — send any message and the agent (memory + defense) responds. Use /topic <text> to run the pipeline.\n\nCommands: /chat <text>, /topic <text>, /runs, /help',
  ),
);

bot.help((ctx) =>
  ctx.reply(
    'Plain messages talk to the agent (memory + Layer 1+2 defense).\n/chat <text>  — explicit agent chat.\n/topic <text> — full pipeline: research → SEO+GEO draft → humanize → image → approval → publish.\n/runs         — recent pipeline runs.',
  ),
);

bot.command('runs', async (ctx) => {
  const rows = db
    .select()
    .from(socialRun)
    .orderBy(desc(socialRun.created_at))
    .limit(5)
    .all();

  if (rows.length === 0) {
    await ctx.reply('No runs yet.');
    return;
  }

  const lines = rows.map((r) => {
    const config = safeJson<{ brief?: { topic?: string }; platform?: string }>(r.config_snapshot);
    const topic = config?.brief?.topic ?? '(untitled)';
    return `• ${r.status.padEnd(10)} ${r.id.slice(0, 8)}  ${topic}`;
  });
  await ctx.reply('```\n' + lines.join('\n') + '\n```', { parse_mode: 'MarkdownV2' });
});

bot.command('topic', async (ctx) => {
  const text = ctx.message.text.replace(/^\/topic(@\S+)?\s*/, '').trim();
  if (!text) {
    await ctx.reply('Usage: /topic <what to post about>');
    return;
  }
  await runFlow(ctx, text);
});

// /chat <text> — talk to the agent (memory + defense + skills). Distinct
// from /topic which launches the full pipeline.
bot.command('chat', async (ctx) => {
  const text = ctx.message.text.replace(/^\/chat(@\S+)?\s*/, '').trim();
  if (!text) {
    await ctx.reply('Usage: /chat <message>');
    return;
  }
  await runAgentTurn(ctx, text);
});

// Plain message handler. Default route: agent chat (memory + defense). To
// launch the full pipeline, use /topic explicitly.
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return; // unknown command
  await runAgentTurn(ctx, text);
});

// ---------------------------------------------------------------------------
// Pipeline flow
// ---------------------------------------------------------------------------

async function runFlow(ctx: Context, topic: string) {
  const platform = DEFAULT_PLATFORM;
  const status = await ctx.reply(`Starting: ${topic}`);
  const statusChatId = status.chat.id;
  const statusMessageId = status.message_id;

  const updateStatus = async (text: string) => {
    try {
      await ctx.telegram.editMessageText(statusChatId, statusMessageId, undefined, text);
    } catch {
      // Editing fails if the message is identical; ignore.
    }
  };

  try {
    const result = await runBotPipeline(db, topic, platform, {
      onProgress: updateStatus,
    });

    await updateStatus('✅ Ready for review');

    if (result.imageUrl) {
      await ctx.replyWithPhoto(result.imageUrl, {
        caption: formatApprovalCard({
          topic: result.topic,
          platform: result.platform,
          content: result.content,
          runId: result.runId,
          scores: result.scores,
        }),
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Approve', `a:${result.runId}`),
            Markup.button.callback('❌ Reject', `x:${result.runId}`),
          ],
        ]),
      });
    } else {
      // Image generation failed — still surface the draft for review.
      await ctx.reply(
        formatApprovalCard({
          topic: result.topic,
          platform: result.platform,
          content: result.content,
          runId: result.runId,
          scores: result.scores,
        }) + '\n\n_image generation failed — text only_',
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Approve', `a:${result.runId}`),
              Markup.button.callback('❌ Reject', `x:${result.runId}`),
            ],
          ]),
        },
      );
    }
  } catch (err) {
    const message = (err as Error).message;
    await updateStatus(`❌ Failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Agent chat flow — routes through services/agent/runtime.chat()
// ---------------------------------------------------------------------------

async function runAgentTurn(ctx: Context, userMessage: string) {
  const surfaceRef = String(ctx.chat?.id ?? ctx.from?.id ?? 'unknown');
  try {
    const result = await agentChat({
      userMessage,
      surface: 'telegram',
      surfaceRef,
    });

    if (result.status === 'blocked') {
      await ctx.reply(`🛡️ ${result.reply}`);
      return;
    }
    if (result.status === 'killed') {
      await ctx.reply(`⏸️ ${result.reply}`);
      return;
    }
    if (result.status === 'llm_failed') {
      await ctx.reply(`❌ ${result.reply}`);
      return;
    }

    // Telegram bodies are capped at 4096 chars; split if needed.
    // Sign the reply with the agent's name (per the original brief —
    // "Telegram replies sign as '— {name}'").
    const body = result.reply || '(empty reply)';
    const signed = body + `\n\n— ${result.agentName}`;
    for (let i = 0; i < signed.length; i += 3800) {
      await ctx.reply(signed.slice(i, i + 3800));
    }

    // If the agent used any tools, surface a short trace so the operator
    // can see what it did (parity with the dashboard's collapsible tool blocks).
    if (result.toolCalls.length > 0) {
      const trace = result.toolCalls
        .map((t, i) => `  ${i + 1}. ${t.name} (${t.durationMs}ms)`)
        .join('\n');
      await ctx.reply(`🛠 Tools used:\n${trace}`);
    }
  } catch (err) {
    await ctx.reply(`❌ Agent error: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Approve / Reject inline button actions
// ---------------------------------------------------------------------------

bot.action(/^a:(.+)$/, async (ctx) => {
  const runId = ctx.match[1];
  await ctx.answerCbQuery('Publishing…');

  try {
    await publishRun(runId);
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(`✅ Published. run \`${escapeMd(runId.slice(0, 8))}\``, {
      parse_mode: 'MarkdownV2',
    });
  } catch (err) {
    const message = (err as Error).message;
    await ctx.reply(`❌ Publish failed: ${message}`);
  }
});

bot.action(/^x:(.+)$/, async (ctx) => {
  const runId = ctx.match[1];
  await ctx.answerCbQuery('Rejected');

  const now = new Date().toISOString();

  // Mark run cancelled
  db.update(socialRun)
    .set({ status: 'cancelled', updated_at: now })
    .where(eq(socialRun.id, runId))
    .run();

  // Mark the draft rejected and record the approval decision
  const draft = db
    .select()
    .from(socialDraft)
    .where(eq(socialDraft.run_id, runId))
    .get();

  if (draft) {
    db.update(socialDraft)
      .set({ status: 'rejected', updated_at: now })
      .where(eq(socialDraft.id, draft.id))
      .run();

    db.insert(socialApproval)
      .values({
        id: uuidv4(),
        draft_id: draft.id,
        run_id: runId,
        reviewer: 'telegram-bot',
        decision: 'rejected',
        comments: 'Rejected via Telegram bot',
        revision_notes: '',
        reviewed_at: now,
      })
      .run();
  }

  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(`Rejected. run \`${escapeMd(runId.slice(0, 8))}\``, {
    parse_mode: 'MarkdownV2',
  });
});

// ---------------------------------------------------------------------------
// Postiz publish
// ---------------------------------------------------------------------------

async function publishRun(runId: string): Promise<void> {
  const draft = db
    .select()
    .from(socialDraft)
    .where(eq(socialDraft.run_id, runId))
    .get();

  if (!draft) throw new Error(`No draft for run ${runId}`);

  const asset = db
    .select()
    .from(socialMediaAsset)
    .where(eq(socialMediaAsset.draft_id, draft.id))
    .get();

  // Pick the integration: env override, or first one matching the platform.
  let integrationId = POSTIZ_INTEGRATION_ID;
  if (!integrationId) {
    const integrations = await postiz.listIntegrations();
    const match = integrations.find(
      (i: { platform?: string; id: string }) => i.platform === draft.platform,
    );
    if (!match) {
      throw new Error(
        `No Postiz integration found for platform "${draft.platform}". Set POSTIZ_DEFAULT_INTEGRATION_ID in .env or connect the platform in Postiz first.`,
      );
    }
    integrationId = match.id;
  }

  const mediaIds: string[] = [];
  if (asset?.hosted_url) {
    const tempPath = await downloadToTemp(asset.hosted_url, asset.type);
    try {
      const uploaded = await postiz.uploadMedia({ file_path: tempPath });
      mediaIds.push(uploaded.id);

      const meta = safeJson<Record<string, unknown>>(asset.metadata) ?? {};
      meta.postiz_media_id = uploaded.id;
      meta.postiz_media_url = uploaded.url;
      db.update(socialMediaAsset)
        .set({ metadata: JSON.stringify(meta) })
        .where(eq(socialMediaAsset.id, asset.id))
        .run();
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  const post = await postiz.createPost({
    content: draft.final_content || draft.raw_content,
    integration_id: integrationId,
    media_ids: mediaIds.length > 0 ? mediaIds : undefined,
  });

  const now = new Date().toISOString();

  db.insert(socialPublishRecord)
    .values({
      id: uuidv4(),
      draft_id: draft.id,
      run_id: runId,
      platform: draft.platform,
      status: 'published',
      postiz_post_id: post.id,
      postiz_integration_id: integrationId,
      published_at: now,
    })
    .run();

  db.update(socialDraft)
    .set({ status: 'published', updated_at: now })
    .where(eq(socialDraft.id, draft.id))
    .run();

  db.insert(socialApproval)
    .values({
      id: uuidv4(),
      draft_id: draft.id,
      run_id: runId,
      reviewer: 'telegram-bot',
      decision: 'approved',
      comments: 'Approved via Telegram bot',
      revision_notes: '',
      reviewed_at: now,
    })
    .run();

  db.update(socialRun)
    .set({ status: 'completed', completed_at: now, updated_at: now })
    .where(eq(socialRun.id, runId))
    .run();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJson<T>(text: string | null | undefined): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * Fetch a remote URL and write the bytes to a temp file. Postiz's uploadMedia
 * takes a local path, but our media services return URLs (fal.ai). Caller is
 * responsible for unlinking the returned path.
 */
async function downloadToTemp(url: string, kind: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch media (${res.status}) from ${url}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), 'social-bot-'));
  const ext = kind === 'video' ? 'mp4' : 'png';
  const path = join(dir, `media.${ext}`);
  await writeFile(path, bytes);
  return path;
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

bot.launch().then(() => {
  console.log('Telegram bot online. Authorized user id:', AUTHORIZED_ID);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
