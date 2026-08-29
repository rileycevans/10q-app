/**
 * ESLint findings, as data.
 *
 * IDENTITY. A finding is identified by `file :: rule`, not by line number.
 * Lines drift every time anything above them is edited, so a line-keyed
 * baseline would report false regressions on unrelated edits. File-plus-rule is
 * stable under that churn and still specific enough to catch a genuinely new
 * violation.
 *
 * Counts are kept per identity so that a second instance of an already-known
 * rule in an already-known file is still a regression. A bare total would let
 * one old finding disappear while one new finding appears and call it even.
 */
import { run } from './exec.mjs';
import { ROOT } from './repo.mjs';
import { PROJECT } from './project.mjs';

export const identity = (f) => `${f.file} :: ${f.rule}`;

/** Run ESLint and return its findings. Never throws on lint failure. */
export async function lintFindings() {
  const cwd = `${ROOT}/${PROJECT.clientWorkspace}`;
  const r = await run('npx', ['eslint', '--format', 'json'], { cwd });

  // ESLint exits non-zero when it finds errors; that is data, not a crash.
  // A genuinely broken invocation produces no parseable stdout.
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    return { ok: false, reason: r.stderr || 'ESLint produced no parseable output', findings: [] };
  }

  const findings = [];
  for (const file of report) {
    const rel = file.filePath.replace(`${ROOT}/`, '');
    for (const m of file.messages) {
      findings.push({
        file: rel,
        rule: m.ruleId || '(no rule)',
        line: m.line,
        severity: m.severity === 2 ? 'error' : 'warning',
        message: m.message,
      });
    }
  }
  return { ok: true, findings };
}

/** Collapse findings to identity -> count, keeping one example line each. */
export function group(findings) {
  const map = new Map();
  for (const f of findings) {
    const k = identity(f);
    const e = map.get(k) || { file: f.file, rule: f.rule, count: 0, severity: f.severity, lines: [] };
    e.count++;
    e.lines.push(f.line);
    // An error anywhere in the group makes the group an error.
    if (f.severity === 'error') e.severity = 'error';
    map.set(k, e);
  }
  return map;
}
