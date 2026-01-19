/**
 * Check and Publish Quiz Script
 * Lists existing quizzes and helps publish them for testing
 * 
 * Usage:
 *   SUPABASE_URL=your_url SUPABASE_SERVICE_KEY=your_key npx tsx scripts/check-and-publish-quiz.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY');
  console.error('\nUsage:');
  console.error('  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/check-and-publish-quiz.ts');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function checkAndPublishQuiz() {
  console.log('🔍 Checking existing quizzes...\n');

  try {
    // Get all quizzes
    const { data: allQuizzes, error: allError } = await supabase
      .from('quizzes')
      .select('id, release_at_utc, status, created_at')
      .order('created_at', { ascending: false });

    if (allError) {
      console.error('❌ Failed to fetch quizzes:', allError);
      throw allError;
    }

    if (!allQuizzes || allQuizzes.length === 0) {
      console.log('📭 No quizzes found in database.');
      console.log('\n💡 Create a test quiz first:');
      console.log('   cd scripts && npm run create-test-quiz');
      return;
    }

    console.log(`📋 Found ${allQuizzes.length} quiz(es):\n`);

    // Group by status
    const draftQuizzes = allQuizzes.filter(q => q.status === 'draft');
    const publishedQuizzes = allQuizzes.filter(q => q.status === 'published');
    const now = new Date();

    // Show published quizzes
    if (publishedQuizzes.length > 0) {
      console.log('✅ Published Quizzes:');
      publishedQuizzes.forEach(quiz => {
        const releaseDate = new Date(quiz.release_at_utc);
        const isAvailable = releaseDate <= now;
        const statusIcon = isAvailable ? '🟢' : '🟡';
        console.log(`   ${statusIcon} ${quiz.id}`);
        console.log(`      Status: ${quiz.status}`);
        console.log(`      Release: ${releaseDate.toISOString()} ${isAvailable ? '(Available)' : '(Future)'}`);
        console.log(`      Created: ${new Date(quiz.created_at).toISOString()}`);
        console.log('');
      });
    }

    // Show draft quizzes
    if (draftQuizzes.length > 0) {
      console.log('📝 Draft Quizzes (not visible in app):');
      draftQuizzes.forEach(quiz => {
        const releaseDate = new Date(quiz.release_at_utc);
        console.log(`   ⚪ ${quiz.id}`);
        console.log(`      Status: ${quiz.status}`);
        console.log(`      Release: ${releaseDate.toISOString()}`);
        console.log(`      Created: ${new Date(quiz.created_at).toISOString()}`);
        console.log('');
      });

      // Check if any draft is ready to publish
      const readyToPublish = draftQuizzes.filter(q => {
        const releaseDate = new Date(q.release_at_utc);
        return releaseDate <= now;
      });

      if (readyToPublish.length > 0) {
        console.log(`\n💡 Found ${readyToPublish.length} draft quiz(es) ready to publish:`);
        readyToPublish.forEach(quiz => {
          console.log(`   - ${quiz.id}`);
        });
        console.log('\n📌 To publish, run:');
        console.log('   UPDATE quizzes SET status = \'published\' WHERE id = \'quiz-id\';');
        console.log('   Or call the publish-quiz Edge Function');
      } else {
        console.log('\n💡 Draft quizzes exist but release dates are in the future.');
        console.log('   To publish for testing, update release_at_utc to the past:');
        console.log('   UPDATE quizzes SET status = \'published\', release_at_utc = NOW() - INTERVAL \'1 hour\' WHERE id = \'quiz-id\';');
      }
    }

    // Check current available quiz
    console.log('\n🎯 Current Available Quiz (what app will show):');
    const { data: currentQuiz, error: currentError } = await supabase
      .from('quizzes')
      .select('id, release_at_utc, status, created_at')
      .eq('status', 'published')
      .lte('release_at_utc', now.toISOString())
      .order('release_at_utc', { ascending: false })
      .limit(1)
      .single();

    if (currentError || !currentQuiz) {
      console.log('   ❌ No quiz currently available');
      console.log('   This is why the app shows "Come Back Later"');
    } else {
      console.log(`   ✅ ${currentQuiz.id}`);
      console.log(`      Release: ${new Date(currentQuiz.release_at_utc).toISOString()}`);
      console.log(`      Created: ${new Date(currentQuiz.created_at).toISOString()}`);
    }

    console.log('\n📚 For more help, see PRACTICE_QUIZ_GUIDE.md');

  } catch (error) {
    console.error('\n❌ Error checking quizzes:', error);
    process.exit(1);
  }
}

checkAndPublishQuiz();
