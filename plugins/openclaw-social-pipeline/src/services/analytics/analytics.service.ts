import { eq, desc, sql, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  socialRun,
  socialAnalyticsSnapshot,
} from '../../db/schema.js';
import type {
  SocialPublisher,
  PostAnalytics,
  PlatformAnalytics,
  DateRange,
} from '../postiz/types.js';
import { llmGenerate } from '../pipeline/llm.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface AnalyticsSnapshot {
  id: string;
  run_id: string | null;
  integration_id: string | null;
  type: 'post' | 'platform';
  data_json: string;
  captured_at: string;
}

interface TopPerformer {
  id: string;
  run_id: string | null;
  post_analytics: PostAnalytics;
  captured_at: string;
}

interface CampaignAnalyticsSummary {
  campaign_id: string;
  total_posts: number;
  total_impressions: number;
  total_clicks: number;
  total_likes: number;
  total_shares: number;
  total_comments: number;
  avg_engagement_rate: number;
  snapshots: AnalyticsSnapshot[];
}

// --------------------------------------------------------------------------
// Analytics Service
// --------------------------------------------------------------------------

export class AnalyticsService {
  constructor(private readonly db: BetterSQLite3Database) {}

  // ------------------------------- sync -----------------------------------

  /**
   * Fetch analytics from Postiz for a specific published run and store a
   * snapshot in the database.
   */
  async syncPostAnalytics(
    runId: string,
    postiz: SocialPublisher
  ): Promise<PostAnalytics | null> {
    // Look up the run to find the published post ID
    const runs = this.db
      .select()
      .from(socialRun)
      .where(eq(socialRun.id, runId))
      .all();

    if (runs.length === 0) {
      throw new Error(`Run not found: ${runId}`);
    }

    const run = runs[0];
    const postId = (run as Record<string, unknown>).postiz_post_id as string | undefined;

    if (!postId) {
      // No published post to fetch analytics for
      return null;
    }

    const analytics = await postiz.getPostAnalytics(postId);

    // Store snapshot
    const snapshot: AnalyticsSnapshot = {
      id: uuidv4(),
      run_id: runId,
      integration_id: null,
      type: 'post',
      data_json: JSON.stringify(analytics),
      captured_at: new Date().toISOString(),
    };

    this.db.insert(socialAnalyticsSnapshot).values({
      id: snapshot.id,
      run_id: snapshot.run_id,
      integration_id: snapshot.integration_id,
      type: snapshot.type,
      data_json: snapshot.data_json,
      captured_at: snapshot.captured_at,
    }).run();

    return analytics;
  }

  /**
   * Fetch platform-level analytics from Postiz and store a snapshot.
   */
  async syncPlatformAnalytics(
    integrationId: string,
    postiz: SocialPublisher,
    range?: DateRange
  ): Promise<PlatformAnalytics> {
    const analytics = await postiz.getPlatformAnalytics(integrationId, range);

    const snapshot: AnalyticsSnapshot = {
      id: uuidv4(),
      run_id: null,
      integration_id: integrationId,
      type: 'platform',
      data_json: JSON.stringify(analytics),
      captured_at: new Date().toISOString(),
    };

    this.db.insert(socialAnalyticsSnapshot).values({
      id: snapshot.id,
      run_id: snapshot.run_id,
      integration_id: snapshot.integration_id,
      type: snapshot.type,
      data_json: snapshot.data_json,
      captured_at: snapshot.captured_at,
    }).run();

    return analytics;
  }

  // ------------------------------ queries ---------------------------------

  /**
   * Query stored analytics snapshots for the best-performing posts,
   * sorted by engagement rate descending.
   */
  async getTopPerformers(limit?: number): Promise<TopPerformer[]> {
    const effectiveLimit = limit ?? 10;

    const rows = this.db
      .select()
      .from(socialAnalyticsSnapshot)
      .where(eq(socialAnalyticsSnapshot.type, 'post'))
      .orderBy(desc(socialAnalyticsSnapshot.captured_at))
      .all();

    // Parse and sort by engagement_rate
    const parsed: TopPerformer[] = rows
      .map((row) => {
        try {
          const data = JSON.parse(row.data_json as string) as PostAnalytics;
          return {
            id: row.id as string,
            run_id: (row.run_id as string) ?? null,
            post_analytics: data,
            captured_at: row.captured_at as string,
          };
        } catch {
          return null;
        }
      })
      .filter((item): item is TopPerformer => item !== null)
      .sort(
        (a, b) =>
          b.post_analytics.engagement_rate - a.post_analytics.engagement_rate
      )
      .slice(0, effectiveLimit);

    return parsed;
  }

  /**
   * Aggregate analytics data for all runs belonging to a campaign.
   */
  async getCampaignAnalytics(
    campaignId: string
  ): Promise<CampaignAnalyticsSummary> {
    // Get all runs for this campaign
    const runs = this.db
      .select({ id: socialRun.id })
      .from(socialRun)
      .where(eq(socialRun.campaign_id, campaignId))
      .all();

    const runIds = runs.map((r) => r.id as string);

    if (runIds.length === 0) {
      return {
        campaign_id: campaignId,
        total_posts: 0,
        total_impressions: 0,
        total_clicks: 0,
        total_likes: 0,
        total_shares: 0,
        total_comments: 0,
        avg_engagement_rate: 0,
        snapshots: [],
      };
    }

    // Fetch all post-type analytics snapshots for these runs
    // Since drizzle-orm's inArray may not be available, we query per run
    const allSnapshots: AnalyticsSnapshot[] = [];
    for (const rid of runIds) {
      const rows = this.db
        .select()
        .from(socialAnalyticsSnapshot)
        .where(
          and(
            eq(socialAnalyticsSnapshot.run_id, rid),
            eq(socialAnalyticsSnapshot.type, 'post')
          )
        )
        .all();

      for (const row of rows) {
        allSnapshots.push({
          id: row.id as string,
          run_id: (row.run_id as string) ?? null,
          integration_id: (row.integration_id as string) ?? null,
          type: row.type as 'post' | 'platform',
          data_json: row.data_json as string,
          captured_at: row.captured_at as string,
        });
      }
    }

    // Deduplicate by taking the latest snapshot per run
    const latestPerRun = new Map<string, PostAnalytics>();
    for (const snap of allSnapshots) {
      if (!snap.run_id) continue;
      try {
        const data = JSON.parse(snap.data_json) as PostAnalytics;
        const existing = latestPerRun.get(snap.run_id);
        if (!existing) {
          latestPerRun.set(snap.run_id, data);
        }
        // We already sorted by desc captured_at, so first one wins
      } catch {
        // skip malformed data
      }
    }

    const analytics = Array.from(latestPerRun.values());
    const totalPosts = analytics.length;

    const totals = analytics.reduce(
      (acc, a) => ({
        impressions: acc.impressions + a.impressions,
        clicks: acc.clicks + a.clicks,
        likes: acc.likes + a.likes,
        shares: acc.shares + a.shares,
        comments: acc.comments + a.comments,
        engagement: acc.engagement + a.engagement_rate,
      }),
      { impressions: 0, clicks: 0, likes: 0, shares: 0, comments: 0, engagement: 0 }
    );

    return {
      campaign_id: campaignId,
      total_posts: totalPosts,
      total_impressions: totals.impressions,
      total_clicks: totals.clicks,
      total_likes: totals.likes,
      total_shares: totals.shares,
      total_comments: totals.comments,
      avg_engagement_rate: totalPosts > 0 ? totals.engagement / totalPosts : 0,
      snapshots: allSnapshots,
    };
  }

  // ----------------------------- insights ---------------------------------

  /**
   * Use LLM to generate actionable insights from analytics data.
   */
  async generateInsights(analytics: unknown[]): Promise<string> {
    if (analytics.length === 0) {
      return 'No analytics data available to generate insights.';
    }

    const systemPrompt = `You are a social media analytics expert. Analyze the provided analytics data and generate actionable insights.

Structure your response as:
1. **Performance Summary** — key metrics at a glance
2. **Top Insights** — 3-5 data-driven observations
3. **Recommendations** — specific, actionable next steps
4. **Trends** — patterns you notice across the data

Be concise, specific, and data-driven. Reference actual numbers from the data.`;

    const userPrompt = `Analytics data:\n${JSON.stringify(analytics, null, 2)}`;

    const insights = await llmGenerate(systemPrompt, userPrompt, {
      temperature: 0.5,
      maxTokens: 4096,
    });

    return insights;
  }
}
