#!/usr/bin/env tsx
/**
 * Full Attempt Lifecycle Test
 * Creates test user, starts attempt, submits answers, finalizes
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zcvwamziybpslpavjljw.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjdndhbXppeWJwc2xwYXZqbGp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMDI2NDYsImV4cCI6MjA4Mjg3ODY0Nn0.GWoRvLok0PFJNh84EMjyNulyV_k57iHV0OF5gOdu0lE";

const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1`;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  data?: unknown;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<boolean | { passed: boolean; data?: unknown }>) {
  try {
    const result = await fn();
    if (typeof result === "boolean") {
      results.push({ name, passed: result });
      console.log(result ? `✅ ${name}` : `❌ ${name}`);
    } else {
      results.push({ name, passed: result.passed, data: result.data });
      console.log(result.passed ? `✅ ${name}` : `❌ ${name}`);
    }
  } catch (error: any) {
    results.push({ name, passed: false, error: error.message });
    console.log(`❌ ${name}: ${error.message}`);
  }
}

async function runFullLifecycleTest() {
  console.log("🧪 Testing Full Attempt Lifecycle\n");
  console.log("=".repeat(50));

  // Step 1: Create test user
  const timestamp = Date.now();
  const testEmail = `testuser${timestamp}@test.com`;
  const testPassword = "TestPassword123!";

  let testUser: { id: string; token: string } | null = null;

  await test("Create test user", async () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: testPassword,
      options: {
        emailRedirectTo: undefined, // Disable email confirmation for testing
      },
    });

    if (error) {
      console.log(`  Error details: ${JSON.stringify(error)}`);
      return { passed: false, data: error.message };
    }

    if (!data.user) {
      return { passed: false, data: "No user returned" };
    }

    // If session is null, try to sign in
    if (!data.session) {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      if (signInError || !signInData.session) {
        return { passed: false, data: `Sign in failed: ${signInError?.message || "No session"}` };
      }

      testUser = {
        id: data.user.id,
        token: signInData.session.access_token,
      };
    } else {
      testUser = {
        id: data.user.id,
        token: data.session.access_token,
      };
    }

    return { passed: true, data: { user_id: testUser.id } };
  });

  if (!testUser) {
    console.log("\n❌ Cannot proceed without test user");
    return;
  }

  // Step 2: Get current quiz
  let quizId: string | null = null;

  await test("Get current quiz", async () => {
    const response = await fetch(`${EDGE_FUNCTION_URL}/get-current-quiz`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data = await response.json();
    if (data.ok && data.data?.quiz_id) {
      quizId = data.data.quiz_id;
      return { passed: true, data: { quiz_id: quizId } };
    }
    return { passed: false, data };
  });

  if (!quizId) {
    console.log("\n❌ Cannot proceed without quiz");
    return;
  }

  // Step 3: Start attempt
  let attemptId: string | null = null;
  let questionIds: string[] = [];
  let choiceIds: string[] = [];

  await test("Start attempt", async () => {
    const response = await fetch(`${EDGE_FUNCTION_URL}/start-attempt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({ quiz_id: quizId }),
    });

    const data = await response.json();
    if (data.ok && data.data?.attempt_id) {
      attemptId = data.data.attempt_id;
      
      // Extract question and choice IDs from current_question
      if (data.data.current_question) {
        questionIds.push(data.data.current_question.question_id);
        choiceIds.push(data.data.current_question.choice_id);
      }

      return {
        passed: true,
        data: {
          attempt_id: attemptId,
          current_index: data.data.current_index,
          question_started_at: data.data.question_started_at,
        },
      };
    }
    return { passed: false, data };
  });

  if (!attemptId) {
    console.log("\n❌ Cannot proceed without attempt");
    return;
  }

  // Step 4: Submit first answer (correct choice)
  await test("Submit first answer (correct)", async () => {
    // Get question details
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${testUser.token}` } },
    });

    const { data: questions } = await supabase
      .from("quiz_play_view")
      .select("*")
      .eq("quiz_id", quizId)
      .eq("order_index", 1);

    if (!questions || questions.length === 0) {
      return { passed: false, data: "Question not found" };
    }

    const question = questions[0];
    const correctChoiceId = question.choice_id; // First choice is correct

    const response = await fetch(`${EDGE_FUNCTION_URL}/submit-answer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({
        attempt_id: attemptId,
        question_id: question.question_id,
        selected_choice_id: correctChoiceId,
      }),
    });

    const data = await response.json();
    if (data.ok && data.data?.is_correct === true) {
      // Verify scoring
      const expectedScore = 10; // 5 base + 5 bonus (answered at ~0ms)
      const actualScore = data.data.total_points;
      
      // Allow some variance due to network delay
      const scoreOk = actualScore >= 9 && actualScore <= 10;
      
      return {
        passed: scoreOk,
        data: {
          is_correct: data.data.is_correct,
          base_points: data.data.base_points,
          bonus_points: data.data.bonus_points,
          total_points: data.data.total_points,
          time_ms: data.data.time_ms,
        },
      };
    }
    return { passed: false, data };
  });

  // Step 5: Test idempotency (submit same answer twice)
  await test("Submit answer idempotency (duplicate call)", async () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${testUser.token}` } },
    });

    const { data: questions } = await supabase
      .from("quiz_play_view")
      .select("*")
      .eq("quiz_id", quizId)
      .eq("order_index", 1);

    if (!questions || questions.length === 0) {
      return { passed: false, data: "Question not found" };
    }

    const question = questions[0];
    const correctChoiceId = question.choice_id;

    // Submit same answer twice
    const response1 = await fetch(`${EDGE_FUNCTION_URL}/submit-answer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({
        attempt_id: attemptId,
        question_id: question.question_id,
        selected_choice_id: correctChoiceId,
      }),
    });

    const data1 = await response1.json();

    const response2 = await fetch(`${EDGE_FUNCTION_URL}/submit-answer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({
        attempt_id: attemptId,
        question_id: question.question_id,
        selected_choice_id: correctChoiceId,
      }),
    });

    const data2 = await response2.json();

    // Both should return same result (idempotent)
    const isIdempotent =
      data1.ok &&
      data2.ok &&
      data1.data?.is_correct === data2.data?.is_correct &&
      data1.data?.total_points === data2.data?.total_points;

    return { passed: isIdempotent, data: { first: data1.data, second: data2.data } };
  });

  // Step 6: Resume attempt
  await test("Resume attempt", async () => {
    const response = await fetch(
      `${EDGE_FUNCTION_URL}/resume-attempt?attempt_id=${attemptId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testUser.token}`,
        },
      }
    );

    const data = await response.json();
    if (data.ok && data.data?.attempt_id === attemptId) {
      return {
        passed: true,
        data: {
          current_index: data.data.current_index,
          is_complete: data.data.is_complete,
        },
      };
    }
    return { passed: false, data };
  });

  // Step 7: Submit remaining answers (simplified - just submit 2 more)
  await test("Submit additional answers", async () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${testUser.token}` } },
    });

    // Get questions 2 and 3
    for (let i = 2; i <= 3; i++) {
      const { data: questions } = await supabase
        .from("quiz_play_view")
        .select("*")
        .eq("quiz_id", quizId)
        .eq("order_index", i);

      if (!questions || questions.length === 0) {
        continue;
      }

      const question = questions[0];
      const correctChoiceId = question.choice_id;

      const response = await fetch(`${EDGE_FUNCTION_URL}/submit-answer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testUser.token}`,
        },
        body: JSON.stringify({
          attempt_id: attemptId,
          question_id: question.question_id,
          selected_choice_id: correctChoiceId,
        }),
      });

      const data = await response.json();
      if (!data.ok) {
        return { passed: false, data: `Failed on question ${i}: ${JSON.stringify(data)}` };
      }
    }

    return { passed: true, data: "Submitted questions 2-3" };
  });

  // Step 8: Finalize attempt (should fail - not all questions answered)
  await test("Finalize attempt (should fail - incomplete)", async () => {
    const response = await fetch(`${EDGE_FUNCTION_URL}/finalize-attempt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({ attempt_id: attemptId }),
    });

    const data = await response.json();
    // Should fail because we only answered 3 questions
    const shouldFail = !data.ok && data.error?.code === "VALIDATION_ERROR";
    return { passed: shouldFail, data: data.error?.message };
  });

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log("\n" + "=".repeat(50));
  console.log(`\n📊 Results: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log("✅ All lifecycle tests passed!");
    process.exit(0);
  } else {
    console.log("❌ Some tests failed");
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  - ${r.name}: ${r.error || JSON.stringify(r.data)}`);
    });
    process.exit(1);
  }
}

runFullLifecycleTest().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

