/**
 * CORS headers for Edge Functions
 *
 * In production, set ALLOWED_ORIGIN=https://play10q.com in Supabase Edge
 * Function secrets. Falls back to wildcard for local development.
 */

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";

export const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

