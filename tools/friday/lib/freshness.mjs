/**
 * Is the Friday that just ran the Friday that is on disk?
 *
 * WHY THIS FILE EXISTS
 *
 * The worst possible failure for a tool like this is silent staleness: an agent
 * edits a Friday command, runs `friday`, sees the OLD behaviour, and concludes
 * the change did not work — or worse, concludes it DID work when it never ran.
 * Every subsequent decision is then made on a false premise.
 *
 * Friday is plain Node ESM with zero dependencies, so today the answer is
 * structurally yes: `friday` execs the .mjs files directly. There is no cache,
 * no build output and no binary that could lag behind the source. Editing
 * lib/ and running `friday` again is the entire update mechanism.
 *
 * That is a STRONGER guarantee than checksum-and-rebuild, which can still serve
 * a stale binary when a build fails. But it is also a fragile one: it holds only
 * as long as nobody introduces a build step or a dependency. So rather than
 * leaving it as an accident, this module:
 *
 *   1. states the mode explicitly, so an agent can verify rather than assume
 *   2. fingerprints the source, so "which Friday ran" is answerable
 *   3. GUARDS the invariant, and shouts if anything appears that would break it
 *
 * If Friday ever does need a build, this is where the checksum comparison goes,
 * and `tools/friday/friday` gains the rebuild. The contract this file reports
 * must not change: running Friday always runs the source you can see.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const FRIDAY_DIR = new URL('..', import.meta.url).pathname;

/** Every file that makes up Friday, path-sorted so the hash is stable. */
function sourceFiles(dir = FRIDAY_DIR, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.(mjs|json)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/**
 * Things that, if they existed, would mean the source is no longer
 * self-evidently what runs. None of these exist today; each is a specific way
 * the guarantee could be lost.
 */
const HAZARDS = [
  { path: 'node_modules', why: 'Friday has taken on a dependency, so it now needs installing before it runs.' },
  { path: 'dist', why: 'A build output exists, so the source may no longer be what executes.' },
  { path: 'build', why: 'A build output exists, so the source may no longer be what executes.' },
  { path: '.friday', why: 'A build cache exists. Whatever writes it must verify the checksum before exec.' },
];

export function freshness() {
  const files = sourceFiles();
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(relative(FRIDAY_DIR, f));
    hash.update(readFileSync(f));
  }
  const fingerprint = hash.digest('hex').slice(0, 12);

  const hazards = HAZARDS.filter((h) => existsSync(join(FRIDAY_DIR, h.path)));

  // A package.json is only a hazard if it actually declares dependencies.
  const pkgPath = join(FRIDAY_DIR, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (Object.keys(deps).length) {
        hazards.push({
          path: 'package.json',
          why: `Friday now depends on ${Object.keys(deps).join(', ')}, so it needs installing before it runs.`,
        });
      }
    } catch {
      /* an unreadable package.json is a different problem; doctor reports it elsewhere */
    }
  }

  const newest = files.reduce((max, f) => Math.max(max, statSync(f).mtimeMs), 0);

  return {
    mode: hazards.length ? 'unknown' : 'source',
    guaranteed: hazards.length === 0,
    fingerprint,
    fileCount: files.length,
    lastEdited: new Date(newest),
    hazards,
  };
}

/** The one sentence an agent needs. */
export function freshnessStatement(f = freshness()) {
  return f.guaranteed
    ? 'Friday runs directly from source. There is no build and no cache, so the code you just edited is the code that just ran.'
    : 'Friday can no longer prove that the source on disk is what runs. Fix this before trusting any change to Friday.';
}
