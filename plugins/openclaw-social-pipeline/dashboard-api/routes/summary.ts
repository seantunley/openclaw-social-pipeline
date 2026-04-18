import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  socialRun,
  socialRunStage,
  socialDraft,
  socialPublishRecord,
  socialAnalyticsSnapshot,
} from "../../src/db/schema.js";

const summaryRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done
) => {
  // ── GET /api/social/summary ─────────────────────────────────────────────────
  fastify.get("/api/social/summary", async (_request, reply) => {
    try {
      // Total runs
      const totalResult = await fastify.db
        .select({ count: sql<number>`count(*)` })
        .from(socialRun);
      const total_runs = totalResult[0]?.count ?? 0;

      // By status
      const statusCounts = await fastify.db
        .select({
          status: socialRun.status,
          count: sql<number>`count(*)`,
        })
        .from(socialRun)
        .groupBy(socialRun.status);

      const by_status: Record<string, number> = {};
      for (const row of statusCounts) {
        by_status[row.status] = row.count;
      }

      // Pending approvals: runs where the approve stage is running/pending
      // and the run has ready drafts
      const pendingApprovalResult = await fastify.db
        .select({ count: sql<number>`count(distinct ${socialRunStage.run_id})` })
        .from(socialRunStage)
        .where(
          and(
            eq(socialRunStage.stage_name, "approve"),
            eq(socialRunStage.status, "pending")
          )
        );
      const pending_approvals = pendingApprovalResult[0]?.count ?? 0;

      // Upcoming scheduled posts
      const now = new Date().toISOString();
      const upcomingResult = await fastify.db
        .select({ count: sql<number>`count(*)` })
        .from(socialPublishRecord)
        .where(
          and(
            eq(socialPublishRecord.status, "scheduled"),
            sql`${socialPublishRecord.scheduled_at} > ${now}`
          )
        );
      const upcoming_scheduled = upcomingResult[0]?.count ?? 0;

      // Recent failures (last 24 hours)
      const twentyFourHoursAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000
      ).toISOString();

      const failureResult = await fastify.db
        .select({ count: sql<number>`count(*)` })
        .from(socialRun)
        .where(
          and(
            eq(socialRun.status, "failed"),
            sql`${socialRun.updated_at} >= ${twentyFourHoursAgo}`
          )
        );
      const recent_failures = failureResult[0]?.count ?? 0;

      // Top posts by engagement rate (from analytics snapshots)
      const topPostRows = await fastify.db
        .select({
          publish_record_id: socialAnalyticsSnapshot.publish_record_id,
          draft_id: socialAnalyticsSnapshot.draft_id,
          platform: socialAnalyticsSnapshot.platform,
          impressions: socialAnalyticsSnapshot.impressions,
          engagements: socialAnalyticsSnapshot.engagements,
          likes: socialAnalyticsSnapshot.likes,
          comments: socialAnalyticsSnapshot.comments,
          shares: socialAnalyticsSnapshot.shares,
          engagement_rate: socialAnalyticsSnapshot.engagement_rate,
          snapshot_at: socialAnalyticsSnapshot.snapshot_at,
        })
        .from(socialAnalyticsSnapshot)
        .orderBy(desc(socialAnalyticsSnapshot.engagement_rate))
        .limit(10);

      return reply.send({
        total_runs,
        by_status,
        pending_approvals,
        upcoming_scheduled,
        recent_failures,
        top_posts: topPostRows,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fastify.log.error({ err }, "Failed to generate summary");
      return reply.status(500).send({ error: message });
    }
  });

  done();
};

export default summaryRoutes;
