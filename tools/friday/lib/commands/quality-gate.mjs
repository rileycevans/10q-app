/**
 * friday quality gate  — is this allowed to ship?
 * friday quality baseline — what legacy debt do we accept, and has it moved?
 *
 * The gate's honesty rules:
 *   - lint passes when there is NO REGRESSION from the baseline, and says so
 *     in those words. Grandfathered findings are reported, never hidden.
 *   - checks that are not implemented yet are named as NOT RUN, never skipped
 *     silently. A gate that quietly covers less than it claims is worse than
 *     no gate.
 */
import { ui, paint } from '../ui.mjs';
import { run } from '../exec.mjs';
import { ROOT } from '../repo.mjs';
import { lintFindings, group } from '../lint.mjs';
import { loadBaseline, saveBaseline, compare, toEntries } from '../baseline.mjs';
import { SCRIPTS } from './quality.mjs';
import { all } from '../capabilities.mjs';

const line = (g) => `${g.file}  ${paint.grey(g.rule)}${g.count > 1 ? paint.grey(` x${g.count}`) : ''}`;

/**
 * tsc reports errors inside .next/ when a stale build tree references routes
 * that no longer exist. That is a local artifact problem, not a code problem,
 * and telling someone their types are broken when they are not is exactly the
 * kind of false signal this tool exists to remove.
 */
function staleArtifactOnly(output) {
  const errs = output.split('\n').filter((l) => /error TS/.test(l));
  return errs.length > 0 && errs.every((l) => /^\.next\//.test(l.trim()));
}

async function runScript(path) {
  const spec = SCRIPTS[path];
  const [cmd, ...rest] = spec.argv;
  const r = await run(cmd, rest, { cwd: ROOT });
  return { spec, ...r };
}

export async function qualityGate(args = []) {
  const jsonOut = args.includes('--json');
  const results = [];
  let failed = false;

  if (!jsonOut) ui.title('friday quality gate');

  // ---- lint, against the baseline -----------------------------------------
  const lint = await lintFindings();
  const baseline = loadBaseline();
  let cmp = null;

  if (!lint.ok) {
    failed = true;
    results.push({ check: 'lint', status: 'error', detail: lint.reason });
  } else {
    cmp = compare(group(lint.findings), baseline);
    if (cmp.regressed) failed = true;
    results.push({
      check: 'lint',
      status: cmp.regressed ? 'fail' : 'pass',
      newFindings: cmp.isNew.length,
      increased: cmp.increased.length,
      grandfathered: cmp.held.length,
      resolved: cmp.resolved.length,
    });
  }

  // ---- typecheck and unit tests -------------------------------------------
  for (const p of ['quality.typecheck', 'quality.unit']) {
    const r = await runScript(p);
    let status = r.ok ? 'pass' : 'fail';
    let detail = null;
    if (!r.ok && p === 'quality.typecheck' && staleArtifactOnly(r.stdout + r.stderr)) {
      status = 'stale-artifact';
      detail = 'All type errors are inside .next/, which is a stale build tree, not your code. Delete it and re-run.';
    }
    if (status === 'fail') failed = true;
    results.push({ check: p.split('.')[1], status, detail });
  }

  // ---- what this gate does NOT cover --------------------------------------
  const notRun = all()
    .filter((c) => c.path.startsWith('quality.') && c.status === 'planned')
    .map((c) => c.path.split('.')[1]);

  if (jsonOut) {
    console.log(JSON.stringify({ pass: !failed, results, notRun }, null, 2));
    return failed ? 1 : 0;
  }

  // ---- report --------------------------------------------------------------
  ui.blank();
  for (const r of results) {
    if (r.status === 'pass' && r.check === 'lint') {
      if (r.grandfathered) ui.warn(`eslint: ${r.grandfathered} grandfathered finding${r.grandfathered === 1 ? '' : 's'}`);
      ui.ok('no new lint findings');
    } else if (r.status === 'fail' && r.check === 'lint') {
      ui.fail(`eslint: ${r.newFindings} new, ${r.increased} increased`);
    } else if (r.status === 'stale-artifact') {
      ui.warn(`${r.check} — not run: stale build artifacts`);
      ui.detail(r.detail);
    } else if (r.status === 'pass') {
      ui.ok(r.check);
    } else {
      ui.fail(r.check);
      if (r.detail) ui.detail(r.detail);
    }
  }

  if (cmp?.regressed) {
    ui.blank();
    ui.plain(`  ${paint.bold('New lint findings — these are yours to fix:')}`);
    for (const g of cmp.isNew) ui.plain(`    ${line(g)}`);
    for (const g of cmp.increased) ui.plain(`    ${line(g)} ${paint.grey(`(baseline accepts ${g.accepted})`)}`);
    ui.blank();
    ui.plain(paint.grey('  Fix the change. Do not widen the baseline to make it pass.'));
  }

  if (cmp && (cmp.resolved.length || cmp.reduced.length)) {
    ui.blank();
    ui.ok(`${cmp.resolved.length + cmp.reduced.length} baselined finding(s) improved — run \`friday quality baseline --shrink\``);
  }

  if (notRun.length) {
    ui.blank();
    ui.plain(paint.grey(`  NOT COVERED by this gate (designed, not built): ${notRun.join(', ')}`));
  }

  ui.blank();
  ui.rule();
  ui.blank();
  ui.plain(failed ? `  ${paint.red('FAIL')}` : `  ${paint.green('PASS')} — no regression from baseline`);
  ui.blank();
  return failed ? 1 : 0;
}

export async function qualityBaseline(args = []) {
  const lint = await lintFindings();
  if (!lint.ok) {
    ui.fail(`Could not run ESLint: ${lint.reason}`);
    return 1;
  }
  const groups = group(lint.findings);
  const baseline = loadBaseline();
  const cmp = compare(groups, baseline);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ baseline: baseline.eslint || [], comparison: cmp }, null, 2));
    return 0;
  }

  ui.title('friday quality baseline');

  // --- shrink: always safe, always allowed ---------------------------------
  if (args.includes('--shrink')) {
    if (!cmp.resolved.length && !cmp.reduced.length) {
      ui.ok('Nothing to shrink — the baseline already matches reality.');
      ui.blank();
      return 0;
    }
    const kept = toEntries(groups).filter((e) =>
      [...groups.keys()].includes(`${e.file} :: ${e.rule}`),
    );
    // Only ever write identities that still occur, at their current counts.
    saveBaseline({ ...baseline, eslint: kept.filter((e) => !cmp.isNew.some((n) => n.file === e.file && n.rule === e.rule)) });
    for (const r of cmp.resolved) ui.ok(`resolved: ${r.file} ${paint.grey(r.rule)}`);
    for (const r of cmp.reduced) ui.ok(`reduced:  ${r.file} ${paint.grey(r.rule)} ${r.accepted} -> ${r.count}`);
    ui.blank();
    ui.plain('  Baseline shrunk.');
    ui.blank();
    return 0;
  }

  // --- expand: deliberate, and it says so ----------------------------------
  if (args.includes('--accept-new-debt')) {
    if (!cmp.isNew.length && !cmp.increased.length) {
      ui.ok('Nothing new to accept.');
      ui.blank();
      return 0;
    }
    const confirm = args[args.indexOf('--accept-new-debt') + 1];
    if (confirm !== 'ACCEPT') {
      ui.fail('Expanding the baseline is a deliberate act.');
      ui.blank();
      ui.plain('  It would grandfather these findings, permanently, until removed:');
      for (const g of [...cmp.isNew, ...cmp.increased]) ui.plain(`    ${line(g)}`);
      ui.blank();
      ui.plain('  If this is your own new code, fix it instead.');
      ui.plain(`  If it is genuinely pre-existing debt:  ${paint.blue('friday quality baseline --accept-new-debt ACCEPT')}`);
      ui.blank();
      return 1;
    }
    saveBaseline({ ...baseline, eslint: toEntries(groups) });
    ui.warn(`Baseline expanded by ${cmp.isNew.length + cmp.increased.length} finding(s).`);
    ui.blank();
    return 0;
  }

  // --- default: report ------------------------------------------------------
  const entries = baseline.eslint || [];
  ui.plain(paint.grey(`  ${entries.length} accepted finding${entries.length === 1 ? '' : 's'}`));
  ui.blank();
  for (const e of entries) {
    const stillThere = groups.has(`${e.file} :: ${e.rule}`);
    (stillThere ? ui.info : ui.ok)(`${e.file}  ${paint.grey(e.rule)}${e.count > 1 ? paint.grey(` x${e.count}`) : ''}${stillThere ? '' : '  (resolved)'}`);
  }

  if (cmp.isNew.length || cmp.increased.length) {
    ui.blank();
    ui.fail(`${cmp.isNew.length + cmp.increased.length} finding(s) NOT in the baseline:`);
    for (const g of [...cmp.isNew, ...cmp.increased]) ui.detail(line(g));
  }
  if (cmp.resolved.length || cmp.reduced.length) {
    ui.blank();
    ui.ok(`${cmp.resolved.length + cmp.reduced.length} improved — \`friday quality baseline --shrink\``);
  }
  ui.blank();
  return 0;
}
