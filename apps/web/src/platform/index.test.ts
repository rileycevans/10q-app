import { describe, it, expect } from 'vitest';

/**
 * How the seam picks an implementation.
 *
 * This exists because the obvious expression is wrong. `NATIVE = platform !==
 * 'web'` reads correctly and breaks `npm run dev`, which does not go through
 * the version-env wrapper and so leaves NEXT_PUBLIC_CLIENT_PLATFORM undefined
 * — selecting the NATIVE modules on a developer's laptop, where storage
 * always returns ok:false and OAuth throws.
 *
 * It shipped that way briefly and cost a real debugging session: the durable
 * attempt cache silently wrote nothing, with no error anywhere, because the
 * write is fire-and-forget.
 *
 * Mirrors the expression in index.ts. Keep them in step.
 */
function isNative(platform: string | undefined): boolean {
  return platform === 'ios' || platform === 'android';
}

describe('platform selection', () => {
  it('selects native for ios and android', () => {
    expect(isNative('ios')).toBe(true);
    expect(isNative('android')).toBe(true);
  });

  it('selects web for web', () => {
    expect(isNative('web')).toBe(false);
  });

  it('selects WEB when the flag is unset — npm run dev', () => {
    // The regression. Web implementations work everywhere including inside a
    // WebView, so an unflagged native build is degraded but functional; an
    // unflagged web build selecting native is simply broken.
    expect(isNative(undefined)).toBe(false);
  });

  it('selects web for an unrecognised value rather than assuming native', () => {
    expect(isNative('')).toBe(false);
    expect(isNative('desktop')).toBe(false);
  });
});
