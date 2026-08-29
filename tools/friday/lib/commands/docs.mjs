/**
 * friday docs check — do the skills still agree with the capability registry?
 *
 * The skills describe Friday's target architecture, which is most of the point:
 * an agent reading `release ios submit` should learn it exists and is planned,
 * not be told a lie in either direction. But prose drifts, and a skill that is
 * confidently wrong about its own tool is worse than one that says nothing.
 *
 * So the part that CAN be checked is checked here: every `friday …` invocation
 * a skill mentions must resolve to a capability the registry declares. Renaming
 * a capability without updating the skills fails this, loudly.
 *
 * What this deliberately does NOT check is whether the prose is good, whether
 * the sequencing is right, or whether a skill omits something. Those need
 * judgement, and claiming to verify them would be its own kind of lie.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { ui, paint } from '../ui.mjs';
import { all } from '../capabilities.mjs';
import { path } from '../repo.mjs';

const SKILLS_DIR = '.claude/skills';

// Commands the dispatcher handles itself, so they are not registry entries.
const BUILTIN = ['help'];

/** Every `friday <words>` mention, resolved the way the dispatcher resolves argv. */
function unresolvedIn(text, known) {
  const bad = [];
  for (const m of text.matchAll(/friday ((?:[a-z][a-z-]*)(?: [a-z][a-z-]*)?(?: [a-z][a-z-]*)?)/g)) {
    const words = m[1].split(' ');
    let hit = false;
    for (let n = words.length; n > 0 && !hit; n--) {
      if (known.has(words.slice(0, n).join(' '))) hit = true;
    }
    if (!hit) bad.push(`friday ${m[1]}`);
  }
  return [...new Set(bad)];
}

export async function docsCheck(args = []) {
  const known = new Set([...all().map((c) => c.path.replace(/\./g, ' ')), ...BUILTIN]);
  const dir = path(SKILLS_DIR);

  if (!existsSync(dir)) {
    ui.warn(`${SKILLS_DIR} does not exist — nothing to check.`);
    return 0;
  }

  const problems = [];
  let checked = 0;

  for (const name of readdirSync(dir).sort()) {
    const file = path(SKILLS_DIR, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    checked++;
    const bad = unresolvedIn(readFileSync(file, 'utf8'), known);
    if (bad.length) problems.push({ skill: name, refs: bad });
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify({ checked, problems }, null, 2));
    return problems.length ? 1 : 0;
  }

  ui.title('friday docs check');
  ui.plain(paint.grey(`  ${checked} skills, against ${known.size} declared capabilities`));
  ui.blank();

  if (!problems.length) {
    ui.ok('Every command a skill mentions is a capability Friday declares.');
    ui.blank();
    return 0;
  }

  for (const p of problems) {
    ui.fail(`${p.skill} refers to commands Friday does not declare:`);
    for (const r of p.refs) ui.detail(r);
  }
  ui.blank();
  ui.plain('  Either the skill is stale, or the capability is missing from');
  ui.plain('  tools/friday/capabilities.json. Fix whichever is actually wrong.');
  ui.blank();
  return 1;
}
