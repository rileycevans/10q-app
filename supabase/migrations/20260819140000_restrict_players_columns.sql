-- A4 — public.players was world-readable in full.
--
-- players_read_public is `USING (true)` with no column-level GRANT, so a single
-- request with the publishable anon key returned every row and every column.
-- Measured before this migration: one request enumerated all 181 players,
-- including linked_auth_user_id — the auth.users foreign key, which correlates
-- a public leaderboard handle to an auth identity.
--
-- The policy's own comment claimed "public read of handles, own read of full
-- profile", but nothing implemented the narrowing. This is the same shape as
-- the fix already applied to question_answers in 20260310100000.
--
-- The row policy is deliberately left as USING (true). Handles, streaks and
-- join dates are genuinely public — they appear on leaderboards and profiles by
-- design. What was never meant to be public is the auth linkage, and a column
-- GRANT is the precise tool for that: it removes one column without changing
-- who can see a leaderboard.
--
-- linked_auth_user_id carries no information the client needs. Verified: of 181
-- rows, 178 have it equal to id and the other 3 are NULL — it is never a
-- different value. Edge functions run under the service role and are unaffected.

REVOKE SELECT ON public.players FROM anon, authenticated;

-- Everything the client actually reads, and nothing else. Checked against every
-- `from('players').select(...)` in apps/web: handle_display, handle_canonical
-- and handle_last_changed_at are the only columns the app names directly;
-- the streak columns back player_streaks (C7) and the public profile.
GRANT SELECT (
  id,
  handle_display,
  handle_canonical,
  handle_last_changed_at,
  created_at,
  current_streak,
  longest_streak,
  last_quiz_date
) ON public.players TO anon, authenticated;

COMMENT ON COLUMN public.players.linked_auth_user_id IS
  'auth.users FK. NOT readable by anon or authenticated (A4) — it correlates a public handle to an auth identity. Service role only.';
