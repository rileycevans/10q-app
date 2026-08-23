import type { PushPayload, PushResult } from "./push-apns.ts";

/**
 * FCM delivery via the HTTP v1 API.
 *
 * Unlike APNs, Google wants an OAuth2 access token obtained by signing a JWT
 * with the service account key — two steps rather than one. The access token
 * lasts an hour and is cached for the same reason the APNs one is.
 *
 * The legacy `fcm.googleapis.com/fcm/send` API with a static server key is
 * simpler and deprecated; it is not used here.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

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

/**
 * Exchange the service account for an access token.
 *
 * RS256 here, not ES256 — Google issues RSA keys where Apple issues elliptic
 * curve ones.
 */
async function getAccessToken(account: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 300) {
    return cachedAccessToken.token;
  }

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;

  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(account.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(signingInput),
    );

    const assertion = `${signingInput}.${base64url(new Uint8Array(signature))}`;

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.access_token) return null;

    cachedAccessToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in ?? 3600),
    };
    return data.access_token;
  } catch {
    return null;
  }
}

export async function sendFcm(
  account: ServiceAccount,
  deviceToken: string,
  payload: PushPayload,
): Promise<PushResult> {
  const accessToken = await getAccessToken(account);
  if (!accessToken) {
    // Could not authenticate at all — transient, and worth retrying rather
    // than revoking every token in the batch.
    return { ok: false, permanent: false, reason: "Failed to obtain FCM access token" };
  }

  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title: payload.title, body: payload.body },
            // Data values must be strings; FCM rejects other types outright.
            data: payload.data ?? {},
            android: {
              priority: "normal",
              notification: { sound: "default" },
            },
          },
        }),
      },
    );

    if (response.ok) return { ok: true };

    const text = await response.text().catch(() => "");
    let reason = text;
    try {
      const parsed = JSON.parse(text);
      reason = parsed.error?.status ?? parsed.error?.message ?? text;
    } catch {
      // Non-JSON body.
    }

    // UNREGISTERED and INVALID_ARGUMENT on the token mean it is dead.
    // 404 likewise. Anything else is worth retrying.
    const permanent =
      response.status === 404 ||
      reason === "UNREGISTERED" ||
      reason === "NOT_FOUND" ||
      (response.status === 400 && reason === "INVALID_ARGUMENT");

    return { ok: false, permanent, reason: `${response.status} ${reason}` };
  } catch (error) {
    return {
      ok: false,
      permanent: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
