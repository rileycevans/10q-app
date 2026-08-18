-- Handle reporting queue.
--
-- Handles are public on leaderboards and in leagues, so they are user-generated
-- content under App Store Guideline 1.2 and Google Play's UGC policy. Both
-- expect a way for players to report objectionable content and evidence that
-- reports are acted on. The blocklist in _shared/handle-blocklist.ts catches
-- the obvious cases up front; this table handles what gets through.

CREATE TABLE IF NOT EXISTS public.handle_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The player being reported. If they delete their account the report goes
  -- with them: there is nothing left to moderate.
  reported_player_id UUID NOT NULL
    REFERENCES public.players(id) ON DELETE CASCADE,

  -- Snapshot of the handle as it appeared when reported. Kept verbatim so a
  -- later rename doesn't erase what the reporter actually saw.
  reported_handle TEXT NOT NULL,

  -- Who reported it. SET NULL rather than CASCADE: if the reporter deletes
  -- their account the report itself is still worth reviewing.
  reporter_player_id UUID
    REFERENCES public.players(id) ON DELETE SET NULL,

  reason TEXT NOT NULL
    CHECK (reason IN ('offensive', 'impersonation', 'spam', 'other')),

  -- Optional free text from the reporter. Length-capped so the column can't be
  -- used to dump arbitrary data into the moderation queue.
  details TEXT CHECK (details IS NULL OR length(details) <= 500),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'actioned', 'dismissed')),

  -- Set when an admin resolves the report.
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.players(id) ON DELETE SET NULL,
  resolution_note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A player cannot report the same person twice; without this one annoyed
  -- user could flood the queue against a single handle.
  CONSTRAINT handle_reports_unique_reporter
    UNIQUE (reported_player_id, reporter_player_id),

  -- Self-reporting is meaningless and would just be noise.
  CONSTRAINT handle_reports_no_self_report
    CHECK (reporter_player_id IS NULL OR reporter_player_id <> reported_player_id)
);

-- The admin queue is almost always "show me pending reports, newest first".
CREATE INDEX IF NOT EXISTS idx_handle_reports_pending
  ON public.handle_reports (created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_handle_reports_reported_player
  ON public.handle_reports (reported_player_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.handle_reports ENABLE ROW LEVEL SECURITY;

-- Only admins can read the queue. Reports name both parties, so exposing them
-- to players would leak who reported whom.
CREATE POLICY "handle_reports_admin_read" ON public.handle_reports
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "handle_reports_admin_update" ON public.handle_reports
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Writes go through the report-handle edge function (service role), which
-- validates the target and stamps reporter_player_id from the caller's JWT.
-- No player-facing INSERT policy: a direct insert could forge the reporter.

COMMENT ON TABLE public.handle_reports IS
  'User reports of objectionable player handles. Written by the report-handle edge function; reviewed in /admin/reports.';
