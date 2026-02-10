import { supabase } from './supabase/client';

/**
 * Sign up with email and password
 */
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined,
    },
  });
  if (error) throw error;
  return data;
}

/**
 * Sign in with email and password
 */
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

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
 * Get current user
 */
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Ensure a session exists — creates an anonymous one if needed.
 * Returns the session (never null after this call).
 */
export async function ensureSession() {
  const existing = await getSession();
  if (existing) return existing;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session!;
}

/**
 * Check whether the current user is anonymous (not signed in with a provider).
 */
export async function isAnonymousUser(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.is_anonymous ?? true;
}

/**
 * Upgrade an anonymous account to Google.
 * Uses linkIdentity so the same user ID is preserved and all data stays.
 */
export async function upgradeToGoogle() {
  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: {
      redirectTo: typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback`
        : undefined,
    },
  });
  if (error) throw error;
  return data;
}

