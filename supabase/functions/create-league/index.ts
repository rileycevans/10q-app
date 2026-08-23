/**
 * Create League Edge Function (Standalone)
 * Creates a new private league with the authenticated user as owner
 */

import { corsHeaders, corsHeadersFor } from "../_shared/cors.ts";
import { requireMinimumClient } from "../_shared/client-version.ts";

import { validateLeagueName } from "../_shared/league-names.ts";
import { createPlayerWithGeneratedHandle } from "../_shared/handles.ts";

// Inline Error Codes
const ErrorCodes = {
  ATTEMPT_ALREADY_COMPLETED: "ATTEMPT_ALREADY_COMPLETED",
  ATTEMPT_NOT_FOUND: "ATTEMPT_NOT_FOUND",
  ATTEMPT_ALREADY_EXISTS: "ATTEMPT_ALREADY_EXISTS",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  QUESTION_ALREADY_ANSWERED: "QUESTION_ALREADY_ANSWERED",
  QUESTION_EXPIRED: "QUESTION_EXPIRED",
  QUESTION_NOT_FOUND: "QUESTION_NOT_FOUND",
  QUIZ_NOT_AVAILABLE: "QUIZ_NOT_AVAILABLE",
  QUIZ_NOT_FOUND: "QUIZ_NOT_FOUND",
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  NOT_A_MEMBER: "NOT_A_MEMBER",
  LEAGUE_NOT_FOUND: "LEAGUE_NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NO_VIEWER_SCORE: "NO_VIEWER_SCORE",
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
  status: number = 400,
  details?: unknown
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        details,
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

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

// Main function
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(req) });
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

  // Version gate (discretionary write, retryable after updating).
  // Inert until MIN_CLIENT_* secrets are set — see VERSIONING.md §8.
  const outdated = requireMinimumClient(req, requestId);
  if (outdated) return outdated;
  logStructured(requestId, "create_league_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    const body = await req.json();
    const { name } = body;

    // League names are public to every member, which makes them user-generated
    // content under App Store Guideline 1.2 and Google Play's UGC policy.
    // Validation was length-only, so any slur passed through verbatim.
    // Enforced here rather than only in the browser: a direct call to this
    // endpoint would otherwise skip the check entirely.
    const nameValidation = validateLeagueName(name);
    if (!nameValidation.valid) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        nameValidation.error,
        requestId,
        400
      );
    }

    const supabase = await createServiceClient();

    // Ensure profile exists
    const { data: profile } = await supabase
      .from("players")
      .select("id")
      .eq("id", userId)
      .single();

    if (!profile) {
      // Create profile if it doesn't exist, with a generated handle.
      //
      // Not `Player${userId.slice(0, 8)}`: that published the first eight hex
      // characters of the auth UUID to every other league member.
      const created = await createPlayerWithGeneratedHandle(supabase, userId);

      if (!created.ok) {
        logStructured(requestId, "create_league_profile_error", {
          error: created.error,
        });
        return errorResponse(
          ErrorCodes.SERVICE_UNAVAILABLE,
          "Failed to create profile",
          requestId,
          500
        );
      }
    }

    // Create league with invite code
    const inviteCode = generateInviteCode();
    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .insert({
        name: name.trim(),
        owner_player_id: userId,
        invite_code: inviteCode,
      })
      .select("id, name, owner_player_id, created_at, invite_code")
      .single();

    if (leagueError) {
      logStructured(requestId, "create_league_error", {
        error: leagueError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to create league",
        requestId,
        500
      );
    }

    // Add creator as owner member
    const { error: memberError } = await supabase
      .from("league_members")
      .insert({
        league_id: league.id,
        player_id: userId,
        role: "owner",
      });

    if (memberError) {
      // Rollback league creation
      await supabase.from("leagues").delete().eq("id", league.id);
      logStructured(requestId, "create_league_member_error", {
        error: memberError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to add owner to league",
        requestId,
        500
      );
    }

    logStructured(requestId, "create_league_success", {
      league_id: league.id,
      name: league.name,
    });

    return successResponse(
      {
        league_id: league.id,
        name: league.name,
        owner_id: league.owner_player_id,
        created_at: league.created_at,
        invite_code: league.invite_code,
      },
      requestId
    );
  } catch (error: any) {
    logStructured(requestId, "create_league_error", {
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

