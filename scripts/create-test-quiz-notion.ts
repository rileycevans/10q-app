/**
 * Create Test Quiz (Notion Plan Structure)
 * Creates a quiz following the exact Notion Backend & Data Model (V1) specification:
 * - questions table (no quiz_id, body field)
 * - question_answers table (with is_correct, sort_index 0-3)
 * - tags table (normalized with slug)
 * - question_tags junction (with tag_id FK)
 * - quiz_questions junction (links quizzes to questions, order_index 1-10)
 * 
 * Usage:
 *   SUPABASE_URL=your_url SUPABASE_SERVICE_KEY=your_key npx tsx scripts/create-test-quiz-notion.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY');
  console.error('\nUsage:');
  console.error('  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/create-test-quiz-notion.ts');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

interface TestQuestion {
  body: string;
  answers: Array<{ body: string; is_correct: boolean }>;
  tags: string[];
}

// Test questions following Notion plan structure
const TEST_QUESTIONS: TestQuestion[] = [
  {
    body: 'What is the capital of France?',
    answers: [
      { body: 'Paris', is_correct: true },
      { body: 'London', is_correct: false },
      { body: 'Berlin', is_correct: false },
      { body: 'Madrid', is_correct: false },
    ],
    tags: ['Geography', 'Europe'],
  },
  {
    body: 'Which planet is known as the Red Planet?',
    answers: [
      { body: 'Venus', is_correct: false },
      { body: 'Mars', is_correct: true },
      { body: 'Jupiter', is_correct: false },
      { body: 'Saturn', is_correct: false },
    ],
    tags: ['Science', 'Astronomy'],
  },
  {
    body: 'What is 2 + 2?',
    answers: [
      { body: '3', is_correct: false },
      { body: '4', is_correct: true },
      { body: '5', is_correct: false },
      { body: '6', is_correct: false },
    ],
    tags: ['Math', 'Basic'],
  },
  {
    body: 'Who wrote "Romeo and Juliet"?',
    answers: [
      { body: 'Charles Dickens', is_correct: false },
      { body: 'William Shakespeare', is_correct: true },
      { body: 'Jane Austen', is_correct: false },
      { body: 'Mark Twain', is_correct: false },
    ],
    tags: ['Literature', 'Classics'],
  },
  {
    body: 'What is the largest ocean on Earth?',
    answers: [
      { body: 'Atlantic', is_correct: false },
      { body: 'Indian', is_correct: false },
      { body: 'Arctic', is_correct: false },
      { body: 'Pacific', is_correct: true },
    ],
    tags: ['Geography', 'Oceans'],
  },
  {
    body: 'In what year did World War II end?',
    answers: [
      { body: '1943', is_correct: false },
      { body: '1944', is_correct: false },
      { body: '1945', is_correct: true },
      { body: '1946', is_correct: false },
    ],
    tags: ['History', 'World War'],
  },
  {
    body: 'What is the chemical symbol for gold?',
    answers: [
      { body: 'Go', is_correct: false },
      { body: 'Gd', is_correct: false },
      { body: 'Au', is_correct: true },
      { body: 'Ag', is_correct: false },
    ],
    tags: ['Science', 'Chemistry'],
  },
  {
    body: 'Which sport is known as "the beautiful game"?',
    answers: [
      { body: 'Basketball', is_correct: false },
      { body: 'Soccer', is_correct: true },
      { body: 'Tennis', is_correct: false },
      { body: 'Golf', is_correct: false },
    ],
    tags: ['Sports', 'Soccer'],
  },
  {
    body: 'What is the smallest prime number?',
    answers: [
      { body: '0', is_correct: false },
      { body: '1', is_correct: false },
      { body: '2', is_correct: true },
      { body: '3', is_correct: false },
    ],
    tags: ['Math', 'Numbers'],
  },
  {
    body: 'Who painted the Mona Lisa?',
    answers: [
      { body: 'Vincent van Gogh', is_correct: false },
      { body: 'Leonardo da Vinci', is_correct: true },
      { body: 'Pablo Picasso', is_correct: false },
      { body: 'Michelangelo', is_correct: false },
    ],
    tags: ['Art', 'History'],
  },
];

async function createTestQuiz() {
  console.log('🎯 Creating Test Quiz (Notion Plan Structure)...\n');

  try {
    // Step 1: Create tags (Notion plan: normalized tags table)
    console.log('📌 Step 1: Creating tags...');
    const allTags = new Set<string>();
    TEST_QUESTIONS.forEach(q => q.tags.forEach(t => allTags.add(t)));
    
    const tagMap = new Map<string, string>(); // name -> id
    
    for (const tagName of allTags) {
      const slug = tagName.toLowerCase().replace(/\s+/g, '-');
      
      // Upsert tag
      const { data: existingTag } = await supabase
        .from('tags')
        .select('id')
        .eq('slug', slug)
        .single();
      
      if (existingTag) {
        tagMap.set(tagName, existingTag.id);
        console.log(`   ✓ Tag exists: ${tagName} (${existingTag.id})`);
      } else {
        const { data: newTag, error: tagError } = await supabase
          .from('tags')
          .insert({ name: tagName, slug })
          .select('id')
          .single();
        
        if (tagError) {
          console.error(`   ❌ Failed to create tag "${tagName}":`, tagError);
          throw tagError;
        }
        
        tagMap.set(tagName, newTag.id);
        console.log(`   ✓ Created tag: ${tagName} (${newTag.id})`);
      }
    }
    console.log(`   ✅ ${tagMap.size} tags ready\n`);

    // Step 2: Create quiz
    console.log('📅 Step 2: Creating quiz...');
    const releaseDate = new Date();
    releaseDate.setUTCHours(releaseDate.getUTCHours() - 1); // Set to 1 hour ago for immediate availability

    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .insert({
        release_at_utc: releaseDate.toISOString(),
        status: 'draft',
      })
      .select('id')
      .single();

    if (quizError) {
      console.error('   ❌ Failed to create quiz:', quizError);
      throw quizError;
    }
    console.log(`   ✅ Quiz created: ${quiz.id}\n`);

    // Step 3: Create questions, answers, tags, and quiz_questions links
    console.log('📝 Step 3: Creating questions with answers and tags...');
    
    for (let i = 0; i < TEST_QUESTIONS.length; i++) {
      const testQ = TEST_QUESTIONS[i];
      const orderIndex = i + 1;

      console.log(`   Question ${orderIndex}/10: ${testQ.body.substring(0, 40)}...`);

      // Create question (Notion plan: body field, no quiz_id)
      const { data: question, error: qError } = await supabase
        .from('questions')
        .insert({ body: testQ.body })
        .select('id')
        .single();

      if (qError) {
        console.error(`   ❌ Failed to create question ${orderIndex}:`, qError);
        throw qError;
      }

      // Create answers (Notion plan: question_answers with is_correct, sort_index 0-3)
      for (let j = 0; j < testQ.answers.length; j++) {
        const { error: aError } = await supabase
          .from('question_answers')
          .insert({
            question_id: question.id,
            body: testQ.answers[j].body,
            sort_index: j, // 0-3 per Notion plan
            is_correct: testQ.answers[j].is_correct,
          });

        if (aError) {
          console.error(`   ❌ Failed to create answer ${j} for question ${orderIndex}:`, aError);
          throw aError;
        }
      }

      // Link tags (Notion plan: question_tags with tag_id FK)
      for (const tagName of testQ.tags) {
        const tagId = tagMap.get(tagName);
        if (!tagId) {
          console.error(`   ❌ Tag not found: ${tagName}`);
          throw new Error(`Tag not found: ${tagName}`);
        }

        const { error: qtError } = await supabase
          .from('question_tags')
          .insert({
            question_id: question.id,
            tag_id: tagId,
          });

        if (qtError) {
          console.error(`   ❌ Failed to link tag "${tagName}" to question ${orderIndex}:`, qtError);
          throw qtError;
        }
      }

      // Link question to quiz (Notion plan: quiz_questions junction)
      const { error: qqError } = await supabase
        .from('quiz_questions')
        .insert({
          quiz_id: quiz.id,
          question_id: question.id,
          order_index: orderIndex, // 1-10 per Notion plan
        });

      if (qqError) {
        console.error(`   ❌ Failed to link question ${orderIndex} to quiz:`, qqError);
        throw qqError;
      }

      console.log(`      ✅ Question ${orderIndex} complete (tags: ${testQ.tags.join(', ')})`);
    }
    console.log('');

    // Step 4: Publish quiz
    console.log('🚀 Step 4: Publishing quiz...');
    const { error: publishError } = await supabase
      .from('quizzes')
      .update({ status: 'published' })
      .eq('id', quiz.id);

    if (publishError) {
      console.error('   ❌ Failed to publish quiz:', publishError);
      throw publishError;
    }
    console.log('   ✅ Quiz published!\n');

    // Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎉 Test Quiz Created Successfully (Notion Plan Structure)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📋 Quiz ID: ${quiz.id}`);
    console.log(`📅 Release: ${releaseDate.toISOString()}`);
    console.log(`📊 Status: published`);
    console.log(`❓ Questions: 10`);
    console.log(`🏷️  Tags: ${tagMap.size} unique tags`);
    console.log('');
    console.log('📌 Schema follows Notion Backend & Data Model (V1):');
    console.log('   - questions.body (not prompt)');
    console.log('   - question_answers with is_correct (not private.correct_answers)');
    console.log('   - question_answers.sort_index 0-3 (not order_index 1-4)');
    console.log('   - tags table with slug');
    console.log('   - question_tags with tag_id FK');
    console.log('   - quiz_questions junction table');
    console.log('');
    console.log('💡 Next steps:');
    console.log('   1. Start the web app: cd apps/web && npm run dev');
    console.log('   2. Visit http://localhost:3000');
    console.log('   3. Sign in and click "PLAY NOW"');
    console.log('═══════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('\n❌ Error creating test quiz:', error);
    process.exit(1);
  }
}

createTestQuiz();
