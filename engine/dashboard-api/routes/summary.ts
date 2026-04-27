import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { eq, and, desc, sql, isNull, isNotNull } from "drizzle-orm";
import {
  socialRun,
  socialDraft,
  socialPublishRecord,
  socialCampaign,
} from "../../src/db/schema.js";

/**
 * Summary endpoint for the dashboard Overview page.
 *
 * Returns the camelCase shape the dashboard expects (`totalRuns`, `pendingApproval`,
 * `recentFailures` as arrays etc.) — earlier versions of this route returned
 * snake_case scalar shapes that the React side never rendered.
 */
const summaryRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done,
) => {
  fastify.get("/api/social/summary", async (_request, reply) => {
    try {
      // ── totalRuns ──────────────────────────────────────────────────────────
      const totalRow = await fastify.db
        .select({ count: sql<number>`count(*)` })
        .from(socialRun)
        .where(isNull(socialRun.deleted_at));
      const totalRuns = totalRow[0]?.count ?? 0;

      const trashedRow = await fastify.db
        .select({ count: sql<number>`count(*)` })
        .from(socialRun)
        .where(isNotNull(socialRun.deleted_at));
      const trashedRuns = trashedRow[0]?.count ?? 0;

      // ── pendingApproval = drafts in `ready` status ─────────────────────────
      const pendingRow = await fastify.db
        .select({ count: sql<number>`count(*)` })
        .from(socialDraft)
        .where(eq(socialDraft.status, "ready"));
      const pendingApproval = pendingRow[0]?.count ?? 0;

      // ── scheduled / published from socialPublishRecord ─────────────────────
      const scheduledRow = await fastify.db
        .select({ count: sql<number>`count(*)` })
        .from(socialPublishRecord)
        .where(eq(socialPublishRecord.status, "scheduled"));
      const scheduled = scheduledRow[0]?.count ?? 0;

      const publishedRow = await fastify.db
        .select({ count: sql<number>`count(*)` })
        .from(socialPublishRecord)
        .where(eq(socialPublishRecord.status, "published"));
      const published = publishedRow[0]?.count ?? 0;

      // ── statusBreakdown = chart data for run status distribution ───────────
      // Excludes trashed runs from the chart.
      const statusRows = await fastify.db
        .select({
          status: socialRun.status,
          count: sql<number>`count(*)`,
        })
        .from(socialRun)
        .where(isNull(socialRun.deleted_at))
        .groupBy(socialRun.status);
      const statusBreakdown = statusRows.map((r) => ({
        status: r.status,
        count: r.count,
      }));

      // ── recentFailures: last 5 failed runs with campaign name ─────────────
      const failedRows = await fastify.db
        .select({
          id: socialRun.id,
          campaign: socialCampaign.name,
          campaign_id: socialRun.campaign_id,
          updatedAt: socialRun.updated_at,
          errorMessage: socialRun.error_message,
        })
        .from(socialRun)
        .leftJoin(socialCampaign, eq(socialCampaign.id, socialRun.campaign_id))
        .where(eq(socialRun.status, "failed"))
        .orderBy(desc(socialRun.updated_at))
        .limit(5);
      const recentFailures = failedRows.map((r) => ({
        id: r.id,
        campaign: r.campaign ?? r.campaign_id,
        failedStage: r.errorMessage?.split(":")[0]?.slice(0, 60) ?? "unknown",
        updatedAt: r.updatedAt,
      }));

      // ── upcomingScheduled: next 5 scheduled publish records ───────────────
      const scheduledRows = await fastify.db
        .select({
          id: socialPublishRecord.id,
          run_id: socialPublishRecord.run_id,
          platform: socialPublishRecord.platform,
          scheduled_at: socialPublishRecord.scheduled_at,
        })
        .from(socialPublishRecord)
        .where(
          and(
            eq(socialPublishRecord.status, "scheduled"),
            sql`${socialPublishRecord.scheduled_at} IS NOT NULL`,
          ),
        )
        .orderBy(socialPublishRecord.scheduled_at)
        .limit(5);

      // Resolve campaign names for upcoming via the parent run
      const upcomingScheduled = await Promise.all(
        scheduledRows.map(async (r) => {
          const run = await fastify.db
            .select({
              campaign_id: socialRun.campaign_id,
              campaign_name: socialCampaign.name,
            })
            .from(socialRun)
            .leftJoin(socialCampaign, eq(socialCampaign.id, socialRun.campaign_id))
            .where(eq(socialRun.id, r.run_id))
            .limit(1);
          const c = run[0];
          return {
            id: r.id,
            campaign: c?.campaign_name ?? c?.campaign_id ?? r.run_id,
            platform: r.platform,
            scheduledAt: r.scheduled_at,
          };
        }),
      );

      return reply.send({
        totalRuns,
        trashedRuns,
        pendingApproval,
        scheduled,
        published,
        statusBreakdown,
        recentFailures,
        upcomingScheduled,
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
