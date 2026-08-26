-- league_members_read_member checked membership by querying league_members
-- inside its own USING clause. Postgres applies the policy to that inner
-- query too, detects the loop, and rejects EVERY direct client read of the
-- table with 42P17 "infinite recursion detected in policy".
--
-- This sat dormant since January because leagues are only ever read through
-- Edge Functions under the service role, which bypasses RLS. The first
-- direct client read — the sign-in flow asking "does this anonymous account
-- have league memberships worth linking?" — hit the 500, and because that
-- check deliberately fails toward preserving data, every sign-in ran the
-- doomed linkIdentity attempt and cost the player a second browser sheet.
--
-- Standard fix: move the membership check into a SECURITY DEFINER function,
-- which reads league_members without RLS applying to it. The function only
-- ever answers for auth.uid(), so a caller can learn nothing beyond their
-- own membership.

CREATE OR REPLACE FUNCTION public.is_league_member(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members
    WHERE league_id = p_league_id
      AND player_id = auth.uid()
  );
$$;

-- Same semantics as before — members see their league's member rows — now
-- without the self-reference.
DROP POLICY IF EXISTS "league_members_read_member" ON public.league_members;
CREATE POLICY "league_members_read_member" ON public.league_members
  FOR SELECT
  USING (public.is_league_member(league_id));

-- leagues_read_member subqueries league_members and was breaking the same
-- way whenever a client read leagues directly (the policy's inner query ran
-- under the recursive policy). Rewriting it on the helper makes it
-- independent of league_members RLS entirely.
DROP POLICY IF EXISTS "leagues_read_member" ON public.leagues;
CREATE POLICY "leagues_read_member" ON public.leagues
  FOR SELECT
  USING (public.is_league_member(id));
