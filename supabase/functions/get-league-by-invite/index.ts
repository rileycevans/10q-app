/**
 * Get League By Invite Edge Function (Standalone)
 * Returns public league information by invite code (no auth required)
 */

// Inline CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inline Error Codes
const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

// Inline response helpers
function successResponse<T>(data: T, requestId: string): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      data,
      request_id: requestId,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
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
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
      },
      request_id: requestId,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
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
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Main function
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  logStructured(requestId, "get_league_by_invite_request", {});

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");

    if (!code) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "code parameter is required",
        requestId,
        400
      );
    }

    const supabase = await createServiceClient();

    // Get league by invite code
    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .select("id, name, created_by")
      .eq("invite_code", code)
      .single();

    if (leagueError || !league) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "League not found",
        requestId,
        404
      );
    }

    // Get creator handle
    const { data: creator, error: creatorError } = await supabase
      .from("players")
      .select("handle_display")
      .eq("id", league.created_by)
      .single();

    if (creatorError || !creator) {
      logStructured(requestId, "get_league_creator_error", {
        error: creatorError?.message,
      });
    }

    // Get member count
    const { count, error: countError } = await supabase
      .from("league_memberships")
      .select("*", { count: "exact", head: true })
      .eq("league_id", league.id);

    if (countError) {
      logStructured(requestId, "get_league_member_count_error", {
        error: countError.message,
      });
    }

    logStructured(requestId, "get_league_by_invite_success", {
      league_id: league.id,
      member_count: count ?? 0,
    });

    return successResponse(
      {
        league_id: league.id,
        name: league.name,
        creator_handle: creator?.handle_display ?? "Unknown",
        member_count: count ?? 0,
      },
      requestId
    );
  } catch (error: any) {
    logStructured(requestId, "get_league_by_invite_error", {
      error: error.message,
    });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});
