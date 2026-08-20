import { supabase } from './supabase/client';

/**
 * Get current session
 */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Sign out
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Ensure a session exists — creates an anonymous one if needed.
 * Returns the session (never null after this call).
 */
export async function ensureSession() {
  const existing = await getSession();
  if (existing) return existing;

  // Check if we're in the middle of an OAuth flow (PKCE code verifier exists)
  // If so, don't create an anonymous session as it will conflict
  if (typeof window !== 'undefined') {
    const storage = localStorage || sessionStorage;
    const keys = Object.keys(storage);
    const hasPKCE = keys.some(key =>
      key.includes('pkce') ||
      key.includes('code-verifier') ||
      key.includes('sb-') && key.includes('-auth-token')
    );
    if (hasPKCE) {
      // OAuth flow in progress, don't create anonymous session
      throw new Error('OAuth flow in progress');
    }
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session!;
}
