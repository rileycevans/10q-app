/**
 * Delete Account Edge Function (Standalone)
 *
 * Permanently deletes the authenticated user's account and all personal data.
 * Required by App Store Guideline 5.1.1(v) and Google Play's account deletion
 * policy: any app offering account creation must offer in-app deletion.
 *
 * Deleting the auth.users row cascades through the schema:
 *   auth.users -> players -> attempts -> attempt_answers
 *                         -> daily_scores
 *                         -> league_members
 *                         -> leagues (owned)
 * and nulls outbox_events.actor_user_id, preserving event history without the
 * personal link (see 20260818000000_account_deletion_fk_fixes.sql).
 *
 * The one case the cascade gets wrong is league ownership. leagues cascades
 * from owner_player_id, so a departing owner would destroy leagues that other
 * players are still in. Before deleting we hand each such league to its
 * longest-standing remaining member. Only leagues where the owner is the last
 * member are allowed to cascade away.
 */

import { corsHeaders, corsHeadersFor } from "../_shared/cors.ts";

// Inline Error Codes
const ErrorCodes = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
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

/**
 * Hand off leagues the departing user owns that still have other members.
 *
 * Returns the number of leagues transferred. Leagues where the owner is the
 * only member are left alone: the FK cascade removes them with the account.
 */
async function transferOwnedLeagues(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  requestId: string
): Promise<number> {
  const { data: ownedLeagues, error: leaguesError } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("owner_player_id", userId);

  if (leaguesError) {
    throw new Error(`Failed to load owned leagues: ${leaguesError.message}`);
  }

  if (!ownedLeagues || ownedLeagues.length === 0) {
    return 0;
  }

  let transferred = 0;

  for (const league of ownedLeagues) {
    // Longest-standing remaining member inherits the league.
    const { data: successors, error: membersError } = await supabase
      .from("league_members")
      .select("player_id, created_at")
      .eq("league_id", league.id)
      .neq("player_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);

    if (membersError) {
      throw new Error(
        `Failed to load members for league ${league.id}: ${membersError.message}`
      );
    }

    // Sole member: let the cascade delete the league with the account.
    if (!successors || successors.length === 0) {
      logStructured(requestId, "delete_account_league_cascade", {
        league_id: league.id,
      });
      continue;
    }

    const successorId = successors[0].player_id;

    const { error: transferError } = await supabase
      .from("leagues")
      .update({ owner_player_id: successorId })
      .eq("id", league.id);

    if (transferError) {
      throw new Error(
        `Failed to transfer league ${league.id}: ${transferError.message}`
      );
    }

    // Promote the successor's membership row to match their new ownership.
    const { error: roleError } = await supabase
      .from("league_members")
      .update({ role: "owner" })
      .eq("league_id", league.id)
      .eq("player_id", successorId);

    if (roleError) {
      throw new Error(
        `Failed to promote successor in league ${league.id}: ${roleError.message}`
      );
    }

    transferred += 1;

    logStructured(requestId, "delete_account_league_transferred", {
      league_id: league.id,
      successor_player_id: successorId,
    });
  }

  return transferred;
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
  logStructured(requestId, "delete_account_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    // Require an explicit confirmation flag so a stray POST can't wipe an
    // account. The UI sends this only after the user types DELETE.
    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== true) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Account deletion requires confirm: true",
        requestId,
        400
      );
    }

    const supabase = await createServiceClient();

    // Hand off multi-member leagues before the cascade can destroy them.
    const transferredLeagues = await transferOwnedLeagues(
      supabase,
      userId,
      requestId
    );

    // Deleting the auth user cascades to all personal data.
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);

    if (deleteError) {
      logStructured(requestId, "delete_account_error", {
        error: deleteError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to delete account",
        requestId,
        500
      );
    }

    logStructured(requestId, "delete_account_success", {
      transferred_leagues: transferredLeagues,
    });

    return successResponse(
      {
        success: true,
        transferred_leagues: transferredLeagues,
      },
      requestId
    );
    // deno-lint-ignore no-explicit-any
  } catch (error: any) {
    logStructured(requestId, "delete_account_error", {
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
