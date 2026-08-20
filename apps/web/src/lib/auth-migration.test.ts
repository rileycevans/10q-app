import { describe, it, expect } from 'vitest';

/**
 * The legacy-cookie session migration.
 *
 * Sessions moved from cookies (@supabase/ssr) to localStorage so web and
 * native share one client construction. Everyone already signed in has their
 * session in the old place.
 *
 * Verified in a browser before this was written: without the migration, the
 * first load after the switch minted a NEW anonymous user — the id changed
 * from 6a6d9fcd to c932b507 — orphaning the streak, scores and leagues
 * attached to the real account. These cover the parsing, which is the part
 * that can regress silently.
 */

/** Mirrors the cookie parsing in lib/auth.ts. */
function parseLegacyCookie(cookieHeader: string, key: string) {
  const cookie = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${key}=`));
  if (!cookie) return null;

  try {
    let raw = decodeURIComponent(cookie.slice(key.length + 1));
    if (raw.startsWith('base64-')) {
      raw = Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8');
    }
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token || !parsed?.refresh_token) return null;
    return { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
  } catch {
    return null;
  }
}

const KEY = 'sb-abcdefgh-auth-token';

describe('legacy cookie session migration', () => {
  it('extracts tokens from a plain JSON cookie', () => {
    const value = encodeURIComponent(
      JSON.stringify({ access_token: 'at-123', refresh_token: 'rt-456' }),
    );
    expect(parseLegacyCookie(`${KEY}=${value}`, KEY)).toEqual({
      access_token: 'at-123',
      refresh_token: 'rt-456',
    });
  });

  it('extracts tokens from a base64- prefixed cookie', () => {
    // @supabase/ssr base64-encodes larger sessions.
    const json = JSON.stringify({ access_token: 'at-b64', refresh_token: 'rt-b64' });
    const value = 'base64-' + Buffer.from(json, 'utf8').toString('base64');
    expect(parseLegacyCookie(`${KEY}=${encodeURIComponent(value)}`, KEY)).toEqual({
      access_token: 'at-b64',
      refresh_token: 'rt-b64',
    });
  });

  it('finds the cookie among others', () => {
    const value = encodeURIComponent(
      JSON.stringify({ access_token: 'a', refresh_token: 'r' }),
    );
    const header = `other=1; ${KEY}=${value}; another=2`;
    expect(parseLegacyCookie(header, KEY)).toEqual({
      access_token: 'a',
      refresh_token: 'r',
    });
  });

  it('returns null when the cookie is absent — a genuinely new visitor', () => {
    expect(parseLegacyCookie('unrelated=1', KEY)).toBeNull();
  });

  it('returns null on malformed JSON rather than throwing', () => {
    // Must not throw: this runs on every first load, including for people who
    // have never signed in.
    expect(parseLegacyCookie(`${KEY}=not-json`, KEY)).toBeNull();
  });

  it('returns null when the refresh token is missing', () => {
    // An access token alone cannot be adopted — setSession needs both, and a
    // half-session would expire without renewing.
    const value = encodeURIComponent(JSON.stringify({ access_token: 'only-at' }));
    expect(parseLegacyCookie(`${KEY}=${value}`, KEY)).toBeNull();
  });
});
