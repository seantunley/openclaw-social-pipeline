/**
 * One-shot pipeline runner — invoke the bot's pipeline directly without going
 * through Telegram. Useful for smoke-testing the engine before the bot's
 * Telegram credentials are configured.
 *
 * Usage:
 *   npm run build
 *   node --env-file=.env dist/src/scripts/run-topic.js "<topic>" [platform]
 *
 * The run shows up live in the dashboard at http://localhost:3001.
 */

import { initDb } from '../db/index.js';
import { runBotPipeline } from '../bot/pipeline.js';

async function main() {
  const topic = process.argv[2];
  const platform = process.argv[3] ?? process.env.BOT_DEFAULT_PLATFORM ?? 'linkedin';

  if (!topic) {
    console.error('Usage: run-topic "<topic>" [platform]');
    process.exit(1);
  }

  const db = initDb();
  console.log(`▶ Pipeline starting`);
  console.log(`  topic:     ${topic}`);
  console.log(`  platform:  ${platform}`);
  console.log(`  provider:  ${process.env.LLM_PROVIDER ?? 'anthropic'}`);
  console.log('');

  const result = await runBotPipeline(db, topic, platform, {
    onProgress: (stage) => console.log(`  ${stage}`),
  });

  console.log('');
  console.log('━'.repeat(60));
  console.log(`run ${result.runId}`);
  console.log('━'.repeat(60));
  console.log(`seo:        ${result.scores.seo_score ?? '—'}`);
  console.log(`geo:        ${result.scores.geo_score ?? '—'}`);
  console.log(`combined:   ${result.scores.combined_score ?? '—'}`);
  console.log(`citations:  ${result.scores.ai_citation_readiness ?? '—'}`);
  console.log(`image:      ${result.imageUrl || '(failed — text only)'}`);
  console.log('━'.repeat(60));
  console.log('');
  console.log(result.content);
  console.log('');
  console.log('━'.repeat(60));
  console.log(`Visible at http://localhost:3001 — run ${result.runId.slice(0, 8)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('');
    console.error('✗ FAILED');
    console.error((err as Error).stack ?? (err as Error).message);
    process.exit(1);
  });
