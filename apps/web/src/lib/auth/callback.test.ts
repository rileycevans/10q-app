import { describe, it, expect } from 'vitest';
import { parseCallback, safeNextPath, buildRecoveryRedirect } from './callback';

const ORIGIN = 'https://play10q.com';

describe('safeNextPath', () => {
  it('allows an internal path', () => {
    expect(safeNextPath('/leagues')).toBe('/leagues');
  });

  it('rejects an absolute URL', () => {
    expect(safeNextPath('https://evil.com')).toBe('/');
  });

  it('rejects a protocol-relative URL', () => {
    // Starts with '/', so a naive check passes it and the browser treats it
    // as https://evil.com — handing over a freshly-signed-in session.
    expect(safeNextPath('//evil.com')).toBe('/');
  });

  it('rejects a path back into /auth/ to avoid callback loops', () => {
    expect(safeNextPath('/auth/callback')).toBe('/');
  });

  it('defaults to / when absent', () => {
    expect(safeNextPath(null)).toBe('/');
  });
});

describe('parseCallback', () => {
  it('reads a PKCE code', () => {
    expect(parseCallback(`${ORIGIN}/auth/callback?code=abc123`)).toEqual({
      type: 'exchange_code',
      code: 'abc123',
      next: '/',
    });
  });

  it('carries next through a code exchange', () => {
    const action = parseCallback(`${ORIGIN}/auth/callback?code=abc&next=%2Fleagues`);
    expect(action).toEqual({ type: 'exchange_code', code: 'abc', next: '/leagues' });
  });

  it('detects an implicit-flow access token in the fragment', () => {
    const action = parseCallback(`${ORIGIN}/auth/callback#access_token=xyz&token_type=bearer`);
    expect(action.type).toBe('implicit_session');
  });

  it('routes an already-linked identity to recovery', () => {
    const url =
      `${ORIGIN}/auth/callback?error=invalid_request` +
      `&error_description=Identity%20is%20already%20linked%20to%20another%20user` +
      `&link_provider=google`;
    expect(parseCallback(url)).toEqual({
      type: 'recover_sign_in',
      provider: 'google',
      next: '/',
    });
  });

  it('preserves next through the recovery path', () => {
    // The bug this extraction fixed: recovery rebuilt the redirect without
    // next, so someone recovering an account was told they were being signed
    // in and then dropped on the home page.
    const url =
      `${ORIGIN}/auth/callback?error=invalid_request` +
      `&error_description=already%20linked&link_provider=apple&next=%2Fleagues%2Fview%3Fid%3D7`;
    const action = parseCallback(url);
    expect(action.type).toBe('recover_sign_in');
    expect(action.next).toBe('/leagues/view?id=7');
  });

  it('treats an error without a link provider as a plain error', () => {
    const action = parseCallback(
      `${ORIGIN}/auth/callback?error=access_denied&error_description=already%20linked`,
    );
    expect(action.type).toBe('error');
  });

  it('does not route an unrelated error to recovery', () => {
    const action = parseCallback(
      `${ORIGIN}/auth/callback?error=server_error&error_description=Something%20broke&link_provider=google`,
    );
    expect(action.type).toBe('error');
  });

  it('reports nothing to do for a bare callback', () => {
    expect(parseCallback(`${ORIGIN}/auth/callback`).type).toBe('nothing');
  });

  it('does not throw on a malformed URL', () => {
    expect(parseCallback('not a url').type).toBe('nothing');
  });

  it('sanitises next even on the error path', () => {
    const action = parseCallback(
      `${ORIGIN}/auth/callback?error=x&error_description=y&next=https%3A%2F%2Fevil.com`,
    );
    expect(action.next).toBe('/');
  });
});

describe('buildRecoveryRedirect', () => {
  it('carries next', () => {
    expect(buildRecoveryRedirect(ORIGIN, '/leagues')).toBe(
      'https://play10q.com/auth/callback?next=%2Fleagues',
    );
  });

  it('omits next when it is the default', () => {
    expect(buildRecoveryRedirect(ORIGIN, '/')).toBe('https://play10q.com/auth/callback');
  });
});
