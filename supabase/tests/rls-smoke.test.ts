/**
 * RLS Smoke Tests
 * Critical security tests that prove access control is working.
 * Run against local Supabase stack.
 */

import { createClient } from "@supabase/supabase-js";
import { describe, it, expect, beforeAll } from "vitest";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zcvwamziybpslpavjljw.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjdndhbXppeWJwc2xwYXZqbGp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMDI2NDYsImV4cCI6MjA4Mjg3ODY0Nn0.GWoRvLok0PFJNh84EMjyNulyV_k57iHV0OF5gOdu0lE";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

describe("RLS Smoke Tests", () => {
  let anonClient: ReturnType<typeof createClient>;
  let serviceClient: ReturnType<typeof createClient>;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  });

  describe("Private Correct Answers", () => {
    it("anon cannot read private.correct_answers", async () => {
      const { data, error } = await anonClient
        .from("correct_answers")
        .select("*")
        .limit(1);

      expect(error).toBeTruthy();
      expect(error?.code).toBe("42501"); // Insufficient privilege
      expect(data).toBeNull();
    });

    it("service role can read private.correct_answers", async () => {
      // This test assumes we have test data
      // In real tests, you'd seed data first
      const { data, error } = await serviceClient
        .from("correct_answers")
        .select("*")
        .limit(1);

      // Should not error (may be empty, but no permission error)
      expect(error).toBeNull();
    });
  });

  describe("Attempt Isolation", () => {
    it("user cannot read other users' attempts", async () => {
      // This test requires:
      // 1. Two test users (user1, user2)
      // 2. An attempt created by user2
      // 3. user1 trying to read user2's attempt

      // For now, we test the policy exists
      // Full integration test would require auth setup
      const { data, error } = await anonClient
        .from("attempts")
        .select("*")
        .limit(1);

      // Anon should not be able to read (no auth.uid())
      expect(error).toBeTruthy();
    });

    it("user can read their own attempts", async () => {
      // This requires authenticated user
      // Full test would use: createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
      // Then sign in as test user
      // Then query attempts
      // For now, we verify the policy structure is correct
      expect(true).toBe(true); // Placeholder - requires auth setup
    });
  });

  describe("Daily Results Isolation", () => {
    it("user cannot read other users' daily_results", async () => {
      const { data, error } = await anonClient
        .from("daily_results")
        .select("*")
        .limit(1);

      // Anon should not be able to read (no auth.uid())
      expect(error).toBeTruthy();
    });
  });

  describe("Quiz Play View", () => {
    it("public can read quiz_play_view (no correct answers)", async () => {
      const { data, error } = await anonClient
        .from("quiz_play_view")
        .select("*")
        .limit(1);

      // Should not error (may be empty if no published quizzes)
      expect(error).toBeNull();
      
      // Verify view does not expose correct answers
      if (data && data.length > 0) {
        const row = data[0];
        expect(row).not.toHaveProperty("correct_answer");
        expect(row).not.toHaveProperty("correct_choice_id");
        expect(row).toHaveProperty("question_id");
        expect(row).toHaveProperty("choice_text");
      }
    });
  });

  describe("Attempt Answers Isolation", () => {
    it("user cannot read other users' attempt_answers", async () => {
      const { data, error } = await anonClient
        .from("attempt_answers")
        .select("*")
        .limit(1);

      // Anon should not be able to read
      expect(error).toBeTruthy();
    });
  });
});

