/**
 * The quality baseline: legacy findings this repo explicitly accepts.
 *
 * WHY THIS EXISTS
 *
 * 10Q carries pre-existing lint debt. Two bad options were available: block
 * every change until it is all fixed, or ignore lint entirely. The baseline is
 * the third — record exactly what is already wrong, then fail on anything new.
 *
 * The value for whoever inherits this repo is that a red check becomes
 * interpretable. "This was already broken when you got here" and "your change
 * made something worse" stop looking identical.
 *
 * WHAT MAY AND MAY NOT BE BASELINED
 *
 * Baselineable: legacy ESLint findings, formatting debt, static-analysis
 * warnings that are demonstrably pre-existing.
 *
 * NOT baselineable, ever: failing tests, schema/RLS/security invariants, broken
 * builds, Friday's own registry integrity, `docs check`, the freshness and
 * dependency-free invariants, and release or backend safety checks. If
 * something protecting production is red, "it was already red" is not a safety
 * argument.
 *
 * DIRECTION. The baseline may shrink freely and may only grow deliberately.
 * An agent whose new code fails lint must fix the code, not widen the baseline.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { path } from './repo.mjs';

const FILE = 'tools/friday/quality-baseline.json';

export function loadBaseline() {
  const p = path(FILE);
  if (!existsSync(p)) return { version: 1, eslint: [] };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { __parseError: true, eslint: [] };
  }
}

export function saveBaseline(b) {
  const { _comment, ...rest } = b;
  writeFileSync(
    path(FILE),
    JSON.stringify({ _comment: COMMENT, ...rest }, null, 2) + '\n',
  );
}

const COMMENT = [
  'Legacy quality findings this repo explicitly accepts.',
  '',
  'A finding is identified by file + rule, never by line number — lines drift',
  'on unrelated edits and would produce false regressions. Counts are kept so a',
  'second instance of a known rule in a known file is still caught.',
  '',
  'This file may shrink freely. Growing it is a deliberate act: run',
  '`friday quality baseline --accept-new-debt` and be prepared to justify it.',
  'If your own change fails lint, fix the change — do not widen the baseline.',
  '',
  'Never baseline: failing tests, schema/RLS/security invariants, broken builds,',
  "Friday's own integrity checks, or release and backend safety checks.",
];

/** Compare current findings against the baseline. */
export function compare(currentGroups, baseline) {
  const base = new Map((baseline.eslint || []).map((e) => [`${e.file} :: ${e.rule}`, e]));

  const isNew = [];      // not in the baseline at all — a regression
  const increased = [];  // known identity, more instances than accepted
  const resolved = [];   // accepted but no longer occurring — shrink
  const reduced = [];    // fewer instances than accepted — shrink
  const held = [];       // matches the baseline exactly

  for (const [k, cur] of currentGroups) {
    const b = base.get(k);
    if (!b) isNew.push(cur);
    else if (cur.count > b.count) increased.push({ ...cur, accepted: b.count });
    else if (cur.count < b.count) reduced.push({ ...cur, accepted: b.count });
    else held.push(cur);
  }
  for (const [k, b] of base) {
    if (!currentGroups.has(k)) resolved.push(b);
  }

  return { isNew, increased, resolved, reduced, held, regressed: isNew.length + increased.length > 0 };
}

export const toEntries = (groups) =>
  [...groups.values()]
    .map(({ file, rule, count, severity }) => ({ file, rule, count, severity }))
    .sort((a, b) => (a.file + a.rule).localeCompare(b.file + b.rule));
