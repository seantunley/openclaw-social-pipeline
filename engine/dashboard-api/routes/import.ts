import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { eq, sql } from 'drizzle-orm';
import AdmZip from 'adm-zip';
import { socialImportBatch, socialImportedPost } from '../../src/db/schema.js';
import {
  PARSERS,
  pickEntryForPlatform,
  type ParsedPost,
} from '../../src/services/import/parsers.js';
import {
  isKnownPlatform,
  type PlatformId,
} from '../../src/services/platform/specs.js';

/**
 * Settings → Import Historical Content endpoints.
 *
 * Routes:
 *   POST /api/social/import/:platform   multipart upload, returns batch info
 *   GET  /api/social/import/history     list previous imports + post counts
 *   DELETE /api/social/import/:batchId  remove a batch and all its posts
 *   POST /api/social/import/empty       wipe ALL imported data (with safety prompt UI-side)
 */
const importRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // ── POST /api/social/import/:platform ─────────────────────────────────────
  fastify.post('/api/social/import/:platform', async (request, reply) => {
    const { platform } = request.params as { platform: string };
    if (!isKnownPlatform(platform)) {
      return reply.status(400).send({ error: `Unknown platform: ${platform}` });
    }
    const parser = PARSERS[platform as PlatformId];
    if (!parser) {
      return reply
        .status(400)
        .send({ error: `No parser registered for ${platform}` });
    }

    let file: Awaited<ReturnType<typeof request.file>>;
    try {
      file = await request.file();
    } catch (err) {
      return reply
        .status(400)
        .send({ error: `Invalid multipart upload: ${(err as Error).message}` });
    }
    if (!file) {
      return reply.status(400).send({ error: 'No file in upload' });
    }

    const buffer = await file.toBuffer();
    const filename = file.filename;

    // If it's a ZIP, find the platform-specific entry inside and parse that.
    // Otherwise hand the buffer straight to the parser.
    let parsedPosts: ParsedPost[];
    try {
      if (/\.zip$/i.test(filename)) {
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries().map((e) => ({ name: e.entryName }));
        const target = pickEntryForPlatform(platform as PlatformId, entries);
        if (!target) {
          return reply.status(400).send({
            error: `No recognised ${platform} export file inside ZIP. Expected one of: tweets.js / posts_1.json / Shares.csv etc.`,
          });
        }
        const inner = zip.getEntry(target);
        if (!inner) {
          return reply.status(500).send({ error: 'ZIP entry vanished mid-read' });
        }
        parsedPosts = parser(inner.getData());
      } else {
        parsedPosts = parser(buffer);
      }
    } catch (err) {
      fastify.log.error({ err }, 'Import parse failed');
      return reply
        .status(400)
        .send({ error: `Could not parse ${platform} export: ${(err as Error).message}` });
    }

    // Persist batch + posts.
    const batchId = uuidv4();
    const now = new Date().toISOString();
    const db = fastify.db;
    db.insert(socialImportBatch)
      .values({
        id: batchId,
        platform,
        filename,
        file_size: buffer.byteLength,
        total_posts: parsedPosts.length,
        created_at: now,
      })
      .run();

    // Bulk insert in chunks of 200 to keep statement sizes sane.
    const CHUNK = 200;
    for (let i = 0; i < parsedPosts.length; i += CHUNK) {
      const slice = parsedPosts.slice(i, i + CHUNK);
      db.insert(socialImportedPost)
        .values(
          slice.map((p) => ({
            id: uuidv4(),
            batch_id: batchId,
            platform,
            platform_post_id: p.platformPostId,
            content: p.content,
            posted_at: p.postedAt ?? null,
            engagement: JSON.stringify(p.engagement),
            media: JSON.stringify(p.media),
            raw: JSON.stringify(p.raw),
            created_at: now,
          })),
        )
        .run();
    }

    return reply.send({
      ok: true,
      batchId,
      platform,
      filename,
      totalPosts: parsedPosts.length,
    });
  });

  // ── GET /api/social/import/history ────────────────────────────────────────
  fastify.get('/api/social/import/history', async (_request, reply) => {
    const db = fastify.db;
    const batches = db
      .select()
      .from(socialImportBatch)
      .orderBy(sql`${socialImportBatch.created_at} DESC`)
      .all();
    return reply.send({ batches });
  });

  // ── DELETE /api/social/import/:batchId ────────────────────────────────────
  // Posts cascade via the FK ON DELETE CASCADE.
  fastify.delete('/api/social/import/:batchId', async (request, reply) => {
    const { batchId } = request.params as { batchId: string };
    const db = fastify.db;
    db.delete(socialImportBatch).where(eq(socialImportBatch.id, batchId)).run();
    return reply.send({ ok: true, deleted: batchId });
  });

  // ── POST /api/social/import/empty ─────────────────────────────────────────
  fastify.post('/api/social/import/empty', async (_request, reply) => {
    const db = fastify.db;
    db.delete(socialImportBatch).run();
    db.delete(socialImportedPost).run();
    return reply.send({ ok: true });
  });
};

export default importRoutes;
