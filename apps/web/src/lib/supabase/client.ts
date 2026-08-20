/**
 * The Supabase client.
 *
 * Construction moved into the platform seam: web and native build the same
 * `createClient` and differ only in the storage adapter and
 * `detectSessionInUrl`. See src/platform/session.web.ts and session.native.ts.
 *
 * This module stays as the import path because thirteen call sites use it and
 * the indirection is free. It re-exports from '@/platform' rather than a
 * concrete implementation — importing session.web directly would give native
 * builds the web client, whose detectSessionInUrl: true races the deep-link
 * handler for the same one-time PKCE code.
 */
export { supabase } from '@/platform';
export { supabase as default } from '@/platform';
