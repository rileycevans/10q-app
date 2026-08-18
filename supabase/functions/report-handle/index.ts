/**
 * Report Handle Edge Function (Standalone)
 *
 * Lets a signed-in player report another player's handle as objectionable.
 * Handles are public on leaderboards and in leagues, so they are user-generated
 * content under App Store Guideline 1.2 and Google Play's UGC policy; both
 * expect a reporting path in addition to the up-front blocklist.
 *
 * Reports are written with the service role and the reporter is taken from the
 * verified JWT, never from the request body, so a caller cannot forge a report
 * as somebody else. handle_reports has no player-facing INSERT policy for the
 * same reason.
 */

// Inline CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inline Error Codes
const ErrorCodes = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  ALREADY_REPORTED: "ALREADY_REPORTED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

const VALID_REASONS = ["offensive", "impersonation", "spam", "other"];
const MAX_DETAILS_LENGTH = 500;

// Inline response helpers
function successResponse<T>(data: T, requestId: string): Response {
  return new Response(
    JSON.stringify({ ok: true, data, request_id: requestId }),
    {
      headers: { "Content-Type": "application/json", ...corsHeaders },
      status: 200,
    }
  );
}

function errorResponse(
  code: string,
  message: string,
  requestId: string,
  status: number = 400
): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message }, request_id: requestId }),
    {
      headers: { "Content-Type": "application/json", ...corsHeaders },
      status,
    }
  );
}

// Inline utils
function generateRequestId(): string {
  return crypto.randomUUID();
}

function logStructured(
  requestId: string,
  eventType: string,
  data: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      request_id: requestId,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      ...data,
    })
  );
}

// Inline Supabase client
async function createServiceClient() {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.39.0");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Inline auth helper
async function getAuthenticatedUser(
  request: Request,
  requestId: string
): Promise<{ userId: string } | Response> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      "Missing Authorization header",
      requestId,
      401
    );
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.39.0");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      "Invalid or expired token",
      requestId,
      401
    );
  }

  return { userId: user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse(
      ErrorCodes.VALIDATION_ERROR,
      "Method not allowed",
      generateRequestId(),
      405
    );
  }

  const requestId = generateRequestId();
  logStructured(requestId, "report_handle_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    const body = await req.json().catch(() => ({}));
    const { handle, reason, details } = body ?? {};

    if (!handle || typeof handle !== "string") {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "handle is required",
        requestId,
        400
      );
    }

    if (!reason || !VALID_REASONS.includes(reason)) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `reason must be one of: ${VALID_REASONS.join(", ")}`,
        requestId,
        400
      );
    }

    if (details != null && typeof details !== "string") {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "details must be a string",
        requestId,
        400
      );
    }

    // Truncate rather than reject: the reporter shouldn't lose their report
    // over a length technicality, and the column caps at 500 anyway.
    const trimmedDetails =
      typeof details === "string" && details.trim().length > 0
        ? details.trim().slice(0, MAX_DETAILS_LENGTH)
        : null;

    const supabase = await createServiceClient();

    // Resolve the handle to a player. Canonical (lowercased) comparison so a
    // report works regardless of how the reporter typed the handle.
    const { data: reported, error: lookupError } = await supabase
      .from("players")
      .select("id, handle_display")
      .eq("handle_canonical", handle.trim().toLowerCase())
      .maybeSingle();

    if (lookupError) {
      logStructured(requestId, "report_handle_lookup_error", {
        error: lookupError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to look up handle",
        requestId,
        500
      );
    }

    if (!reported) {
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "No player with that handle",
        requestId,
        404
      );
    }

    if (reported.id === userId) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "You cannot report your own handle",
        requestId,
        400
      );
    }

    // reporter_player_id comes from the verified token, never the body.
    const { error: insertError } = await supabase
      .from("handle_reports")
      .insert({
        reported_player_id: reported.id,
        reported_handle: reported.handle_display,
        reporter_player_id: userId,
        reason,
        details: trimmedDetails,
      });

    if (insertError) {
      // 23505 = unique_violation: this reporter already reported this player.
      // Report it as success so the response can't be used to probe who has
      // already been reported, and because from the reporter's point of view
      // the outcome is the same.
      if (insertError.code === "23505") {
        logStructured(requestId, "report_handle_duplicate", {
          reported_player_id: reported.id,
        });
        return successResponse({ success: true, duplicate: true }, requestId);
      }

      logStructured(requestId, "report_handle_insert_error", {
        error: insertError.message,
        code: insertError.code,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to submit report",
        requestId,
        500
      );
    }

    logStructured(requestId, "report_handle_success", {
      reported_player_id: reported.id,
      reason,
    });

    return successResponse({ success: true, duplicate: false }, requestId);
    // deno-lint-ignore no-explicit-any
  } catch (error: any) {
    logStructured(requestId, "report_handle_error", {
      error: error?.message ?? String(error),
    });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});
