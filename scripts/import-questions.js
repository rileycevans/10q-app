#!/usr/bin/env node
/**
 * import-questions.js
 *
 * Reads scripts/questions.json (produced by export-firestore-questions.js)
 * and inserts everything into the 10Q Supabase project.
 *
 * What it does:
 *   1. Inserts all questions + their 4 answers into Supabase.
 *   2. Takes the 275 curated quiz sets, sorts them by their original Firestore
 *      date key (chronological), and re-schedules them starting March 13 2026,
 *      one per day at 11:30 UTC — matching the publish-quiz cron window.
 *   3. Questions not in any curated set land in the question bank only.
 *
 * Requirements:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment (or .env file)
 *   - Run AFTER all DB migrations have been applied
 *
 * Usage:
 *   cd scripts && npm run import-questions
 *   -- or --
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node import-questions.js
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    console.error('   Set them in your environment or a .env file in scripts/');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const INPUT_PATH = path.join(__dirname, 'questions.json');

// First quiz releases on this date at 11:30 UTC
const FIRST_RELEASE_DATE = new Date('2026-03-13T11:30:00.000Z');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addDays(date, n) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// Insert in batches to avoid hitting Supabase request size limits
async function batchInsert(table, rows, batchSize = 200) {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error } = await supabase.from(table).insert(batch);
        if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
        inserted += batch.length;
        process.stdout.write(`\r   ${inserted}/${rows.length} rows`);
        await sleep(50); // be kind to the API
    }
    console.log(); // newline after progress
    return inserted;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    // ── Load JSON ──────────────────────────────────────────────────────────────
    if (!fs.existsSync(INPUT_PATH)) {
        console.error(`❌  questions.json not found at ${INPUT_PATH}`);
        console.error('   Run: npm run export-questions');
        process.exit(1);
    }

    const { _meta, questions, curated_quizzes } = JSON.parse(
        fs.readFileSync(INPUT_PATH, 'utf8')
    );

    console.log(`\n📖  Loaded questions.json`);
    console.log(`   ${questions.length} questions`);
    console.log(`   ${Object.keys(curated_quizzes).length} curated quiz sets`);
    console.log(`   Exported at: ${_meta.exported_at}\n`);

    // Filter out the test document
    const validQuestions = questions.filter(
        (q) => q.body && q.answers.length === 4 && q.answers.some((a) => a.is_correct)
    );
    console.log(`✅  ${validQuestions.length} valid questions (${questions.length - validQuestions.length} skipped)\n`);

    // ── Insert Questions ───────────────────────────────────────────────────────
    console.log('📝  Inserting questions...');
    const questionRows = validQuestions.map((q) => ({
        // No ID provided — let Supabase generate UUIDs.
        // We'll build a map from _firestore_id → new UUID after insert.
        body: q.body,
    }));

    // Supabase doesn't return inserted IDs from bulk insert without select().
    // Insert one at a time would be too slow. Instead, insert with select to
    // get back the generated IDs, then correlate by position.
    //
    // We insert in batches and use RETURNING id by including .select('id, body').
    const firestoreIdToSupabaseId = new Map();

    const BATCH = 100;
    let qInserted = 0;
    for (let i = 0; i < validQuestions.length; i += BATCH) {
        const chunk = validQuestions.slice(i, i + BATCH);
        const { data, error } = await supabase
            .from('questions')
            .insert(chunk.map((q) => ({ body: q.body })))
            .select('id, body');

        if (error) throw new Error(`Failed to insert questions: ${error.message}`);

        // Match returned rows back to source questions by body text.
        // (body is unique enough within a batch for our purposes)
        const bodyToId = new Map(data.map((r) => [r.body, r.id]));
        for (const q of chunk) {
            const supabaseId = bodyToId.get(q.body);
            if (supabaseId) firestoreIdToSupabaseId.set(q._firestore_id, supabaseId);
        }

        qInserted += chunk.length;
        process.stdout.write(`\r   ${qInserted}/${validQuestions.length} questions`);
        await sleep(50);
    }
    console.log(`\n   ✅  ${firestoreIdToSupabaseId.size} questions inserted\n`);

    // ── Insert Answers ─────────────────────────────────────────────────────────
    console.log('🔤  Inserting answers...');
    const answerRows = [];
    for (const q of validQuestions) {
        const questionId = firestoreIdToSupabaseId.get(q._firestore_id);
        if (!questionId) continue;
        for (const a of q.answers) {
            answerRows.push({
                question_id: questionId,
                body: a.body,
                is_correct: a.is_correct,
                sort_index: a.sort_index,
            });
        }
    }
    await batchInsert('question_answers', answerRows);
    console.log(`   ✅  ${answerRows.length} answers inserted\n`);

    // ── Schedule Curated Quizzes ───────────────────────────────────────────────
    console.log('📅  Scheduling curated quizzes...');
    console.log(`   Starting: ${FIRST_RELEASE_DATE.toISOString()}`);

    // Sort curated quiz sets chronologically by their original date key
    const sortedDates = Object.keys(curated_quizzes).sort();
    console.log(`   ${sortedDates.length} sets to schedule\n`);

    let quizzesCreated = 0;
    let quizQuestionsCreated = 0;

    for (let i = 0; i < sortedDates.length; i++) {
        const originalDate = sortedDates[i];
        const firestoreIds = curated_quizzes[originalDate]; // array of 10 _firestore_ids

        // Compute the new release date
        const releaseAt = addDays(FIRST_RELEASE_DATE, i);

        // Create the quiz
        const { data: quiz, error: quizError } = await supabase
            .from('quizzes')
            .insert({
                release_at_utc: releaseAt.toISOString(),
                status: 'scheduled',
            })
            .select('id')
            .single();

        if (quizError) {
            console.error(`\n❌  Failed to create quiz for ${originalDate}: ${quizError.message}`);
            continue;
        }

        // Build quiz_questions rows, preserving original order
        const qqRows = [];
        for (let j = 0; j < firestoreIds.length; j++) {
            const firestoreId = firestoreIds[j];
            const questionId = firestoreIdToSupabaseId.get(firestoreId);
            if (!questionId) {
                console.warn(`\n⚠️   Could not find Supabase ID for firestore ID: ${firestoreId}`);
                continue;
            }
            qqRows.push({
                quiz_id: quiz.id,
                question_id: questionId,
                order_index: j + 1,
            });
        }

        const { error: qqError } = await supabase.from('quiz_questions').insert(qqRows);
        if (qqError) {
            console.error(`\n❌  Failed to insert quiz_questions for ${originalDate}: ${qqError.message}`);
            continue;
        }

        quizzesCreated++;
        quizQuestionsCreated += qqRows.length;

        process.stdout.write(
            `\r   ${quizzesCreated}/${sortedDates.length} quizzes | ` +
            `next release: ${releaseAt.toISOString().split('T')[0]}`
        );
        await sleep(30);
    }

    console.log('\n');

    // ── Summary ────────────────────────────────────────────────────────────────
    const lastDate = addDays(FIRST_RELEASE_DATE, sortedDates.length - 1);

    console.log('═'.repeat(60));
    console.log('✅  Import complete!');
    console.log(`   Questions inserted:      ${firestoreIdToSupabaseId.size}`);
    console.log(`   Answers inserted:        ${answerRows.length}`);
    console.log(`   Quizzes scheduled:       ${quizzesCreated}`);
    console.log(`   Quiz-question rows:      ${quizQuestionsCreated}`);
    console.log(`   First quiz:              ${FIRST_RELEASE_DATE.toISOString().split('T')[0]}`);
    console.log(`   Last quiz:               ${lastDate.toISOString().split('T')[0]}`);
    console.log('═'.repeat(60));
    console.log('\n   Content runs through:', lastDate.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    }));
    console.log('\n   Next steps:');
    console.log('   1. Verify in Supabase dashboard');
    console.log('   2. Check publish-quiz cron fires at 11:30 UTC');
    console.log('   3. Launch 🚀\n');
}

main().catch((err) => {
    console.error('\n💥  Fatal error:', err.message);
    process.exit(1);
});
