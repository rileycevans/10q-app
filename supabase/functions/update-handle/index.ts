/**
 * Update Handle Edge Function (Standalone)
 * Allows users to customize their handle (once every 30 days)
 */

// Inline CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inline Error Codes
const ErrorCodes = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

// Inline response helpers
function successResponse<T>(data: T, requestId: string): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      data,
      request_id: requestId,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
      status: 200,
    }
  );
}

function errorResponse(
  code: string,
  message: string,
  requestId: string,
  status: number = 400
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
      },
      request_id: requestId,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
      status,
    }
  );
}

// Inline utils
function generateRequestId(): string {
  return crypto.randomUUID();
}

function logStructured(
  requestId: string,
  eventType: string,
  data: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      request_id: requestId,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      ...data,
    })
  );
}

// Inline handle validation
function validateHandle(handle: string): { valid: boolean; error?: string } {
  if (!handle || typeof handle !== 'string') {
    return { valid: false, error: 'Handle is required' };
  }

  const trimmed = handle.trim();

  if (trimmed.length < 3) {
    return { valid: false, error: 'Handle must be at least 3 characters' };
  }

  if (trimmed.length > 20) {
    return { valid: false, error: 'Handle must be 20 characters or less' };
  }

  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(trimmed)) {
    return { valid: false, error: 'Handle must start with a letter and contain only letters and numbers' };
  }

  return { valid: true };
}

function canonicalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

// Inline Supabase client
async function createServiceClient() {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.39.0");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Inline auth helper
async function getAuthenticatedUser(
  request: Request,
  requestId: string
): Promise<{ userId: string } | Response> {
  const authHeader = request.headers.get("Authorization");
  
  if (!authHeader) {
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      "Missing Authorization header",
      requestId,
      401
    );
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.39.0");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      "Invalid or expired token",
      requestId,
      401
    );
  }

  return { userId: user.id };
}

// Main function
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse(
      ErrorCodes.VALIDATION_ERROR,
      "Method not allowed",
      generateRequestId(),
      405
    );
  }

  const requestId = generateRequestId();
  logStructured(requestId, "update_handle_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    const body = await req.json();
    const { handle } = body;

    // Validate handle format
    const validation = validateHandle(handle);
    if (!validation.valid) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        validation.error || "Invalid handle",
        requestId,
        400
      );
    }

    const handleDisplay = handle.trim();
    const handleCanonical = canonicalizeHandle(handleDisplay);

    const supabase = await createServiceClient();

    // Get current profile
    const { data: profile, error: profileError } = await supabase
      .from("players")
      .select("handle_display, handle_canonical, handle_last_changed_at")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Profile not found",
        requestId,
        404
      );
    }

    // Check if handle is already taken (unless it's the same user)
    if (handleCanonical !== profile.handle_canonical) {
      const { data: existingProfile } = await supabase
        .from("players")
        .select("id")
        .eq("handle_canonical", handleCanonical)
        .single();

      if (existingProfile) {
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "Handle is already taken",
          requestId,
          400
        );
      }
    }

    // Check 30-day cooldown
    if (profile.handle_last_changed_at) {
      const lastChanged = new Date(profile.handle_last_changed_at);
      const now = new Date();
      const daysSinceChange = (now.getTime() - lastChanged.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceChange < 30) {
        const daysRemaining = Math.ceil(30 - daysSinceChange);
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          `Handle can only be changed once every 30 days. ${daysRemaining} day(s) remaining.`,
          requestId,
          400
        );
      }
    }

    // Update handle
    const { data: updatedProfile, error: updateError } = await supabase
      .from("players")
      .update({
        handle_display: handleDisplay,
        handle_canonical: handleCanonical,
        handle_last_changed_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select("handle_display, handle_canonical, handle_last_changed_at")
      .single();

    if (updateError) {
      logStructured(requestId, "update_handle_error", {
        error: updateError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to update handle",
        requestId,
        500
      );
    }

    logStructured(requestId, "update_handle_success", {
      user_id: userId,
      new_handle: handleDisplay,
    });

    return successResponse(
      {
        handle_display: updatedProfile.handle_display,
        handle_canonical: updatedProfile.handle_canonical,
        handle_last_changed_at: updatedProfile.handle_last_changed_at,
      },
      requestId
    );
  } catch (error: any) {
    logStructured(requestId, "update_handle_error", {
      error: error.message,
    });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});

