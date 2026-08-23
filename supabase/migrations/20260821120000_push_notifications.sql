-- Push notification foundations: device tokens and per-type preferences.
--
-- Nothing here sends anything. This is the schema half, which is identical
-- whichever client path is taken and is the larger part of the work — the
-- sender needs APNs and FCM credentials that do not exist yet.
--
-- public.outbox_events already carries QuizPublished and AttemptCompleted
-- (5,841 rows, none consumed), so the daily-drop trigger is already being
-- recorded. A sender reads from there rather than needing new instrumentation.

-- ---------------------------------------------------------------------------
-- Device tokens
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,

  -- The APNs or FCM registration token.
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),

  -- Which build registered it. A token that starts failing is easier to
  -- explain when the app version is known.
  app_version text,

  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  -- Set when the provider reports the token is dead (APNs 410, FCM
  -- UNREGISTERED). Kept rather than deleted so a re-register is an update
  -- and the history stays legible.
  revoked_at timestamptz,

  -- One row per token. A device that re-registers the same token updates
  -- rather than accumulating duplicates, which is what makes a token
  -- migrating between accounts land on the right player.
  CONSTRAINT device_tokens_token_unique UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS device_tokens_player_idx
  ON public.device_tokens (player_id) WHERE revoked_at IS NULL;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- A player may see and remove their own tokens; nothing else is client
-- business. Registration goes through an Edge Function under the service
-- role, so there is deliberately no INSERT policy.
CREATE POLICY device_tokens_read_own ON public.device_tokens
  FOR SELECT USING (auth.uid() = player_id);

CREATE POLICY device_tokens_delete_own ON public.device_tokens
  FOR DELETE USING (auth.uid() = player_id);

-- ---------------------------------------------------------------------------
-- Per-type preferences
-- ---------------------------------------------------------------------------
--
-- Both stores require granular opt-out — "notifications on/off" is not
-- enough. Defaults are ON for the daily drop (it is why someone installs a
-- daily game) and ON for streak-at-risk, which is the one people actually
-- thank you for. Anything promotional would default OFF; there is none yet.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  daily_drop boolean NOT NULL DEFAULT true,
  streak_at_risk boolean NOT NULL DEFAULT true,
  league_activity boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_read_own ON public.notification_preferences
  FOR SELECT USING (auth.uid() = player_id);

CREATE POLICY notification_preferences_write_own ON public.notification_preferences
  FOR UPDATE USING (auth.uid() = player_id) WITH CHECK (auth.uid() = player_id);

CREATE POLICY notification_preferences_insert_own ON public.notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = player_id);

-- ---------------------------------------------------------------------------
-- Delivery log
-- ---------------------------------------------------------------------------
--
-- Without this there is no way to answer "did this person get the
-- notification?", and no way to stop a retry sending twice.

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  notification_type text NOT NULL,

  -- One delivery per player per logical event. A retry after a partial
  -- failure re-sends only what did not land.
  dedupe_key text NOT NULL,

  sent_at timestamptz NOT NULL DEFAULT now(),
  succeeded boolean NOT NULL,
  error text,

  CONSTRAINT notification_deliveries_dedupe UNIQUE (player_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS notification_deliveries_sent_idx
  ON public.notification_deliveries (sent_at DESC);

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
-- No policies: this is operational data, read by the service role only.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- 20260820120000 grants table privileges by default, but these tables are
-- created after it, so they need naming explicitly. Clients get nothing on
-- deliveries.

-- REVOKE FIRST. 20260820120000 set ALTER DEFAULT PRIVILEGES so every new
-- public table is granted to anon and authenticated automatically — which is
-- right for game tables and wrong for these. Without this, anon holds
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE on the device token table, and only
-- RLS stands between a stranger and every push token in the system. RLS would
-- hold, but that is one mistake away from not holding, and a token table is
-- not where to spend the only layer of defence.
REVOKE ALL ON public.device_tokens FROM anon, authenticated;
REVOKE ALL ON public.notification_preferences FROM anon, authenticated;
REVOKE ALL ON public.notification_deliveries FROM anon, authenticated;

-- Then grant back exactly what a signed-in player needs, with RLS scoping it
-- to their own rows. Registration goes through an Edge Function under the
-- service role, so there is no client INSERT on device_tokens.
GRANT SELECT, DELETE ON public.device_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
