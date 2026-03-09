#!/usr/bin/env node
/**
 * export-firestore-questions.js
 *
 * Reads questions from Firestore and writes them to scripts/questions.json
 * shaped to the 10Q question model (ready for Supabase import).
 *
 * Usage:
 *   1. Install deps: npm install  (from the scripts/ directory)
 *   2. Authenticate: firebase login  (uses ADC — no service account key needed)
 *   3. node scripts/export-firestore-questions.js
 *      OR from scripts/: npm run export-questions
 *
 * Output: scripts/questions.json
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── Config ──────────────────────────────────────────────────────────────────

const PROJECT_IDS = [
    'q-production-e4848',
    'q-prod-dd238',
];

const QUESTION_COLLECTION = 'questions';
const QOTD_COLLECTION = 'qotd';
const OUTPUT_PATH = path.join(__dirname, 'questions.json');

// ─── Firebase init ────────────────────────────────────────────────────────────

function initFirebase(projectId) {
    const existingApp = getApps().find(a => a.name === projectId);
    if (existingApp) return existingApp;

    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (keyPath) {
        const serviceAccount = require(path.resolve(keyPath));
        return initializeApp({ credential: cert(serviceAccount), projectId }, projectId);
    }

    // Application Default Credentials (firebase login --reauth)
    return initializeApp({ projectId }, projectId);
}

// ─── Schema probe ─────────────────────────────────────────────────────────────

async function probeAndSelectProject() {
    for (const projectId of PROJECT_IDS) {
        try {
            const app = initFirebase(projectId);
            const db = getFirestore(app);

            const qSnap = await db.collection(QUESTION_COLLECTION).limit(1).get();
            if (qSnap.empty) {
                console.log(`  ❌ ${projectId}: no docs in '${QUESTION_COLLECTION}'`);
                continue;
            }

            const sample = qSnap.docs[0];
            console.log(`\n✅ Using project: ${projectId}`);
            console.log(`\n── Sample question (id: ${sample.id}) ─────────────────────`);
            console.log(JSON.stringify(sample.data(), null, 2));

            // Also peek at qotd
            const qotdSnap = await db.collection(QOTD_COLLECTION).limit(1).get();
            if (!qotdSnap.empty) {
                const qotdSample = qotdSnap.docs[0];
                console.log(`\n── Sample qotd (id: ${qotdSample.id}) ─────────────────────`);
                console.log(JSON.stringify(qotdSample.data(), null, 2));
            } else {
                console.log(`\n  ⚠️  No docs found in '${QOTD_COLLECTION}'`);
            }

            return { db, projectId };
        } catch (err) {
            console.log(`  ⚠️  ${projectId}: ${err.message}`);
        }
    }
    return null;
}

// ─── Transform ────────────────────────────────────────────────────────────────
// Firestore schema:
//   question: string        — the question text
//   choices: string[]       — 4 choices, choices[0] is ALWAYS the correct answer
//   answer: string          — same as choices[0] (redundant confirmation)
//   date: string            — e.g. "2005-03-28"
//   difficulty: number
//   lastUsed: string
//
// Output: shuffle choices so correct answer isn't always sort_index 0.

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function transformQuestion(id, data) {
    const body = data.question ?? data.body ?? data.prompt ?? '';

    // choices[0] is always the correct answer in the old model.
    // Shuffle so correct answer lands at a random sort_index in the new model.
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const [correctChoice, ...wrongChoices] = choices;

    const shuffled = shuffle([
        { body: correctChoice ?? '', is_correct: true },
        ...wrongChoices.map(c => ({ body: c, is_correct: false })),
    ]);

    const answers = shuffled.map((a, i) => ({ ...a, sort_index: i }));

    // Tags not present in old model — leave empty for now.
    // Riley can tag questions via the admin UI, or backfill later.
    const tags = [];

    // Extract date from ID (format: "YYYY-MM-DD-qN")
    const dateMatch = id.match(/^(\d{4}-\d{2}-\d{2})/);
    const source_date = dateMatch ? dateMatch[1] : null;

    return { _firestore_id: id, source_date, body, answers, tags };
}

// Group questions by source_date to reconstruct curated quiz sets.
// Only keeps dates with exactly 10 questions.
function buildQotdGroups(questions) {
    const groups = {};
    for (const q of questions) {
        if (!q.source_date) continue;
        if (!groups[q.source_date]) groups[q.source_date] = [];
        groups[q.source_date].push(q._firestore_id);
    }
    return Object.fromEntries(
        Object.entries(groups).filter(([, ids]) => ids.length === 10)
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('🔍 Probing Firestore projects...\n');

    const result = await probeAndSelectProject();
    if (!result) {
        console.error('\n❌ No question data found. Check credentials and project IDs.');
        console.error('   Try: firebase login --reauth');
        process.exit(1);
    }

    const { db, projectId } = result;

    console.log('\n📥 Fetching all questions...');
    const allQSnap = await db.collection(QUESTION_COLLECTION).get();
    console.log(`   Found ${allQSnap.size} questions`);

    const questions = allQSnap.docs.map(doc => transformQuestion(doc.id, doc.data()));

    // ── Validation report ─────────────────────────────────────────────────────
    const issues = [];
    for (const q of questions) {
        const probs = [];
        if (!q.body) probs.push('missing body');
        if (q.answers.length !== 4) probs.push(`${q.answers.length} answers (expected 4)`);
        if (!q.answers.some(a => a.is_correct)) probs.push('no correct answer marked');
        if (probs.length) issues.push({ id: q._firestore_id, problems: probs });
    }

    if (issues.length) {
        console.warn(`\n⚠️  ${issues.length} questions need review:`);
        for (const issue of issues.slice(0, 20)) {
            console.warn(`   ${issue.id}: ${issue.problems.join(', ')}`);
        }
        if (issues.length > 20) console.warn(`   ... and ${issues.length - 20} more`);
    }

    // ── Reconstruct curated quiz groupings from document IDs ──────────────────
    const curated_quizzes = buildQotdGroups(questions);
    const curatedCount = Object.keys(curated_quizzes).length;
    console.log(`\n📅 Reconstructed ${curatedCount} curated quiz sets from document IDs`);

    // ── Write output ──────────────────────────────────────────────────────────
    const output = {
        _meta: {
            exported_at: new Date().toISOString(),
            source_project: projectId,
            total_questions: questions.length,
            curated_quiz_sets: curatedCount,
            issues_count: issues.length,
            note: 'tags are empty — backfill via admin UI or a follow-up script',
        },
        questions,
        // Keys are dates ("YYYY-MM-DD"), values are arrays of 10 _firestore_ids in order.
        // Use this to create draft quizzes in Supabase with the original curation intact.
        curated_quizzes,
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

    console.log(`\n✅ Written to ${OUTPUT_PATH}`);
    console.log(`   ${questions.length} questions | ${curatedCount} curated sets | ${issues.length} issues`);

    if (issues.length > 0) {
        console.log('\n   Review issues before running the Supabase import script.');
    } else {
        console.log('\n   All questions look clean. Ready to import.');
    }
}

main().catch(err => {
    console.error('\n💥 Fatal error:', err.message);
    if (err.code === 7 || err.message?.includes('PERMISSION_DENIED')) {
        console.error('   → Run: firebase login --reauth');
        console.error('   → Or set GOOGLE_APPLICATION_CREDENTIALS to a service account key path');
    }
    process.exit(1);
});
