/**
 * Notification dispatcher.
 *
 * Invoked by pg_cron (daily drop, streak-at-risk) or by hand. Reads the
 * players who should receive a given notification type, respects their
 * preferences, sends to every live token, and records the outcome.
 *
 * Deliberately service-role only: it is triggered by the database, never by
 * a client.
 */

import { corsHeadersFor } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";
import { sendApns, type PushPayload } from "../_shared/push-apns.ts";
import { sendFcm, parseServiceAccount } from "../_shared/push-fcm.ts";

const BUNDLE_ID = "com.play10q.app";

/** Which preference column gates each type. */
const PREFERENCE_COLUMN: Record<string, string> = {
  daily_drop: "daily_drop",
  streak_at_risk: "streak_at_risk",
  league_activity: "league_activity",
};

interface DeviceRow {
  id: string;
  token: string;
  platform: string;
  player_id: string;
  app_version: string | null;
}

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

  // Service-role only. The gateway passes the Authorization header through,
  // and this compares it to the service key rather than validating a user
  // token: there is no user here, only the database calling in.
  const auth = req.headers.get("authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const legacyKey = Deno.env.get("LEGACY_SERVICE_ROLE_JWT") ?? "";
  const presented = auth.replace(/^Bearer\s+/i, "");

  if (!presented || (presented !== serviceKey && presented !== legacyKey)) {
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      "Service role required",
      requestId,
      401,
      undefined,
      req,
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const notificationType: string = body.notification_type ?? "daily_drop";
    const title: string = body.title ?? "";
    const message: string = body.body ?? "";
    const data: Record<string, string> = body.data ?? {};
    /** Groups a logical send so a retry does not deliver twice. */
    const dedupeKey: string = body.dedupe_key ?? `${notificationType}-${new Date().toISOString().slice(0, 10)}`;

    if (!title || !message) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "title and body are required",
        requestId,
        400,
        undefined,
        req,
      );
    }

    const prefColumn = PREFERENCE_COLUMN[notificationType];
    if (!prefColumn) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Unknown notification_type: ${notificationType}`,
        requestId,
        400,
        undefined,
        req,
      );
    }

    const supabase = createServiceClient();

    // Credentials. Missing ones are not an error for the platform that has
    // them — a project with only FCM configured should still reach Android.
    const apnsKey = Deno.env.get("APNS_PRIVATE_KEY") ?? "";
    const apnsKeyId = Deno.env.get("APNS_KEY_ID") ?? "";
    const apnsTeamId = Deno.env.get("APNS_TEAM_ID") ?? "";
    const fcmAccount = parseServiceAccount(Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "");
    const apnsReady = !!(apnsKey && apnsKeyId && apnsTeamId);

    if (!apnsReady && !fcmAccount) {
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "No push credentials configured",
        requestId,
        503,
        undefined,
        req,
      );
    }

    // Live tokens whose owner has not opted out of this type.
    //
    // A player with no preferences row has not opted out — they simply have
    // not registered yet — so absent rows are treated as opted in, matching
    // the column defaults.
    const { data: devices, error: devicesError } = await supabase
      .from("device_tokens")
      .select("id, token, platform, player_id, app_version")
      .is("revoked_at", null)
      .limit(5000);

    if (devicesError) {
      logStructured(requestId, "send_notifications_devices_error", {
        error: devicesError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to load device tokens",
        requestId,
        500,
        undefined,
        req,
      );
    }

    const targets = (devices ?? []) as DeviceRow[];
    if (targets.length === 0) {
      return successResponse(
        { sent: 0, failed: 0, revoked: 0, skipped: 0 },
        requestId,
      );
    }

    // Opt-outs, in one query rather than per device.
    const playerIds = [...new Set(targets.map((d) => d.player_id))];
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select(`player_id, ${prefColumn}`)
      .in("player_id", playerIds);

    const optedOut = new Set(
      (prefs ?? [])
        .filter((p: Record<string, unknown>) => p[prefColumn] === false)
        .map((p: Record<string, unknown>) => p.player_id as string),
    );

    // Already delivered for this dedupe key, so a retry only sends what did
    // not land the first time.
    const { data: alreadySent } = await supabase
      .from("notification_deliveries")
      .select("player_id")
      .eq("dedupe_key", dedupeKey)
      .eq("succeeded", true);

    const delivered = new Set((alreadySent ?? []).map((d: { player_id: string }) => d.player_id));

    const payload: PushPayload = { title, body: message, data };

    let sent = 0;
    let failed = 0;
    let revoked = 0;
    let skipped = 0;

    const toRevoke: string[] = [];
    const deliveries: Array<{
      player_id: string;
      notification_type: string;
      dedupe_key: string;
      succeeded: boolean;
      error: string | null;
    }> = [];

    for (const device of targets) {
      if (optedOut.has(device.player_id) || delivered.has(device.player_id)) {
        skipped += 1;
        continue;
      }

      let result;
      if (device.platform === "ios") {
        if (!apnsReady) { skipped += 1; continue; }
        // A build stamped 'dev' registered against the APNs sandbox; a
        // release build is in production. Sending to the wrong host returns
        // BadDeviceToken, which looks like a bad token rather than a bad host.
        const isDev = (device.app_version ?? "").includes("dev");
        result = await sendApns(
          { privateKeyPem: apnsKey, keyId: apnsKeyId, teamId: apnsTeamId, bundleId: BUNDLE_ID },
          device.token,
          payload,
          isDev,
        );
      } else if (device.platform === "android") {
        if (!fcmAccount) { skipped += 1; continue; }
        result = await sendFcm(fcmAccount, device.token, payload);
      } else {
        skipped += 1;
        continue;
      }

      if (result.ok) {
        sent += 1;
        deliveries.push({
          player_id: device.player_id,
          notification_type: notificationType,
          dedupe_key: dedupeKey,
          succeeded: true,
          error: null,
        });
      } else {
        failed += 1;
        if (result.permanent) {
          toRevoke.push(device.id);
          revoked += 1;
        }
        deliveries.push({
          player_id: device.player_id,
          notification_type: notificationType,
          dedupe_key: dedupeKey,
          succeeded: false,
          error: result.reason,
        });
      }
    }

    // Retire tokens the provider says are dead, so they stop being retried
    // every day forever.
    if (toRevoke.length > 0) {
      await supabase
        .from("device_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .in("id", toRevoke);
    }

    if (deliveries.length > 0) {
      // Ignore conflicts: the unique (player_id, dedupe_key) is what makes a
      // retry idempotent, and hitting it means the row is already there.
      await supabase
        .from("notification_deliveries")
        .upsert(deliveries, { onConflict: "player_id,dedupe_key", ignoreDuplicates: true });
    }

    logStructured(requestId, "send_notifications_complete", {
      notification_type: notificationType,
      dedupe_key: dedupeKey,
      sent,
      failed,
      revoked,
      skipped,
    });

    return successResponse({ sent, failed, revoked, skipped }, requestId);
  } catch (error) {
    logStructured(requestId, "send_notifications_error", {
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
