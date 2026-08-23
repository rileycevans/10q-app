/**
 * One-shot credential check.
 *
 * Proves the APNs key signs and the FCM service account can obtain an access
 * token, WITHOUT sending a notification to anyone. Without this the first
 * evidence that a credential is wrong is a silent non-delivery at 11:30 UTC.
 *
 * Service-role only, and it returns no secret material — just whether each
 * step worked.
 */

import { corsHeadersFor } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { generateRequestId } from "../_shared/utils.ts";
import { parseServiceAccount } from "../_shared/push-fcm.ts";

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(req) });
  }

  const requestId = generateRequestId();

  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const legacyKey = Deno.env.get("LEGACY_SERVICE_ROLE_JWT") ?? "";

  if (!presented || (presented !== serviceKey && presented !== legacyKey)) {
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED, "Service role required", requestId, 401, undefined, req,
    );
  }

  const result: Record<string, unknown> = {};

  // APNs: can the .p8 be imported and produce an ES256 signature? A malformed
  // or truncated key fails here rather than at 11:30 UTC.
  const apnsKey = Deno.env.get("APNS_PRIVATE_KEY") ?? "";
  const apnsKeyId = Deno.env.get("APNS_KEY_ID") ?? "";
  const apnsTeamId = Deno.env.get("APNS_TEAM_ID") ?? "";

  if (!apnsKey || !apnsKeyId || !apnsTeamId) {
    result.apns = { configured: false, reason: "one or more APNS_* secrets are missing" };
  } else {
    try {
      const key = await crypto.subtle.importKey(
        "pkcs8", pemToArrayBuffer(apnsKey),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
      );
      const header = b64url(JSON.stringify({ alg: "ES256", kid: apnsKeyId }));
      const payload = b64url(JSON.stringify({ iss: apnsTeamId, iat: Math.floor(Date.now() / 1000) }));
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" }, key,
        new TextEncoder().encode(`${header}.${payload}`),
      );
      result.apns = { configured: true, signs: true, key_id: apnsKeyId, team_id: apnsTeamId };
    } catch (e) {
      result.apns = {
        configured: true, signs: false,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // FCM: does Google actually issue an access token? This is a real network
  // call, so it proves the key AND that the service account is enabled.
  const account = parseServiceAccount(Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "");
  if (!account) {
    result.fcm = { configured: false, reason: "FCM_SERVICE_ACCOUNT missing or unparseable" };
  } else {
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
      const claims = b64url(JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now, exp: now + 3600,
      }));
      const key = await crypto.subtle.importKey(
        "pkcs8", pemToArrayBuffer(account.private_key),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
      );
      const sig = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`),
      );
      const assertion = `${header}.${claims}.${b64url(new Uint8Array(sig))}`;

      const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      });

      if (resp.ok) {
        const d = await resp.json();
        result.fcm = {
          configured: true, authenticates: true,
          project_id: account.project_id,
          token_expires_in: d.expires_in,
        };
      } else {
        result.fcm = {
          configured: true, authenticates: false,
          reason: `${resp.status} ${(await resp.text()).slice(0, 200)}`,
        };
      }
    } catch (e) {
      result.fcm = {
        configured: true, authenticates: false,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return successResponse(result, requestId);
});
