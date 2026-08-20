/**
 * RLS Smoke Tests
 * Critical security tests that prove access control is working.
 * Run against local Supabase stack.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect, beforeAll } from "vitest";

// No defaults. These previously fell back to the *production* URL and anon
// key, so running the suite with no environment set pointed destructive RLS
// probes at live user data. The tests now skip unless a stack is named
// explicitly — see the guard below.
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Refuse to run against anything that is not a local stack unless the operator
 * says so out loud. `supabase start` serves 127.0.0.1:54321; CI uses the same.
 * Set ALLOW_NON_LOCAL_RLS_TESTS=1 to deliberately target a remote branch.
 */
const isLocalStack = /^https?:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal)(:\d+)?$/
  .test(SUPABASE_URL);
const allowNonLocal = process.env.ALLOW_NON_LOCAL_RLS_TESTS === "1";
const hasCredentials = SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";
const shouldRun = hasCredentials && (isLocalStack || allowNonLocal);

if (hasCredentials && !isLocalStack && !allowNonLocal) {
  throw new Error(
    `RLS smoke tests refused to run against non-local SUPABASE_URL (${SUPABASE_URL}). ` +
      "Point them at a local stack, or set ALLOW_NON_LOCAL_RLS_TESTS=1 deliberately.",
  );
}

// Skipped rather than failed when no stack is configured, so `npm test` is
// runnable on a laptop without Docker. CI starts a local stack and therefore
// runs them for real — see .github/workflows/ci.yml.
//
// These assertions were rewritten in Phase 0 (precondition 0B). The originals
// were written against a schema that no longer exists — private.correct_answers
// (dropped), daily_results (renamed to daily_scores), choice_text (now body) —
// and one of them asserted "anon cannot read the players table", which
// contradicts the live players_read_public policy of USING (true). Because the
// suite was never wired into CI, nothing caught the drift.
//
// Every assertion below was checked against the live policies and grants before
// being written, so they encode reality rather than intent.
describe.skipIf(!shouldRun)("RLS Smoke Tests", () => {
  // These tests assert RUNTIME behaviour — that Postgres refuses a query with
  // 42501 — so the client is deliberately untyped. Without generated database
  // types every table resolves to `never`, which makes a deliberately-illegal
  // insert fail to compile instead of failing at the database, testing the
  // opposite of the point.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type UntypedClient = SupabaseClient<any, any, any>;

  let anonClient: UntypedClient;
  let serviceClient: UntypedClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    // Only built when a service key is present. The anon-facing assertions —
    // which are the security-relevant ones — must still run without it, so a
    // missing service key skips one test rather than crashing the whole file.
    serviceClient = SUPABASE_SERVICE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      : (null as unknown as ReturnType<typeof createClient>);
  });

  /**
   * The single most important invariant in the product: a client must never be
   * able to read which answer is correct. It rests entirely on a column-level
   * GRANT (migration 20260310100000), with no RLS policy behind it — any future
   * `GRANT SELECT ON public.question_answers`, or a view created without
   * security_invoker, silently re-exposes the whole answer key.
   *
   * This is not hypothetical. That migration existed in the repo but had never
   * been applied to production: verified 2026-08-19 that the publishable anon
   * key could read is_correct for every published quiz, including the current
   * day's. Applied and closed. These tests exist so it cannot regress unnoticed.
   */
  describe("Answer key secrecy (A6)", () => {
    it("anon cannot read question_answers.is_correct", async () => {
      const { error } = await anonClient
        .from("question_answers")
        .select("body, is_correct")
        .limit(1);

      expect(error).toBeTruthy();
      expect(error?.code).toBe("42501");
    });

    it("authenticated cannot read question_answers.is_correct either", async () => {
      const { data: auth } = await anonClient.auth.signInAnonymously();
      expect(auth.session).toBeTruthy();

      const { error } = await anonClient
        .from("question_answers")
        .select("body, is_correct")
        .limit(1);

      expect(error).toBeTruthy();
      expect(error?.code).toBe("42501");

      await anonClient.auth.signOut();
    });

    it("anon CAN still read the non-secret columns the game needs", async () => {
      const { data, error } = await anonClient
        .from("question_answers")
        .select("id, question_id, body, sort_index")
        .limit(1);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it.skipIf(!SUPABASE_SERVICE_KEY)("the service role can still read is_correct, or scoring breaks", async () => {
      const { data, error } = await serviceClient
        .from("question_answers")
        .select("is_correct")
        .limit(1);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it("quiz_play_view — the client read path — exposes no correctness column", async () => {
      const { data, error } = await anonClient
        .from("quiz_play_view")
        .select("*")
        .limit(1);

      expect(error).toBeNull();
      if (data && data.length > 0) {
        const columns = Object.keys(data[0]);
        expect(columns.some((c) => c.includes("correct"))).toBe(false);
      }
    });
  });

  describe("Attempt isolation", () => {
    it("anon cannot read attempts (attempts_read_own keys off auth.uid())", async () => {
      const { data, error } = await anonClient
        .from("attempts")
        .select("id")
        .limit(1);

      // RLS filters rather than errors: an unauthenticated caller matches no
      // rows, so the correct assertion is an empty set, not a thrown error.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("anon cannot read attempt_answers", async () => {
      const { data, error } = await anonClient
        .from("attempt_answers")
        .select("attempt_id")
        .limit(1);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("anon cannot insert an attempt_answer (scoring must go through the edge function)", async () => {
      const { error } = await anonClient.from("attempt_answers").insert({
        attempt_id: "00000000-0000-0000-0000-000000000000",
        question_id: "00000000-0000-0000-0000-000000000000",
        selected_answer_id: "00000000-0000-0000-0000-000000000000",
      });

      expect(error).toBeTruthy();
    });
  });

  describe("Score isolation", () => {
    it("anon cannot read other players' daily_scores", async () => {
      const { data, error } = await anonClient
        .from("daily_scores")
        .select("player_id, score")
        .limit(1);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("anon cannot insert a daily_score (finalize-attempt owns scoring)", async () => {
      const { error } = await anonClient.from("daily_scores").insert({
        quiz_id: "00000000-0000-0000-0000-000000000000",
        player_id: "00000000-0000-0000-0000-000000000000",
        score: 100,
      });

      expect(error).toBeTruthy();
    });
  });

  /**
   * players_read_public is USING (true), so the whole table is world-readable.
   * The original suite asserted the opposite and would have failed. That is a
   * real privacy finding (blocking-fix A4) but it is the current, deliberate
   * behaviour — these tests pin what IS true, and the A4 test below documents
   * the exposure so tightening it is a visible, intentional change.
   */
  describe("Players table exposure (A4 — fixed)", () => {
    it("anon CAN read the players table", async () => {
      const { data, error } = await anonClient
        .from("players")
        .select("id, handle_display")
        .limit(1);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    // A4 is now FIXED. This test flipped deliberately, exactly as the previous
    // version said it would: the column GRANT in 20260819140000 removes
    // linked_auth_user_id from anon and authenticated.
    it("A4: linked_auth_user_id is NOT readable — it correlates handles to auth identities", async () => {
      const { error } = await anonClient
        .from("players")
        .select("id, linked_auth_user_id")
        .limit(1);

      expect(error).toBeTruthy();
      expect(error?.code).toBe("42501");
    });

    it("A4: select(*) on players is refused rather than silently narrowed", async () => {
      const { error } = await anonClient.from("players").select("*").limit(1);
      expect(error).toBeTruthy();
      expect(error?.code).toBe("42501");
    });

    it("the columns the app actually reads still work", async () => {
      const { data, error } = await anonClient
        .from("players")
        .select("id, handle_display, handle_canonical, current_streak")
        .limit(1);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it("anon cannot update another player's handle", async () => {
      const { data: existing } = await anonClient
        .from("players")
        .select("id, handle_display")
        .limit(1);

      if (!existing || existing.length === 0) return;
      const target = existing[0];

      // Two layers now refuse this, and either is sufficient:
      //   1. No UPDATE policy exists, so RLS matches zero rows.
      //   2. Since A4 (20260819140000) the column GRANT does not include
      //      UPDATE, so PostgREST returns 42501 before RLS is consulted.
      // The invariant worth asserting is the effect, not which layer caught
      // it — asserting on the error shape is what made the original suite
      // wrong when the schema moved underneath it.
      const { data: updated } = await anonClient
        .from("players")
        .update({ handle_display: "pwned" })
        .eq("id", target.id)
        .select();

      expect(updated ?? []).toEqual([]);

      const { data: after } = await anonClient
        .from("players")
        .select("handle_display")
        .eq("id", target.id)
        .single();

      expect(after?.handle_display).toBe(target.handle_display);
    });
  });

  describe("Quiz visibility", () => {
    it("anon can read published quizzes", async () => {
      const { data, error } = await anonClient
        .from("quizzes")
        .select("id, status")
        .eq("status", "published")
        .limit(1);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it("anon cannot read unpublished quizzes", async () => {
      const { data, error } = await anonClient
        .from("quizzes")
        .select("id, status")
        .neq("status", "published")
        .limit(1);

      // quizzes_read_published filters to status = 'published'.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("anon cannot insert a quiz", async () => {
      const { error } = await anonClient.from("quizzes").insert({
        status: "published",
        release_at_utc: new Date().toISOString(),
      });

      expect(error).toBeTruthy();
    });
  });

  describe("Handle reports (moderation queue is admin-only)", () => {
    it("anon cannot read handle_reports", async () => {
      const { data, error } = await anonClient
        .from("handle_reports")
        .select("id")
        .limit(1);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("anon cannot forge a report by inserting directly", async () => {
      const { error } = await anonClient.from("handle_reports").insert({
        reported_player_id: "00000000-0000-0000-0000-000000000000",
        reported_handle: "someone",
        reason: "offensive",
      });

      expect(error).toBeTruthy();
      expect(error?.code).toBe("42501");
    });
  });
});
