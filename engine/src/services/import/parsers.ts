/**
 * Per-platform export parsers.
 *
 * Each platform exports its data in a different shape. Twitter ships JS
 * (an assignment to `window.YTD.tweets.part0`), Instagram and Facebook
 * ship JSON-but-deeply-nested, LinkedIn ships CSV, TikTok and YouTube
 * ship loose JSON. We map all of them onto a single normalised shape
 * (`ParsedPost`) so downstream code only has one row schema to think
 * about.
 *
 * Each parser receives a Buffer (the raw uploaded file). The route
 * unwraps ZIPs before dispatching, so parsers always see the inner
 * platform-specific file directly.
 *
 * **Add a new platform:** add a parser keyed by id, and register it in
 * the PARSERS map at the bottom. The route picks one based on the URL
 * `:platform` param.
 */

import type { PlatformId } from '../platform/specs.js';

export interface ParsedPost {
  /** Original platform post id, if available — used for dedupe. */
  platformPostId: string;
  /** Free-form text body. */
  content: string;
  /** ISO 8601 timestamp, if available. Null when the export omits it. */
  postedAt: string | null;
  /** Engagement counts. Sparse object — only fields the export provides. */
  engagement: Record<string, number>;
  /** Original media URLs/IDs as strings. */
  media: string[];
  /** Anything we couldn't normalise — surfaced verbatim for forensics. */
  raw: unknown;
}

export type Parser = (buf: Buffer) => ParsedPost[];

// ---------------------------------------------------------------------------
// Twitter / X
//
// `tweets.js` looks like:
//   window.YTD.tweets.part0 = [ { tweet: { id_str, full_text, ... } }, ... ]
// We strip the assignment prefix and JSON-parse the array. Some archives
// also ship a plain `tweets.json`; we accept either.
// ---------------------------------------------------------------------------

function parseTwitter(buf: Buffer): ParsedPost[] {
  const text = buf.toString('utf8').trim();
  const stripped = text.replace(/^window\.YTD\.[a-zA-Z_0-9.]+\s*=\s*/, '');
  const arr = JSON.parse(stripped) as Array<{ tweet?: TwitterTweet } | TwitterTweet>;
  return arr.map((row) => {
    const t: TwitterTweet = 'tweet' in row && row.tweet ? row.tweet : (row as TwitterTweet);
    const media: string[] = (t.entities?.media ?? [])
      .map((m) => m.media_url_https ?? m.media_url ?? '')
      .filter(Boolean);
    return {
      platformPostId: t.id_str ?? t.id ?? '',
      content: t.full_text ?? t.text ?? '',
      postedAt: parseTwitterDate(t.created_at),
      engagement: {
        favorite_count: numeric(t.favorite_count),
        retweet_count: numeric(t.retweet_count),
        reply_count: numeric(t.reply_count),
        quote_count: numeric(t.quote_count),
      },
      media,
      raw: t,
    };
  });
}

interface TwitterTweet {
  id_str?: string;
  id?: string;
  full_text?: string;
  text?: string;
  created_at?: string;
  favorite_count?: string | number;
  retweet_count?: string | number;
  reply_count?: string | number;
  quote_count?: string | number;
  entities?: {
    media?: Array<{ media_url?: string; media_url_https?: string }>;
  };
}

/** Twitter dates look like "Wed Apr 15 12:34:56 +0000 2026" — convert to ISO. */
function parseTwitterDate(s: string | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Instagram
//
// IG ships a few different shapes depending on data type:
//   posts_1.json  → { string_list_data, media: [...] }  (per-post object)
//   content/posts_1.json (newer) → array of { media: [{uri, creation_timestamp, title}] }
// We accept either.
// ---------------------------------------------------------------------------

function parseInstagram(buf: Buffer): ParsedPost[] {
  const text = decodeUtf8WithBOM(buf);
  const json = JSON.parse(text);
  const rows: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray(json.posts)
      ? json.posts
      : Array.isArray(json.media)
        ? json.media
        : [];

  return rows
    .map((row) => normaliseInstagramRow(row as Record<string, unknown>))
    .filter((r): r is ParsedPost => r !== null);
}

function normaliseInstagramRow(row: Record<string, unknown>): ParsedPost | null {
  const media = Array.isArray(row.media) ? (row.media as Array<Record<string, unknown>>) : [];
  // Title sometimes lives at the top level, sometimes on the first media entry.
  const title =
    asString(row.title) ?? asString(media[0]?.title) ?? '';
  const ts =
    asNumber(row.creation_timestamp) ?? asNumber(media[0]?.creation_timestamp);
  const mediaUrls = media
    .map((m) => asString(m.uri))
    .filter((s): s is string => Boolean(s));
  if (!title && mediaUrls.length === 0) return null;
  return {
    platformPostId: asString(row.media_metadata) ?? `ig:${ts ?? ''}:${mediaUrls[0] ?? ''}`,
    content: title,
    postedAt: ts ? new Date(ts * 1000).toISOString() : null,
    engagement: {},
    media: mediaUrls,
    raw: row,
  };
}

// ---------------------------------------------------------------------------
// Facebook
//
// `your_posts_1.json` ships an array of:
//   { timestamp, data: [{post, ...}], attachments: [{data: [{external_context|media}]}] }
// Multiple `data` entries can share one timestamp (text + photo). We flatten
// into one ParsedPost per row.
// ---------------------------------------------------------------------------

function parseFacebook(buf: Buffer): ParsedPost[] {
  const text = decodeUtf8WithBOM(buf);
  const json = JSON.parse(text);
  const rows: Array<Record<string, unknown>> = Array.isArray(json)
    ? json
    : Array.isArray(json.posts)
      ? json.posts
      : [];
  return rows.map((row) => {
    const data = Array.isArray(row.data) ? (row.data as Array<Record<string, unknown>>) : [];
    const post = data.find((d) => typeof d.post === 'string');
    const content = post ? asString(post.post) ?? '' : '';
    const attachments = Array.isArray(row.attachments)
      ? (row.attachments as Array<Record<string, unknown>>)
      : [];
    const media: string[] = [];
    for (const att of attachments) {
      const items = Array.isArray(att.data) ? (att.data as Array<Record<string, unknown>>) : [];
      for (const item of items) {
        const ext = item.external_context as Record<string, unknown> | undefined;
        if (ext?.url) media.push(asString(ext.url) ?? '');
        const m = item.media as Record<string, unknown> | undefined;
        if (m?.uri) media.push(asString(m.uri) ?? '');
      }
    }
    const ts = asNumber(row.timestamp);
    return {
      platformPostId: `fb:${ts ?? ''}`,
      content,
      postedAt: ts ? new Date(ts * 1000).toISOString() : null,
      engagement: {},
      media: media.filter(Boolean),
      raw: row,
    };
  });
}

// ---------------------------------------------------------------------------
// LinkedIn
//
// `Shares.csv` columns (current as of 2026):
//   Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility
// CSV is tiny (LinkedIn doesn't export a lot per user), so we parse with a
// minimal hand-rolled CSV reader rather than a library.
// ---------------------------------------------------------------------------

function parseLinkedIn(buf: Buffer): ParsedPost[] {
  const rows = parseCsv(decodeUtf8WithBOM(buf));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = (col: string) => header.findIndex((h) => h.toLowerCase() === col.toLowerCase());
  const colDate = idx('Date');
  const colLink = idx('ShareLink');
  const colText = idx('ShareCommentary');
  const colShared = idx('SharedUrl');
  const colMedia = idx('MediaUrl');
  return rows.slice(1).map((row, i) => {
    const date = colDate >= 0 ? row[colDate] : '';
    const text = colText >= 0 ? row[colText] : '';
    const shared = colShared >= 0 ? row[colShared] : '';
    const media = colMedia >= 0 ? row[colMedia] : '';
    const link = colLink >= 0 ? row[colLink] : '';
    return {
      platformPostId: link || `li:${i}`,
      content: text,
      postedAt: date ? new Date(date).toISOString() : null,
      engagement: {},
      media: [shared, media].filter(Boolean),
      raw: { row, header },
    };
  });
}

// ---------------------------------------------------------------------------
// TikTok
//
// `VideoList.json` (or `Posts > Like List` etc.):
//   { Activity: { "Video List": { VideoList: [{ Date, Link, ... }] } } }
// Or the simpler:
//   { VideoList: [...] }
// ---------------------------------------------------------------------------

function parseTikTok(buf: Buffer): ParsedPost[] {
  const text = decodeUtf8WithBOM(buf);
  const json = JSON.parse(text);
  const list: unknown[] = (() => {
    const top = (json as Record<string, unknown>).VideoList;
    if (Array.isArray(top)) return top;
    const act = (json as Record<string, unknown>).Activity as Record<string, unknown> | undefined;
    const sub = act?.['Video List'] as Record<string, unknown> | undefined;
    if (sub && Array.isArray(sub.VideoList)) return sub.VideoList as unknown[];
    return [];
  })();
  return list.map((row, i) => {
    const r = row as Record<string, unknown>;
    return {
      platformPostId: asString(r.Link) ?? `tt:${i}`,
      content: asString(r.Title) ?? '',
      postedAt: asString(r.Date) ? new Date(asString(r.Date)!).toISOString() : null,
      engagement: {
        likes: asNumber(r.Likes) ?? 0,
      },
      media: [asString(r.Link) ?? ''].filter(Boolean),
      raw: r,
    };
  });
}

// ---------------------------------------------------------------------------
// YouTube (Google Takeout)
//
// `video-metadata.json` ships:
//   [ { title, descriptions, addedDate, mediaUrl, ... } ]
// Some takeouts use snake_case instead, accept both.
// ---------------------------------------------------------------------------

function parseYouTube(buf: Buffer): ParsedPost[] {
  const text = decodeUtf8WithBOM(buf);
  const json = JSON.parse(text);
  const rows: Array<Record<string, unknown>> = Array.isArray(json)
    ? json
    : Array.isArray(json.videos)
      ? json.videos
      : [];
  return rows.map((r, i) => {
    const description = (() => {
      const d = r.description ?? r.descriptions;
      if (typeof d === 'string') return d;
      if (Array.isArray(d) && d.length > 0 && typeof d[0] === 'string') return d.join('\n');
      return '';
    })();
    const date =
      asString(r.addedDate) ??
      asString(r.publishedAt) ??
      asString(r.uploaded) ??
      null;
    return {
      platformPostId: asString(r.id) ?? asString(r.videoId) ?? `yt:${i}`,
      content: `${asString(r.title) ?? ''}\n\n${description}`.trim(),
      postedAt: date ? new Date(date).toISOString() : null,
      engagement: {
        views: asNumber(r.views) ?? 0,
        likes: asNumber(r.likes) ?? 0,
      },
      media: [asString(r.mediaUrl) ?? asString(r.url) ?? ''].filter(Boolean),
      raw: r,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeUtf8WithBOM(buf: Buffer): string {
  // Strip UTF-8 BOM (EF BB BF) — Facebook & Instagram exports ship with one.
  const text = buf.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function numeric(v: unknown): number {
  return asNumber(v) ?? 0;
}

/**
 * Minimal RFC 4180 CSV parser. Handles quoted fields with commas + escaped
 * quotes (""). Doesn't try to handle every corner case — LinkedIn exports
 * are well-formed.
 */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(cur);
        cur = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur);
        cur = '';
        if (row.length > 1 || row[0] !== '') out.push(row);
        row = [];
      } else {
        cur += c;
      }
    }
  }
  if (cur || row.length > 0) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const PARSERS: Partial<Record<PlatformId, Parser>> = {
  twitter: parseTwitter,
  instagram: parseInstagram,
  facebook: parseFacebook,
  linkedin: parseLinkedIn,
  tiktok: parseTikTok,
  youtube: parseYouTube,
};

/**
 * Inspect a ZIP entry list and pick the first entry whose name suggests it
 * matches the platform's expected file. Used by the route to extract the
 * relevant entry from a Takeout/Archive ZIP without making the user dig
 * through the bundle.
 */
export function pickEntryForPlatform(
  platform: PlatformId,
  entries: Array<{ name: string }>,
): string | null {
  const patterns: Partial<Record<PlatformId, RegExp[]>> = {
    twitter: [/tweets?\.js$/i, /tweets?\.json$/i],
    instagram: [/posts_\d+\.json$/i, /content\/posts_\d+\.json$/i],
    facebook: [/your_posts_\d+\.json$/i, /posts\/your_posts_\d+\.json$/i],
    linkedin: [/Shares\.csv$/i],
    tiktok: [/VideoList\.json$/i, /Posts.*\.json$/i],
    youtube: [/video[-_]metadata\.json$/i, /watch-history\.json$/i],
  };
  const list = patterns[platform];
  if (!list) return null;
  for (const re of list) {
    const hit = entries.find((e) => re.test(e.name));
    if (hit) return hit.name;
  }
  return null;
}
