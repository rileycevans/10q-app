/**
 * APNs delivery.
 *
 * Apple authenticates with a short-lived ES256 JWT signed by the .p8 key,
 * rather than a long-lived secret. The token is valid for an hour and Apple
 * rejects one older than that, so it is cached and re-minted rather than
 * signed per notification.
 */

interface ApnsConfig {
  privateKeyPem: string;
  keyId: string;
  teamId: string;
  /** The app's bundle id — APNs calls this the topic. */
  bundleId: string;
}

/**
 * Which endpoint to send to.
 *
 * The APNs key is registered for "Sandbox & Production", so one key covers
 * both — but the DEVICE TOKEN does not. A token minted by a development
 * build (Xcode direct install) only exists in the sandbox; a TestFlight or
 * App Store token only exists in production. Sending to the wrong one gets
 * `BadDeviceToken`, which reads like a broken token rather than a wrong host.
 *
 * So this follows the build that registered the token, not the key.
 */
export function apnsHost(isDevelopmentBuild: boolean): string {
  return isDevelopmentBuild
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

let cachedToken: { jwt: string; mintedAt: number } | null = null;

/** Apple rejects a token older than an hour; re-mint well before that. */
const TOKEN_TTL_MS = 45 * 60 * 1000;

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Strip the PEM armour and decode to the raw DER bytes WebCrypto wants. */
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

async function mintAuthToken(config: ApnsConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && now - cachedToken.mintedAt < TOKEN_TTL_MS) {
    return cachedToken.jwt;
  }

  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const payload = base64url(
    JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }),
  );
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(config.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );

  const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`;
  cachedToken = { jwt, mintedAt: now };
  return jwt;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Routed on by the client when the notification is tapped. */
  data?: Record<string, string>;
}

export type PushResult =
  | { ok: true }
  /** The token is dead. Revoke it rather than retrying. */
  | { ok: false; permanent: true; reason: string }
  /** Transient — worth retrying later. */
  | { ok: false; permanent: false; reason: string };

export async function sendApns(
  config: ApnsConfig,
  deviceToken: string,
  payload: PushPayload,
  isDevelopmentBuild: boolean,
): Promise<PushResult> {
  try {
    const jwt = await mintAuthToken(config);

    const response = await fetch(
      `${apnsHost(isDevelopmentBuild)}/3/device/${deviceToken}`,
      {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": config.bundleId,
          "apns-push-type": "alert",
          // 5 = deliver at a time that conserves power. 10 would be immediate,
          // and Apple rejects 10 for alerts that are not user-initiated.
          "apns-priority": "5",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          aps: {
            alert: { title: payload.title, body: payload.body },
            sound: "default",
          },
          ...payload.data,
        }),
      },
    );

    if (response.ok) return { ok: true };

    const text = await response.text().catch(() => "");
    let reason = text;
    try {
      reason = JSON.parse(text).reason ?? text;
    } catch {
      // Non-JSON body; keep the raw text.
    }

    // 410 means the device unregistered. BadDeviceToken means it was never
    // valid for this environment. Both are permanent — retrying wastes work
    // and keeps a dead row alive.
    const permanent =
      response.status === 410 ||
      reason === "BadDeviceToken" ||
      reason === "Unregistered" ||
      reason === "DeviceTokenNotForTopic";

    return { ok: false, permanent, reason: `${response.status} ${reason}` };
  } catch (error) {
    // Network failure — transient by definition.
    return {
      ok: false,
      permanent: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
