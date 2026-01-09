/**
 * Get League Details Edge Function (Standalone)
 * Returns league info and member list for a specific league
 */

// Inline CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inline Error Codes
const ErrorCodes = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  NOT_A_MEMBER: "NOT_A_MEMBER",
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

  const requestId = generateRequestId();
  logStructured(requestId, "get_league_details_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    const url = new URL(req.url);
    const leagueId = url.searchParams.get("league_id");

    if (!leagueId) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "league_id parameter is required",
        requestId,
        400
      );
    }

    const supabase = await createServiceClient();

    // Verify user is a member
    const { data: membership, error: membershipError } = await supabase
      .from("league_members")
      .select("role")
      .eq("league_id", leagueId)
      .eq("player_id", userId)
      .single();

    if (membershipError || !membership) {
      return errorResponse(
        ErrorCodes.NOT_A_MEMBER,
        "You are not a member of this league",
        requestId,
        403
      );
    }

    // Get league info
    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .select("id, name, owner_id, created_at")
      .eq("id", leagueId)
      .single();

    if (leagueError || !league) {
      return errorResponse(
        ErrorCodes.LEAGUE_NOT_FOUND,
        "League not found",
        requestId,
        404
      );
    }

    // Get all members
    const { data: members, error: membersError } = await supabase
      .from("league_members")
      .select(`
        player_id,
        role,
        created_at,
        profiles!inner (
          handle_display
        )
      `)
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true });

    if (membersError) {
      logStructured(requestId, "get_league_details_members_error", {
        error: membersError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to fetch members",
        requestId,
        500
      );
    }

    const memberList = (members || []).map((m: any) => ({
      player_id: m.player_id,
      handle_display: m.profiles?.handle_display || "Unknown",
      role: m.role,
      created_at: m.created_at,
    }));

    logStructured(requestId, "get_league_details_success", {
      league_id: leagueId,
      member_count: memberList.length,
    });

    return successResponse(
      {
        league_id: league.id,
        name: league.name,
        owner_id: league.owner_id,
        created_at: league.created_at,
        is_owner: membership.role === "owner",
        members: memberList,
      },
      requestId
    );
  } catch (error: any) {
    logStructured(requestId, "get_league_details_error", {
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

