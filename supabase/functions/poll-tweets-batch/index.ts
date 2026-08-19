/**
 * Poll Tweets Batch — scheduler entrypoint, fired by pg_cron every 5 min.
 *
 * Picks the N most-stale active journalists via claim_journalists_to_poll
 * (atomic, SKIP LOCKED), fans them out to the poll-tweets worker in parallel,
 * returns a summary.
 *
 * Math: 191 journalists, batch=32 every 5 min => ~30 min full cycle.
 *
 * POST body (all optional):
 *   { "batch_size"?: 32 }
 */

import { corsHeaders } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";
import { requireServiceRole } from "../_shared/auth.ts";

import { sleep } from "../_shared/twitter.ts";

interface BatchBody { batch_size?: number; }

// TwitterAPI.io free tier: 1 req / 5 sec. We poll handles SEQUENTIALLY with
// a 5.5s gap. A 5-min cron tick gives ~54 slots; we pick 50 to leave headroom
// for slow tweets. 191 handles / 50 per tick = ~4 ticks = ~20 min full cycle,
// well under the 30-min target.
const DEFAULT_BATCH_SIZE = 50;
const SEQUENTIAL_GAP_MS = 5500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const requestId = generateRequestId();
  if (req.method !== "POST")
    return errorResponse(ErrorCodes.VALIDATION_ERROR, "Method not allowed", requestId, 405);

  // Machine-to-machine only: fired by pg_cron via run_transfer_poll_batch(),
  // which reads the service role key from Vault and sends it as a bearer token.
  // Before this check an empty anonymous POST returned 200 and kicked off a
  // full fan-out across every active journalist.
  const unauthorized = requireServiceRole(req, requestId);
  if (unauthorized) return unauthorized;

  let body: BatchBody = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const batchSize = Math.max(1, Math.min(64, body.batch_size ?? DEFAULT_BATCH_SIZE));

  const supabase = createServiceClient();
  const supaUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // 1) Claim the next batch atomically. Sets last_polled_at=now() to prevent
  //    a second tick from picking the same handles.
  const { data: claimed, error: claimErr } = await supabase
    .rpc("claim_journalists_to_poll", { p_limit: batchSize });
  if (claimErr) {
    return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, `claim failed: ${claimErr.message}`, requestId, 502);
  }
  const handles = (claimed ?? []) as Array<{ id: string; x_handle: string; last_seen_tweet_id: string | null }>;

  logStructured(requestId, "batch_claimed", { count: handles.length, batch_size: batchSize });

  if (handles.length === 0) {
    return successResponse({ claimed: 0, results: [] }, requestId);
  }

  // 2) Fan out to poll-tweets in parallel.
  // Sequential dispatch with rate-limit gap between handles. We DON'T await
  // the gap after the very last handle.
  const pollUrl = `${supaUrl}/functions/v1/poll-tweets`;
  const results: unknown[] = [];
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    try {
      const resp = await fetch(pollUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          journalist_id: h.id,
          x_handle: h.x_handle,
          since_id: h.last_seen_tweet_id,
        }),
      });
      const json = await resp.json().catch(() => null);
      results.push({ id: h.id, handle: h.x_handle, ok: resp.ok, status: resp.status, summary: (json as { data?: unknown })?.data ?? null, error: !resp.ok ? (json as { error?: unknown })?.error : null });
    } catch (e) {
      results.push({ id: h.id, handle: h.x_handle, ok: false, error: String(e) });
    }
    if (i < handles.length - 1) await sleep(SEQUENTIAL_GAP_MS);
  }

  const okCount = results.filter((r) => (r as { ok?: boolean }).ok).length;
  logStructured(requestId, "batch_done", { claimed: handles.length, ok: okCount, failed: handles.length - okCount });

  return successResponse({ claimed: handles.length, ok: okCount, results }, requestId);
});
