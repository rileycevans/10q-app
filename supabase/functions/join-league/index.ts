/**
 * Join League Edge Function (Standalone)
 * Allows an authenticated player to join a league via invite code
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ErrorCodes = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  LEAGUE_NOT_FOUND: "LEAGUE_NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

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

async function createServiceClient() {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.39.0");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getAuthenticatedUser(
  request: Request,
  requestId: string
): Promise<{ userId: string } | Response> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return errorResponse(ErrorCodes.NOT_AUTHORIZED, "Missing Authorization header", requestId, 401);
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.39.0");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return errorResponse(ErrorCodes.NOT_AUTHORIZED, "Invalid or expired token", requestId, 401);
  }

  return { userId: user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("VALIDATION_ERROR", "Method not allowed", generateRequestId(), 405);
  }

  const requestId = generateRequestId();
  logStructured(requestId, "join_league_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const body = await req.json();
    const { invite_code } = body;

    if (!invite_code || typeof invite_code !== "string" || invite_code.trim().length === 0) {
      return errorResponse(ErrorCodes.VALIDATION_ERROR, "Invite code is required", requestId, 400);
    }

    const code = invite_code.trim().toUpperCase();

    const supabase = await createServiceClient();

    // Look up league by invite code
    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .select("id, name")
      .eq("invite_code", code)
      .single();

    if (leagueError || !league) {
      return errorResponse(
        ErrorCodes.LEAGUE_NOT_FOUND,
        "No league found with that invite code",
        requestId,
        404
      );
    }

    // Check if already a member
    const { data: existingMember } = await supabase
      .from("league_members")
      .select("player_id")
      .eq("league_id", league.id)
      .eq("player_id", userId)
      .single();

    if (existingMember) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "You are already a member of this league",
        requestId,
        400
      );
    }

    // Add as member
    const { error: joinError } = await supabase
      .from("league_members")
      .insert({
        league_id: league.id,
        player_id: userId,
        role: "member",
      });

    if (joinError) {
      logStructured(requestId, "join_league_error", { error: joinError.message });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to join league",
        requestId,
        500
      );
    }

    logStructured(requestId, "join_league_success", {
      league_id: league.id,
      player_id: userId,
    });

    return successResponse(
      {
        league_id: league.id,
        name: league.name,
      },
      requestId
    );
  } catch (error: any) {
    logStructured(requestId, "join_league_error", { error: error.message });
    return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, "Internal server error", requestId, 500);
  }
});
