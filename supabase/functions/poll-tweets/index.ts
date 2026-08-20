/**
 * Poll Tweets — single-handle worker.
 *
 * Fetches recent tweets for one journalist from TwitterAPI.io, filters out
 * retweets and replies to others, POSTs each remaining tweet to ingest-claim,
 * and advances the journalist's last_seen_tweet_id cursor.
 *
 * POST body:
 *   { "journalist_id": "uuid", "x_handle"?: "@Handle", "since_id"?: "tweet_id", "cold_start_days"?: 7 }
 * The batch scheduler supplies all three; humans can call it with just
 * journalist_id for debugging.
 *
 * Requires secrets: TWITTERAPI_IO_KEY, OPENAI_API_KEY (used downstream by
 * ingest-claim), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { corsHeaders, corsHeadersFor } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { fetchUserTweets, TwitterApiError, RawTweet } from "../_shared/twitter.ts";

interface PollBody {
  journalist_id?: string;
  x_handle?: string;
  since_id?: string | null;
  cold_start_days?: number;
}

const COLD_START_DAYS_DEFAULT = 7;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  const requestId = generateRequestId();
  if (req.method !== "POST")
    return errorResponse(ErrorCodes.VALIDATION_ERROR, "Method not allowed", requestId, 405);

  // Machine-to-machine only: called by poll-tweets-batch, which already sends
  // the service role key. Checked before the Twitter key is read, so an
  // unauthorized caller cannot burn rate-limited quota.
  const unauthorized = requireServiceRole(req, requestId);
  if (unauthorized) return unauthorized;

  const twKey = Deno.env.get("TWITTERAPI_IO_KEY");
  if (!twKey)
    return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, "TWITTERAPI_IO_KEY not configured", requestId, 503);

  let body: PollBody;
  try { body = await req.json(); } catch {
    return errorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid JSON body", requestId, 400);
  }
  if (!body.journalist_id)
    return errorResponse(ErrorCodes.VALIDATION_ERROR, "`journalist_id` is required", requestId, 400);

  const supabase = createServiceClient();
  const supaUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Look up the handle if the caller didn't supply it.
  // We go through a SECURITY DEFINER wrapper since `transfers` isn't exposed
  // via PostgREST.
  let handle = body.x_handle;
  let sinceId = body.since_id ?? null;
  if (!handle) {
    const { data, error } = await supabase.rpc("get_journalist_for_poll", { p_id: body.journalist_id });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) {
      return errorResponse(ErrorCodes.VALIDATION_ERROR, `journalist not found: ${error?.message ?? "unknown"}`, requestId, 404);
    }
    handle = row.x_handle as string;
    sinceId = (row.last_seen_tweet_id as string | null) ?? sinceId;
  }
  if (!handle) return errorResponse(ErrorCodes.VALIDATION_ERROR, "journalist has no x_handle", requestId, 400);

  const bareHandle = handle.replace(/^@+/, "");
  const coldStartDays = body.cold_start_days ?? COLD_START_DAYS_DEFAULT;
  const untilEpochSec = sinceId ? undefined : Math.floor(Date.now() / 1000) - coldStartDays * 86400;

  logStructured(requestId, "poll_tweets_request", {
    journalist_id: body.journalist_id, handle: bareHandle, since_id: sinceId, cold_start_days: coldStartDays,
  });

  // --- 1) Fetch from TwitterAPI.io ---
  let raw: RawTweet[];
  try {
    raw = await fetchUserTweets({ apiKey: twKey, handle: bareHandle, sinceId, untilEpochSec });
  } catch (e) {
    const msg = e instanceof TwitterApiError ? e.message : `fetch failed: ${String(e)}`;
    logStructured(requestId, "twitter_fetch_error", { handle: bareHandle, error: msg });
    await supabase.rpc("record_poll_result", {
      p_journalist_id: body.journalist_id,
      p_newest_tweet_id: null,
      p_error: msg.slice(0, 500),
    });
    return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, msg, requestId, 502);
  }

  // --- 2) Filter: drop retweets and replies to other users ---
  const handleLc = bareHandle.toLowerCase();
  const kept = raw.filter((t) => {
    if (t.is_retweet) return false;
    if (t.is_reply && t.in_reply_to_user_handle &&
        t.in_reply_to_user_handle.toLowerCase() !== handleLc) return false;
    return true;
  });

  logStructured(requestId, "poll_tweets_filtered", {
    handle: bareHandle, fetched: raw.length, kept: kept.length,
  });

  // --- 3) POST each kept tweet to ingest-claim ---
  let newestId = sinceId; // monotonically advance to last successfully attempted
  let ingested = 0, ingestErrors = 0;
  const ingestUrl = `${supaUrl}/functions/v1/ingest-claim`;

  for (const t of kept) {
    const payload = {
      text: t.text,
      journalist_handle: `@${bareHandle}`,
      source_url: t.url,
      reported_at: t.created_at,
      source_platform: "x" as const,
    };
    try {
      const resp = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        ingestErrors++;
        logStructured(requestId, "ingest_call_failed", {
          tweet_id: t.id, status: resp.status,
        });
      } else {
        ingested++;
      }
    } catch (e) {
      ingestErrors++;
      logStructured(requestId, "ingest_call_threw", { tweet_id: t.id, error: String(e) });
    }
    // Advance cursor optimistically — even if ingest failed, we don't want to
    // re-attempt the same tweet forever. Failures are surfaced via the
    // ingest-claim function's own logs and the persisted error counters.
    newestId = t.id;
  }

  await supabase.rpc("record_poll_result", {
    p_journalist_id: body.journalist_id,
    p_newest_tweet_id: newestId,
    p_error: null,
  });

  logStructured(requestId, "poll_tweets_done", {
    handle: bareHandle, fetched: raw.length, kept: kept.length,
    ingested, ingest_errors: ingestErrors, newest_id: newestId,
  });

  return successResponse({
    journalist_id: body.journalist_id,
    handle: bareHandle,
    fetched: raw.length,
    kept: kept.length,
    ingested,
    ingest_errors: ingestErrors,
    newest_id: newestId,
  }, requestId);
});
