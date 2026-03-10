/**
 * CORS headers for Edge Functions
 */

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://play10q.com";

export const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

