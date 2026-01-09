/**
 * Remove League Member Edge Function (Standalone)
 * Removes a member from a league (owner only, cannot remove owner)
 */

// Inline CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inline Error Codes
const ErrorCodes = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  LEAGUE_NOT_FOUND: "LEAGUE_NOT_FOUND",
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
    global: {
      headers: { Authorization: authHeader },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

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

// Main function
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
  logStructured(requestId, "remove_league_member_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    const body = await req.json();
    const { league_id, player_id } = body;

    if (!league_id) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "league_id is required",
        requestId,
        400
      );
    }

    if (!player_id) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "player_id is required",
        requestId,
        400
      );
    }

    const supabase = await createServiceClient();

    // Verify user is owner
    const { data: membership, error: membershipError } = await supabase
      .from("league_members")
      .select("role")
      .eq("league_id", league_id)
      .eq("player_id", userId)
      .single();

    if (membershipError || !membership || membership.role !== "owner") {
      return errorResponse(
        ErrorCodes.NOT_AUTHORIZED,
        "Only league owners can remove members",
        requestId,
        403
      );
    }

    // Verify league exists
    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .select("id")
      .eq("id", league_id)
      .single();

    if (leagueError || !league) {
      return errorResponse(
        ErrorCodes.LEAGUE_NOT_FOUND,
        "League not found",
        requestId,
        404
      );
    }

    // Check if trying to remove owner
    const { data: targetMember, error: targetError } = await supabase
      .from("league_members")
      .select("role")
      .eq("league_id", league_id)
      .eq("player_id", player_id)
      .single();

    if (targetError || !targetMember) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Player is not a member of this league",
        requestId,
        404
      );
    }

    if (targetMember.role === "owner") {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Cannot remove the league owner",
        requestId,
        400
      );
    }

    // Remove member
    const { error: removeError } = await supabase
      .from("league_members")
      .delete()
      .eq("league_id", league_id)
      .eq("player_id", player_id);

    if (removeError) {
      logStructured(requestId, "remove_league_member_error", {
        error: removeError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to remove member",
        requestId,
        500
      );
    }

    logStructured(requestId, "remove_league_member_success", {
      league_id,
      player_id,
    });

    return successResponse(
      {
        success: true,
      },
      requestId
    );
  } catch (error: any) {
    logStructured(requestId, "remove_league_member_error", {
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

