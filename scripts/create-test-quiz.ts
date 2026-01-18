/**
 * Create Test Quiz Script
 * Creates a complete test quiz with 10 questions, 4 choices each, tags, and correct answers
 * 
 * Usage:
 *   SUPABASE_URL=your_url SUPABASE_SERVICE_KEY=your_key npx tsx scripts/create-test-quiz.ts
 * 
 * Or set in .env file:
 *   SUPABASE_URL=...
 *   SUPABASE_SERVICE_KEY=...
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY');
  console.error('\nUsage:');
  console.error('  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/create-test-quiz.ts');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

interface TestQuestion {
  prompt: string;
  choices: string[];
  correctIndex: number; // 0-3
  tags: string[];
}

const TEST_QUESTIONS: TestQuestion[] = [
  {
    prompt: 'What is the capital of France?',
    choices: ['Paris', 'London', 'Berlin', 'Madrid'],
    correctIndex: 0,
    tags: ['Geography', 'Europe'],
  },
  {
    prompt: 'Which planet is known as the Red Planet?',
    choices: ['Venus', 'Mars', 'Jupiter', 'Saturn'],
    correctIndex: 1,
    tags: ['Science', 'Astronomy'],
  },
  {
    prompt: 'What is 2 + 2?',
    choices: ['3', '4', '5', '6'],
    correctIndex: 1,
    tags: ['Math', 'Basic'],
  },
  {
    prompt: 'Who wrote "Romeo and Juliet"?',
    choices: ['Charles Dickens', 'William Shakespeare', 'Jane Austen', 'Mark Twain'],
    correctIndex: 1,
    tags: ['Literature', 'Classics'],
  },
  {
    prompt: 'What is the largest ocean on Earth?',
    choices: ['Atlantic', 'Indian', 'Arctic', 'Pacific'],
    correctIndex: 3,
    tags: ['Geography', 'Oceans'],
  },
  {
    prompt: 'In what year did World War II end?',
    choices: ['1943', '1944', '1945', '1946'],
    correctIndex: 2,
    tags: ['History', 'World War'],
  },
  {
    prompt: 'What is the chemical symbol for gold?',
    choices: ['Go', 'Gd', 'Au', 'Ag'],
    correctIndex: 2,
    tags: ['Science', 'Chemistry'],
  },
  {
    prompt: 'Which sport is known as "the beautiful game"?',
    choices: ['Basketball', 'Soccer', 'Tennis', 'Golf'],
    correctIndex: 1,
    tags: ['Sports', 'Soccer'],
  },
  {
    prompt: 'What is the smallest prime number?',
    choices: ['0', '1', '2', '3'],
    correctIndex: 2,
    tags: ['Math', 'Numbers'],
  },
  {
    prompt: 'Who painted the Mona Lisa?',
    choices: ['Vincent van Gogh', 'Leonardo da Vinci', 'Pablo Picasso', 'Michelangelo'],
    correctIndex: 1,
    tags: ['Art', 'History'],
  },
];

async function createTestQuiz() {
  console.log('🎯 Creating Test Quiz...\n');

  try {
    // Step 1: Create quiz
    const releaseDate = new Date();
    releaseDate.setUTCHours(11, 30, 0, 0);
    // If it's past 11:30 UTC today, set for tomorrow
    const now = new Date();
    if (now.getUTCHours() > 11 || (now.getUTCHours() === 11 && now.getUTCMinutes() >= 30)) {
      releaseDate.setUTCDate(releaseDate.getUTCDate() + 1);
    }

    console.log(`📅 Release date: ${releaseDate.toISOString()}`);

    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .insert({
        release_at_utc: releaseDate.toISOString(),
        status: 'draft', // Will be published by cron or manually
      })
      .select('id')
      .single();

    if (quizError) {
      console.error('❌ Failed to create quiz:', quizError);
      throw quizError;
    }

    console.log(`✅ Quiz created: ${quiz.id}\n`);

    // Step 2: Create questions and choices
    for (let i = 0; i < TEST_QUESTIONS.length; i++) {
      const testQ = TEST_QUESTIONS[i];
      const orderIndex = i + 1;

      console.log(`📝 Creating question ${orderIndex}/10: ${testQ.prompt.substring(0, 50)}...`);

      // Create question
      const { data: question, error: qError } = await supabase
        .from('questions')
        .insert({
          quiz_id: quiz.id,
          prompt: testQ.prompt,
          order_index: orderIndex,
        })
        .select('id')
        .single();

      if (qError) {
        console.error(`❌ Failed to create question ${orderIndex}:`, qError);
        throw qError;
      }

      // Create choices
      const choices = [];
      for (let j = 0; j < testQ.choices.length; j++) {
        const { data: choice, error: cError } = await supabase
          .from('question_choices')
          .insert({
            question_id: question.id,
            text: testQ.choices[j],
            order_index: j + 1,
          })
          .select('id')
          .single();

        if (cError) {
          console.error(`❌ Failed to create choice ${j + 1} for question ${orderIndex}:`, cError);
          throw cError;
        }

        choices.push(choice);
      }

      // Set correct answer
      const correctChoice = choices[testQ.correctIndex];
      const { error: correctError } = await supabase
        .from('correct_answers')
        .insert({
          question_id: question.id,
          correct_choice_id: correctChoice.id,
        });

      if (correctError) {
        console.error(`❌ Failed to set correct answer for question ${orderIndex}:`, correctError);
        throw correctError;
      }

      // Add tags
      const tagInserts = testQ.tags.map((tag) => ({
        question_id: question.id,
        tag,
      }));

      const { error: tagError } = await supabase
        .from('question_tags')
        .insert(tagInserts);

      if (tagError) {
        console.error(`❌ Failed to add tags for question ${orderIndex}:`, tagError);
        throw tagError;
      }

      console.log(`   ✅ Question ${orderIndex} complete (${testQ.tags.join(', ')})`);
    }

    console.log('\n🎉 Test quiz created successfully!');
    console.log(`\n📋 Quiz ID: ${quiz.id}`);
    console.log(`📅 Release: ${releaseDate.toISOString()}`);
    console.log(`📊 Status: draft`);
    console.log('\n💡 Next steps:');
    console.log('   1. Test publishing: Call publish-quiz Edge Function');
    console.log('   2. Or manually publish: UPDATE quizzes SET status = \'published\' WHERE id = \'' + quiz.id + '\';');
    console.log('   3. Test in app: Visit http://localhost:3000/play');

  } catch (error) {
    console.error('\n❌ Error creating test quiz:', error);
    process.exit(1);
  }
}

createTestQuiz();

