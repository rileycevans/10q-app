/**
 * Register or refresh a push token for the signed-in player.
 *
 * Called after the OS grants notification permission, and again whenever the
 * provider rotates the token — which it does without warning, so this has to
 * be idempotent and cheap enough to call on every launch.
 */

import { corsHeadersFor } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";

const VALID_PLATFORMS = new Set(["ios", "android", "web"]);

/** APNs tokens are 64 hex chars; FCM tokens are long and opaque. */
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 4096;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(req) });
  }

  const requestId = generateRequestId();

  if (req.method !== "POST") {
    return errorResponse(
      ErrorCodes.VALIDATION_ERROR,
      "Method not allowed",
      requestId,
      405,
      undefined,
      req,
    );
  }

  // Deliberately NOT version-gated. A client too old to play should still be
  // able to unregister its token, and gating registration would leave dead
  // tokens receiving notifications for an app that cannot open them.

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const body = await req.json().catch(() => null);
    if (!body) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Request body must be JSON",
        requestId,
        400,
        undefined,
        req,
      );
    }

    const { token, platform, app_version: appVersion, unregister } = body;

    if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "A valid push token is required",
        requestId,
        400,
        undefined,
        req,
      );
    }

    const supabase = createServiceClient();

    // Unregister: sign-out, or the player turning notifications off. Mark
    // rather than delete so a provider failure for a token we already
    // revoked is explainable later.
    if (unregister === true) {
      const { error } = await supabase
        .from("device_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("token", token)
        .eq("player_id", userId);

      if (error) {
        logStructured(requestId, "register_device_token_revoke_error", {
          error: error.message,
        });
        return errorResponse(
          ErrorCodes.SERVICE_UNAVAILABLE,
          "Failed to unregister token",
          requestId,
          500,
          undefined,
          req,
        );
      }

      logStructured(requestId, "device_token_revoked", { player_id: userId });
      return successResponse({ registered: false }, requestId);
    }

    if (typeof platform !== "string" || !VALID_PLATFORMS.has(platform)) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "platform must be ios, android or web",
        requestId,
        400,
        undefined,
        req,
      );
    }

    // Upsert on the token, not on (player, platform).
    //
    // A device has one token, and that token may move between accounts —
    // someone signs out and a friend signs in on the same phone. Keying on
    // the token means the row follows the device and re-points at whoever
    // currently holds it, instead of two players both believing they own it
    // and both receiving each other's notifications.
    const { error } = await supabase
      .from("device_tokens")
      .upsert(
        {
          token,
          player_id: userId,
          platform,
          app_version: typeof appVersion === "string" ? appVersion : null,
          last_seen_at: new Date().toISOString(),
          // Clear any earlier revocation: this token is live again.
          revoked_at: null,
        },
        { onConflict: "token" },
      );

    if (error) {
      logStructured(requestId, "register_device_token_error", {
        error: error.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to register token",
        requestId,
        500,
        undefined,
        req,
      );
    }

    // Give the player a preferences row on first registration, so the
    // settings screen has something to read and the sender has explicit
    // values rather than inferring defaults.
    await supabase
      .from("notification_preferences")
      .upsert({ player_id: userId }, { onConflict: "player_id", ignoreDuplicates: true });

    logStructured(requestId, "device_token_registered", {
      player_id: userId,
      platform,
    });

    return successResponse({ registered: true }, requestId);
  } catch (error) {
    logStructured(requestId, "register_device_token_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500,
      undefined,
      req,
    );
  }
});
