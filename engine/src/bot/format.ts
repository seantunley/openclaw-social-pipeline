/**
 * Telegram MarkdownV2 helpers + approval-card formatter.
 */

const MD_SPECIALS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/** Escape every MarkdownV2 special character. */
export function escapeMd(text: string): string {
  return text.replace(MD_SPECIALS, '\\$&');
}

/** Format a single key-value line for the approval card metadata block. */
function kv(key: string, value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') return '';
  return `*${escapeMd(key)}*: ${escapeMd(String(value))}`;
}

interface ApprovalCardInput {
  topic: string;
  platform: string;
  content: string;
  runId: string;
  scores: {
    seo_score?: number;
    geo_score?: number;
    combined_score?: number;
    ai_citation_readiness?: string;
  };
}

/** Render the caption for the approval card photo message. */
export function formatApprovalCard(input: ApprovalCardInput): string {
  const { topic, platform, content, runId, scores } = input;

  const meta = [
    kv('topic', topic),
    kv('platform', platform),
    kv('seo', scores.seo_score),
    kv('geo', scores.geo_score),
    kv('combined', scores.combined_score),
    kv('citation', scores.ai_citation_readiness),
    kv('run', runId.slice(0, 8)),
  ]
    .filter(Boolean)
    .join('\n');

  // Telegram captions cap at ~1024 characters. Truncate the body if needed.
  const maxBodyChars = 600;
  const body = content.length > maxBodyChars
    ? content.slice(0, maxBodyChars) + '…'
    : content;

  return `${escapeMd(body)}\n\n\\-\\-\\-\n${meta}`;
}

/** Plain text for the progress message we keep editing as the run advances. */
export function formatProgress(stage: string, topic: string): string {
  return `${stage}\n_${escapeMd(topic)}_`;
}
