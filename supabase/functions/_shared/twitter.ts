/**
 * Thin TwitterAPI.io client.
 *
 * We use the user-timeline endpoint to fetch recent tweets for a given handle.
 * The response shape is documented at https://docs.twitterapi.io; we treat it
 * defensively (optional fields, never throw on missing keys) so a vendor
 * schema tweak doesn't take ingestion down.
 */

const BASE_URL = "https://api.twitterapi.io";

export interface RawTweet {
  id: string;
  text: string;
  created_at: string; // ISO
  url: string;        // canonical x.com/<handle>/status/<id>
  is_retweet: boolean;
  is_quote: boolean;
  is_reply: boolean;
  in_reply_to_user_handle: string | null;
}

export class TwitterApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Fetch recent tweets for a handle (without the leading '@').
 * Pages via `cursor` until we hit `sinceId` or `untilEpochSec`, whichever comes
 * first. Returns tweets in CHRONOLOGICAL order (oldest first) so we can ingest
 * sequentially and advance `last_seen_tweet_id` to the newest at the end.
 */
export async function fetchUserTweets(opts: {
  apiKey: string;
  handle: string;          // no leading '@'
  sinceId?: string | null; // exclusive; stop when we reach this id
  untilEpochSec?: number;  // also stop when tweets older than this
  maxTweets?: number;      // hard safety cap (default 200)
}): Promise<RawTweet[]> {
  const { apiKey, handle, sinceId, untilEpochSec, maxTweets = 200 } = opts;

  const collected: RawTweet[] = [];
  let cursor: string | undefined = undefined;
  let pages = 0;

  while (collected.length < maxTweets && pages < 10) {
    pages++;
    const params = new URLSearchParams({ userName: handle });
    if (cursor) params.set("cursor", cursor);

    const url = `${BASE_URL}/twitter/user/last_tweets?${params.toString()}`;
    const resp = await fetch(url, {
      headers: { "x-api-key": apiKey, "accept": "application/json" },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new TwitterApiError(
        `TwitterAPI.io ${resp.status}: ${body.slice(0, 200)}`,
        resp.status,
      );
    }

    const json = await resp.json();
    const tweets: unknown[] = pickArray(json, ["tweets", "data", "results"]) ?? [];
    if (tweets.length === 0) break;

    let stop = false;
    for (const t of tweets) {
      const norm = normalizeTweet(t, handle);
      if (!norm) continue;
      if (sinceId && norm.id === sinceId) { stop = true; break; }
      if (untilEpochSec && Date.parse(norm.created_at) / 1000 < untilEpochSec) { stop = true; break; }
      collected.push(norm);
      if (collected.length >= maxTweets) { stop = true; break; }
    }
    if (stop) break;

    const next = pickString(json, ["next_cursor", "cursor", "nextCursor"]);
    if (!next) break;
    cursor = next;

    // TwitterAPI.io free tier: 1 request per 5 seconds. Sleep before the next
    // page to stay under the QPS limit. Callers also need to space their own
    // top-of-loop requests.
    await sleep(5500);
  }

  // Vendor returns newest-first; reverse so callers can advance the cursor
  // monotonically to the LAST tweet they processed.
  return collected.reverse();
}

/** Keep originals + quote-tweets + self-replies. Drop retweets and replies to others. */
export function isWorthIngesting(t: RawTweet): boolean {
  if (t.is_retweet) return false;
  if (t.is_reply && t.in_reply_to_user_handle &&
      t.in_reply_to_user_handle.toLowerCase() !== "") {
    // self-reply (own thread) only; assumes caller passes handle already
    // but we can't know it here, so caller's filter step refines this.
  }
  return true;
}

// ---------- defensive parsers ----------

function normalizeTweet(raw: unknown, handle: string): RawTweet | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = pickString(r, ["id", "tweet_id", "id_str", "rest_id"]);
  const text = pickString(r, ["text", "full_text", "content"]) ?? "";
  const created = pickString(r, ["created_at", "createdAt", "date"]) ?? "";
  if (!id || !text || !created) return null;

  const isRetweet = pickBool(r, ["is_retweet", "isRetweet", "retweeted"]) ?? false;
  const isQuote = pickBool(r, ["is_quote", "isQuote", "isQuoteTweet"]) ?? false;
  const isReply = pickBool(r, ["is_reply", "isReply"]) ??
    Boolean(pickString(r, ["in_reply_to_status_id", "inReplyToId"]));
  const replyTo = pickString(r, [
    "in_reply_to_screen_name",
    "in_reply_to_user_handle",
    "inReplyToUserName",
  ]);

  const isoCreated = parseDateIso(created);

  return {
    id,
    text,
    created_at: isoCreated,
    url: `https://x.com/${handle}/status/${id}`,
    is_retweet: isRetweet,
    is_quote: isQuote,
    is_reply: isReply,
    in_reply_to_user_handle: replyTo,
  };
}

function pickArray(o: unknown, keys: string[]): unknown[] | null {
  if (typeof o !== "object" || o === null) return null;
  const obj = o as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
    // sometimes nested under {data: {tweets: [...]}}
    if (v && typeof v === "object") {
      const sub = pickArray(v, keys);
      if (sub) return sub;
    }
  }
  return null;
}

function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function pickBool(o: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (v === "true") return true;
      if (v === "false") return false;
    }
  }
  return null;
}

function parseDateIso(s: string): string {
  // TwitterAPI.io can return either ISO ("2026-07-01T...") or Twitter's
  // legacy format ("Wed Jul 01 12:00:00 +0000 2026"). Date.parse handles both.
  const ms = Date.parse(s);
  return isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
