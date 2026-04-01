/**
 * Generates Apple's OAuth client secret (JWT) for Supabase "Secret Key (for OAuth)".
 * Apple requires ES256; JWT expires in ≤6 months — regenerate before expiry.
 *
 * Usage (from repo root):
 *   cd scripts && npm install
 *   APPLE_KEY_ID=Z33HNJBUA9 \
 *   APPLE_CLIENT_ID=com.play10q.webapp \
 *   APPLE_KEY_PATH="$HOME/Downloads/AuthKey_Z33HNJBUA9.p8" \
 *   npx tsx generate-apple-client-secret.ts
 *
 * Team ID defaults to 7PPPD37HA8; override with APPLE_TEAM_ID if needed.
 *
 * Paste the printed line into Supabase → Authentication → Providers → Apple → Secret Key.
 * Do not commit .p8 files or paste this output into git.
 */

import * as fs from "node:fs";
import { SignJWT, importPKCS8 } from "jose";

/** Default Apple Team ID (Membership); override with APPLE_TEAM_ID. */
const DEFAULT_APPLE_TEAM_ID = "7PPPD37HA8";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

const teamId = process.env.APPLE_TEAM_ID?.trim() || DEFAULT_APPLE_TEAM_ID;
const keyId = requireEnv("APPLE_KEY_ID");
const clientId = requireEnv("APPLE_CLIENT_ID");
const keyPath = requireEnv("APPLE_KEY_PATH");

const pem = fs.readFileSync(keyPath, "utf8");
const privateKey = await importPKCS8(pem, "ES256");

// Apple allows max ~6 months; use 180d to stay under the limit.
const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: keyId })
  .setIssuer(teamId)
  .setSubject(clientId)
  .setAudience("https://appleid.apple.com")
  .setIssuedAt()
  .setExpirationTime("180d")
  .sign(privateKey);

console.log(jwt);
