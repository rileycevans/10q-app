/**
 * Get My Leagues Edge Function (Standalone)
 * Returns all leagues the authenticated user is a member of
 */

// Inline CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inline Error Codes
const ErrorCodes = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
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
  logStructured(requestId, "get_my_leagues_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    const supabase = await createServiceClient();

    // Get all leagues user is a member of
    const { data: memberships, error: membersError } = await supabase
      .from("league_members")
      .select(`
        league_id,
        role,
        leagues!inner (
          id,
          name,
          owner_id,
          created_at
        )
      `)
      .eq("player_id", userId);

    if (membersError) {
      logStructured(requestId, "get_my_leagues_error", {
        error: membersError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to fetch leagues",
        requestId,
        500
      );
    }

    // Get member counts for each league
    const leagueIds = (memberships || []).map((m: any) => m.league_id);
    const memberCounts: Record<string, number> = {};

    if (leagueIds.length > 0) {
      const { data: counts } = await supabase
        .from("league_members")
        .select("league_id")
        .in("league_id", leagueIds);

      if (counts) {
        for (const count of counts) {
          memberCounts[count.league_id] = (memberCounts[count.league_id] || 0) + 1;
        }
      }
    }

    const leagues = (memberships || []).map((m: any) => {
      const league = m.leagues;
      return {
        league_id: league.id,
        name: league.name,
        owner_id: league.owner_id,
        created_at: league.created_at,
        role: m.role,
        member_count: memberCounts[league.id] || 0,
        is_owner: m.role === "owner",
      };
    });

    logStructured(requestId, "get_my_leagues_success", {
      league_count: leagues.length,
    });

    return successResponse(
      {
        leagues,
      },
      requestId
    );
  } catch (error: any) {
    logStructured(requestId, "get_my_leagues_error", {
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

