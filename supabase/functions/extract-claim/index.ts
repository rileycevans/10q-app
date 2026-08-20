/**
 * Extract Claim (test harness) Edge Function
 *
 * Takes a single raw tweet/post and returns structured transfer claims via
 * OpenAI. This is a PURE extraction endpoint — it does NOT write to the
 * database. Its job is to let us validate extraction quality in isolation
 * before wiring up ingestion + persistence (roadmap steps 4/6/7).
 *
 * POST body:
 *   { "text": "raw post text", "journalist_handle"?: "@FabrizioRomano", "model"?: "gpt-4o-mini" }
 *
 * Response data:
 *   { "claims": [...], "model": "...", "usage": {...} }
 *
 * Requires secret: OPENAI_API_KEY
 */

import { corsHeaders, corsHeadersFor } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import {
  buildMessages,
  EXTRACTION_MODEL,
  STAGES,
  TRANSFER_TYPES,
} from "../_shared/extraction-prompt.ts";

interface ExtractBody {
  text?: string;
  journalist_handle?: string;
  model?: string;
}

interface ExtractedClaim {
  player: string;
  destination_club: string;
  source_club: string | null;
  stage: string;
  transfer_type: string | null;
  confidence: number;
  contradicts: boolean;
  fee_text: string | null;
  reasoning: string;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const STAGE_SET = new Set<string>(STAGES);
const TYPE_SET = new Set<string>(TRANSFER_TYPES);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(req) });
  }

  const requestId = generateRequestId();

  if (req.method !== "POST") {
    return errorResponse(ErrorCodes.VALIDATION_ERROR, "Method not allowed", requestId, 405);
  }

  // Operator-only test harness. It writes nothing, but it does spend real
  // OpenAI credit per call, so leaving it open is a billing DoS. Same gate as
  // the pipeline it exercises.
  const unauthorized = requireServiceRole(req, requestId);
  if (unauthorized) return unauthorized;

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "OPENAI_API_KEY is not configured",
      requestId,
      503,
    );
  }

  let body: ExtractBody;
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
  logStructured(requestId, "extract_claim_request", {
    model,
    text_length: text.length,
    journalist_handle: body.journalist_handle ?? null,
  });

  // --- Call OpenAI ---
  let openaiJson: Record<string, unknown>;
  try {
    const resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: buildMessages(text, body.journalist_handle),
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      logStructured(requestId, "openai_error", { status: resp.status, body: errText });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        `OpenAI API error (${resp.status}): ${errText.slice(0, 200)}`,
        requestId,
        502,
      );
    }
    openaiJson = await resp.json();
  } catch (e) {
    logStructured(requestId, "openai_fetch_failed", { error: String(e) });
    return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, "Failed to reach OpenAI API", requestId, 502);
  }

  // --- Parse the model's text output as JSON ---
  const choices = (openaiJson.choices as Array<{ message?: { content?: string } }>) ?? [];
  const rawOutput = choices[0]?.message?.content ?? "";

  let parsed: { claims?: unknown };
  try {
    parsed = JSON.parse(stripFences(rawOutput));
  } catch {
    logStructured(requestId, "model_output_unparseable", { raw_output: rawOutput });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Model returned non-JSON output",
      requestId,
      502,
    );
  }

  const { claims, warnings } = sanitizeClaims(parsed.claims);

  logStructured(requestId, "extract_claim_done", {
    model,
    claim_count: claims.length,
    warning_count: warnings.length,
  });

  return successResponse(
    {
      claims,
      warnings,
      model,
      usage: openaiJson.usage ?? null,
    },
    requestId,
  );
});

/** Strip ```json fences if the model wrapped its output despite instructions. */
function stripFences(s: string): string {
  const trimmed = s.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1].trim() : trimmed;
}

/**
 * Validates each claim against the schema's allowed values. Invalid claims are
 * dropped (not silently coerced) and reported in `warnings` so we can see when
 * the model drifts off-taxonomy during testing.
 */
function sanitizeClaims(raw: unknown): { claims: ExtractedClaim[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!Array.isArray(raw)) {
    if (raw !== undefined) warnings.push("`claims` was not an array; treated as empty.");
    return { claims: [], warnings };
  }

  const claims: ExtractedClaim[] = [];
  raw.forEach((item, i) => {
    if (typeof item !== "object" || item === null) {
      warnings.push(`claim[${i}] was not an object; dropped.`);
      return;
    }
    const c = item as Record<string, unknown>;
    const player = typeof c.player === "string" ? c.player.trim() : "";
    const destination = typeof c.destination_club === "string" ? c.destination_club.trim() : "";

    if (!player || !destination) {
      warnings.push(`claim[${i}] missing player or destination_club; dropped.`);
      return;
    }
    if (typeof c.stage !== "string" || !STAGE_SET.has(c.stage)) {
      warnings.push(`claim[${i}] had invalid stage "${String(c.stage)}"; dropped.`);
      return;
    }

    let transferType: string | null = null;
    if (typeof c.transfer_type === "string" && TYPE_SET.has(c.transfer_type)) {
      transferType = c.transfer_type;
    } else if (c.transfer_type != null && c.transfer_type !== "") {
      warnings.push(`claim[${i}] had invalid transfer_type "${String(c.transfer_type)}"; set to null.`);
    }

    let confidence = typeof c.confidence === "number" ? Math.round(c.confidence) : 50;
    confidence = Math.max(0, Math.min(100, confidence));

    claims.push({
      player,
      destination_club: destination,
      source_club: typeof c.source_club === "string" && c.source_club.trim() ? c.source_club.trim() : null,
      stage: c.stage,
      transfer_type: transferType,
      confidence,
      contradicts: c.contradicts === true,
      fee_text: typeof c.fee_text === "string" && c.fee_text.trim() ? c.fee_text.trim() : null,
      reasoning: typeof c.reasoning === "string" ? c.reasoning.trim() : "",
    });
  });

  return { claims, warnings };
}
