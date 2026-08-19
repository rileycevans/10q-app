/**
 * Ingest Claim Edge Function
 *
 * Full pipeline for ONE raw post: extract structured claims via OpenAI, then
 * persist each via the transfers.record_claim RPC (resolves clubs/player/
 * journalist, upserts the canonical claim, inserts a deduped report).
 *
 * POST body:
 *   {
 *     "text": "raw post text",            // required
 *     "journalist_handle"?: "@Handle",
 *     "outlet"?: "The Athletic",
 *     "source_url"?: "https://x.com/...",  // dedup key for reports
 *     "source_platform"?: "x"|"article"|"video"|"podcast"|"other",
 *     "reported_at"?: "ISO timestamp",     // defaults to now()
 *     "model"?: "gpt-4o-mini"
 *   }
 *
 * Requires secrets: OPENAI_API_KEY (+ standard SUPABASE_* for the service client)
 */

import { corsHeaders, corsHeadersFor } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { extractClaims, ExtractionError } from "../_shared/extract.ts";
import { EXTRACTION_MODEL } from "../_shared/extraction-prompt.ts";

interface IngestBody {
  text?: string;
  journalist_handle?: string;
  outlet?: string;
  source_url?: string;
  source_platform?: string;
  reported_at?: string;
  model?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(req) });
  }

  const requestId = generateRequestId();

  if (req.method !== "POST") {
    return errorResponse(ErrorCodes.VALIDATION_ERROR, "Method not allowed", requestId, 405);
  }

  // Machine-to-machine only: the sole caller is poll-tweets, which already
  // sends the service role key. Checked before the OpenAI key is read or the
  // body is parsed, so an unauthorized caller cannot cost us an API call.
  const unauthorized = requireServiceRole(req, requestId);
  if (unauthorized) return unauthorized;

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, "OPENAI_API_KEY is not configured", requestId, 503);
  }

  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid JSON body", requestId, 400);
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return errorResponse(ErrorCodes.VALIDATION_ERROR, "`text` is required", requestId, 400);
  }

  const model = body.model || EXTRACTION_MODEL;
  const reportedAt = body.reported_at || new Date().toISOString();

  logStructured(requestId, "ingest_claim_request", {
    model,
    text_length: text.length,
    journalist_handle: body.journalist_handle ?? null,
    has_url: Boolean(body.source_url),
  });

  // --- 1. Extract ---
  let extraction;
  try {
    extraction = await extractClaims(apiKey, text, body.journalist_handle, model);
  } catch (e) {
    if (e instanceof ExtractionError) {
      return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, e.message, requestId, e.status === 502 ? 502 : 503);
    }
    return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, `Extraction failed: ${String(e)}`, requestId, 502);
  }

  // --- 2. Persist each claim ---
  const supabase = createServiceClient();
  const persisted: unknown[] = [];
  const errors: unknown[] = [];

  for (const c of extraction.claims) {
    const { data, error } = await supabase.rpc("record_transfer_claim", {
      p_player: c.player,
      p_destination_club: c.destination_club,
      p_source_club: c.source_club,
      p_stage: c.stage,
      p_transfer_type: c.transfer_type,
      p_confidence: c.confidence,
      p_contradicts: c.contradicts,
      p_journalist_handle: body.journalist_handle ?? null,
      p_outlet: body.outlet ?? null,
      p_source_url: body.source_url ?? null,
      p_source_platform: body.source_platform ?? "x",
      p_raw_text: text,
      p_reported_at: reportedAt,
    });

    if (error) {
      logStructured(requestId, "record_claim_error", { claim: c, error: error.message });
      errors.push({ claim: c, error: error.message });
    } else {
      persisted.push({ ...(data as Record<string, unknown>), extracted: c });
    }
  }

  logStructured(requestId, "ingest_claim_done", {
    extracted: extraction.claims.length,
    persisted: persisted.length,
    errors: errors.length,
  });

  return successResponse(
    {
      extracted_count: extraction.claims.length,
      persisted_count: persisted.length,
      persisted,
      errors,
      warnings: extraction.warnings,
      model,
      usage: extraction.usage,
    },
    requestId,
  );
});
