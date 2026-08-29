/**
 * friday check — the front door.
 *
 * Answers two different questions that a non-engineer will not distinguish
 * between, and should not have to:
 *
 *   is my MACHINE set up?   tools, secrets, project config
 *   is my CODE OK?          lint, types, unit tests
 *
 * It ends with exactly ONE next action. That is the whole point of the command:
 * a report tells you there are eleven problems, which is not actionable when
 * you do not know which one causes the other ten. So every failure carries a
 * priority, and only the most upstream one is offered.
 *
 * Read-only. Nothing here writes, deploys, or decrypts a secret.
 */
import { ui, paint } from '../ui.mjs';
import { run, runLive, has } from '../exec.mjs';
import { ROOT, gitState, readText } from '../repo.mjs';
import { loadRefs } from '../config.mjs';
import { PROJECT } from '../project.mjs';
import { TOOLS } from '../toolchain.mjs';
import { SCRIPTS, FAST_CHECKS } from './quality.mjs';
import { REGISTRY, DELEGATED, resolve, howToSet } from '../secrets.mjs';

// Lower number = more upstream = offered first.
const P = { TOOL: 10, SECRET: 20, PROJECT: 30, CODE: 40, HYGIENE: 50 };

export async function check(args = []) {
  const quick = args.includes('--quick') || args.includes('-q');
  const findings = [];
  const note = (f) => findings.push(f);

  ui.title(`friday check`);
  ui.plain(paint.grey(`  ${ROOT}`));

  await checkMachine(note);
  await checkSecrets(note);
  checkProject(note);
  await checkRepo(note);

  if (quick) {
    ui.section('code');
    ui.info('skipped (--quick)');
  } else {
    await checkCode(note);
  }

  return summarise(findings);
}

async function checkMachine(note) {
  ui.section('machine');

  // Node's version is pinned by .nvmrc; a mismatch is the cause of a whole
  // class of "works for Rocky, not for me" problems, so it is worth naming.
  const pinned = (readText('.nvmrc') || '').trim();
  const running = process.versions.node;
  const runningMajor = running.split('.')[0];

  if (pinned && runningMajor !== pinned) {
    ui.warn(`Node ${running} — this repo pins ${pinned}`);
    ui.detail('Usually harmless, but it is the first thing to suspect if a build behaves oddly.');
    note({ level: 'warn', priority: P.HYGIENE, headline: `Switch to Node ${pinned}`, command: 'nvm use' });
  } else {
    ui.ok(`Node ${running}`);
  }

  for (const tool of TOOLS) {
    if (tool.bin === 'node') continue; // already reported, with more detail
    if (await has(tool.bin)) {
      ui.ok(tool.label);
    } else {
      ui.fail(`${tool.label} — not installed`);
      ui.detail(tool.why);
      note({
        level: 'fail',
        priority: P.TOOL,
        headline: `Install the ${tool.label}`,
        command: tool.install,
      });
    }
  }
}

async function checkSecrets(note) {
  ui.section('secrets');

  for (const entry of REGISTRY) {
    // Presence only — see keychain.mjs for why this must not decrypt.
    const r = await resolve(entry);

    if (!r.found) {
      const line = entry.required ? ui.fail : ui.warn;
      line(`${entry.name} — not set`);
      ui.detail(entry.summary);
      if (entry.where) ui.detail(`Get one at ${entry.where}`);
      note({
        level: entry.required ? 'fail' : 'warn',
        priority: P.SECRET,
        headline: `Set ${entry.name}`,
        command: howToSet(entry),
      });
      continue;
    }

    if (r.problem) {
      ui.fail(`${entry.name} — found in ${r.detail}, but it looks wrong`);
      ui.detail(r.problem);
      note({ level: 'fail', priority: P.SECRET, headline: `Replace ${entry.name}`, command: howToSet(entry) });
      continue;
    }

    ui.ok(`${entry.name} ${paint.grey(`(from ${r.detail})`)}`);
  }

  for (const d of DELEGATED) {
    const ok = await d.check().catch(() => false);
    if (ok) {
      ui.ok(`${d.name} ${paint.grey(`(handled by ${d.ownedBy})`)}`);
    } else {
      ui.fail(`${d.name} — not signed in`);
      ui.detail(d.summary);
      note({ level: 'fail', priority: P.SECRET, headline: `Sign in to ${d.name}`, command: d.fix });
    }
  }
}

function checkProject(note) {
  ui.section('project');

  const refs = loadRefs();

  if (refs.missing) {
    ui.fail(`${refs.rel} — missing`);
    note({ level: 'fail', priority: P.PROJECT, headline: `Create ${refs.rel}` });
    return;
  }
  if (refs.parseError) {
    ui.fail(`${refs.rel} — is not valid JSON`);
    note({ level: 'fail', priority: P.PROJECT, headline: `Fix the JSON in ${refs.rel}` });
    return;
  }

  for (const env of refs.environments) {
    if (env.ref) {
      ui.ok(`${env.displayName} ${paint.grey(env.ref)}`);
    } else {
      ui.fail(`${env.displayName} — no project ref yet`);
      if (env.hint) ui.detail(env.hint);
    }
  }

  if (refs.unset?.length) {
    ui.detail('friday will not touch a database until it can tell these apart.');
    note({
      level: 'fail',
      priority: P.PROJECT,
      headline: `Fill in the project ref${refs.unset.length > 1 ? 's' : ''} in ${refs.rel}`,
    });
  }
}

async function checkRepo(note) {
  ui.section('repo');
  const g = await gitState();

  if (!g.isRepo) {
    ui.fail('This is not a git repository.');
    note({ level: 'fail', priority: P.TOOL, headline: 'Run friday from inside the 10q-app repo' });
    return;
  }

  ui.ok(`on ${g.branch}`);

  if (!g.clean) {
    ui.warn(`${g.dirtyCount} file${g.dirtyCount === 1 ? '' : 's'} changed but not committed`);
  }

  if (g.hasUpstream) {
    if (g.behind > 0) {
      ui.warn(`${g.behind} commit${g.behind === 1 ? '' : 's'} behind origin`);
      note({ level: 'warn', priority: P.HYGIENE, headline: 'Pull the latest changes', command: 'git pull' });
    } else if (g.ahead > 0) {
      ui.info(`${g.ahead} commit${g.ahead === 1 ? '' : 's'} not pushed yet`);
    } else {
      ui.ok('up to date with origin');
    }
  } else {
    ui.info('this branch is not tracking a remote yet');
  }
}

async function checkCode(note) {
  ui.section('code');
  ui.info('running lint, types and tests — this takes a minute');

  // Same definitions `friday quality *` uses — one source of truth per check.
  for (const path of FAST_CHECKS) {
    const spec = SCRIPTS[path];
    const [cmd, ...rest] = spec.argv;
    const r = await run(cmd, rest, { cwd: ROOT });
    if (r.ok) {
      ui.ok(spec.label);
    } else {
      ui.fail(`${spec.label} — failed`);
      note({
        level: 'fail',
        priority: P.CODE,
        // Point at the primitive: it shows the real output, not a summary line.
        headline: `${spec.label} is failing. Run it to see why`,
        command: `friday ${path.replace('.', ' ')}`,
      });
    }
  }
}

function summarise(findings) {
  const fails = findings.filter((f) => f.level === 'fail');
  const warns = findings.filter((f) => f.level === 'warn');

  ui.blank();
  ui.rule();

  if (!fails.length && !warns.length) {
    ui.blank();
    ui.plain(`  ${paint.green('Everything is OK.')}`);
    ui.blank();
    return 0;
  }

  if (!fails.length) {
    ui.blank();
    ui.plain(`  ${paint.yellow('Nothing is broken.')} ${warns.length} thing${warns.length === 1 ? '' : 's'} worth a look.`);
    const first = warns.sort((a, b) => a.priority - b.priority)[0];
    ui.nextAction(first.headline, first.command);
    ui.blank();
    return 0;
  }

  // Only the most upstream failure is offered. Fixing it often clears the rest.
  const first = fails.sort((a, b) => a.priority - b.priority)[0];
  const others = fails.length - 1;

  ui.blank();
  ui.plain(
    `  ${paint.red(`${fails.length} problem${fails.length === 1 ? '' : 's'}.`)}` +
      (others ? paint.grey(`  Start with this one; it may be causing the other ${others}.`) : ''),
  );
  ui.nextAction(first.headline, first.command);
  ui.blank();
  return 1;
}
