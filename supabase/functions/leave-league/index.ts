/**
 * Leave League Edge Function (Standalone)
 *
 * Lets a player remove themselves from a league.
 *
 * Blocking-fix B3. Until now the only durable user-to-user relationship in the
 * app was both non-consensual and non-exitable: an owner can add any player by
 * handle without their consent (add-league-member), and only the owner could
 * remove members. A stranger who read your handle off the public leaderboard
 * could pull you into a league with an arbitrary name, permanently.
 *
 * That is a real product defect and it is also the concrete form Apple
 * Guideline 1.2's "block abusive users" requirement takes here — being able to
 * leave is the mechanism by which a player escapes objectionable content.
 *
 * Owners leaving is handled the same way account deletion handles it: the
 * league passes to the longest-standing remaining member rather than being
 * destroyed under the people still in it. An owner who is the last member
 * takes the league with them.
 */

// Inline CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
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
  logStructured(requestId, "leave_league_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    const body = await req.json().catch(() => ({}));
    const { league_id } = body ?? {};

    if (!league_id || typeof league_id !== "string") {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "league_id is required",
        requestId,
        400
      );
    }

    const supabase = await createServiceClient();

    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .select("id, owner_player_id")
      .eq("id", league_id)
      .maybeSingle();

    if (leagueError) {
      logStructured(requestId, "leave_league_lookup_error", {
        error: leagueError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to load league",
        requestId,
        500
      );
    }

    if (!league) {
      return errorResponse(
        ErrorCodes.LEAGUE_NOT_FOUND,
        "League not found",
        requestId,
        404
      );
    }

    const { data: membership, error: membershipError } = await supabase
      .from("league_members")
      .select("player_id, role")
      .eq("league_id", league_id)
      .eq("player_id", userId)
      .maybeSingle();

    if (membershipError) {
      logStructured(requestId, "leave_league_membership_error", {
        error: membershipError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to load membership",
        requestId,
        500
      );
    }

    if (!membership) {
      return errorResponse(
        ErrorCodes.NOT_A_MEMBER,
        "You are not a member of this league",
        requestId,
        404
      );
    }

    const isOwner = league.owner_player_id === userId;
    let transferredTo: string | null = null;
    let leagueDeleted = false;

    if (isOwner) {
      // Longest-standing remaining member inherits, matching delete-account.
      const { data: successors, error: successorError } = await supabase
        .from("league_members")
        .select("player_id, created_at")
        .eq("league_id", league_id)
        .neq("player_id", userId)
        .order("created_at", { ascending: true })
        .limit(1);

      if (successorError) {
        logStructured(requestId, "leave_league_successor_error", {
          error: successorError.message,
        });
        return errorResponse(
          ErrorCodes.SERVICE_UNAVAILABLE,
          "Failed to find a successor",
          requestId,
          500
        );
      }

      if (!successors || successors.length === 0) {
        // Last member out deletes the league. league_members cascades.
        const { error: deleteError } = await supabase
          .from("leagues")
          .delete()
          .eq("id", league_id);

        if (deleteError) {
          logStructured(requestId, "leave_league_delete_error", {
            error: deleteError.message,
          });
          return errorResponse(
            ErrorCodes.SERVICE_UNAVAILABLE,
            "Failed to leave league",
            requestId,
            500
          );
        }

        logStructured(requestId, "leave_league_deleted_empty", { league_id });

        return successResponse(
          { left: true, league_deleted: true, transferred_to: null },
          requestId
        );
      }

      const successorId = successors[0].player_id as string;

      const { error: transferError } = await supabase
        .from("leagues")
        .update({ owner_player_id: successorId })
        .eq("id", league_id);

      if (transferError) {
        logStructured(requestId, "leave_league_transfer_error", {
          error: transferError.message,
        });
        return errorResponse(
          ErrorCodes.SERVICE_UNAVAILABLE,
          "Failed to transfer league ownership",
          requestId,
          500
        );
      }

      const { error: roleError } = await supabase
        .from("league_members")
        .update({ role: "owner" })
        .eq("league_id", league_id)
        .eq("player_id", successorId);

      if (roleError) {
        logStructured(requestId, "leave_league_role_error", {
          error: roleError.message,
        });
        return errorResponse(
          ErrorCodes.SERVICE_UNAVAILABLE,
          "Failed to promote the new owner",
          requestId,
          500
        );
      }

      transferredTo = successorId;
    }

    const { error: removeError } = await supabase
      .from("league_members")
      .delete()
      .eq("league_id", league_id)
      .eq("player_id", userId);

    if (removeError) {
      logStructured(requestId, "leave_league_remove_error", {
        error: removeError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to leave league",
        requestId,
        500
      );
    }

    logStructured(requestId, "leave_league_success", {
      league_id,
      was_owner: isOwner,
      transferred_to: transferredTo,
    });

    return successResponse(
      { left: true, league_deleted: leagueDeleted, transferred_to: transferredTo },
      requestId
    );
    // deno-lint-ignore no-explicit-any
  } catch (error: any) {
    logStructured(requestId, "leave_league_error", {
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
