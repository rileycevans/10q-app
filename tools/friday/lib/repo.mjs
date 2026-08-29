/**
 * Where we are, and what git thinks of it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { run } from './exec.mjs';

/** The wrapper passes this; fall back to cwd so `node bin/friday.mjs` works too. */
export const ROOT = process.env.FRIDAY_REPO_ROOT || process.cwd();

export const path = (...parts) => join(ROOT, ...parts);

export function readJSON(rel) {
  const p = path(rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { __parseError: true };
  }
}

export function readText(rel) {
  const p = path(rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** Branch, cleanliness, and how far off origin we are. */
export async function gitState() {
  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT });
  const status = await run('git', ['status', '--porcelain'], { cwd: ROOT });
  const upstream = await run('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd: ROOT });

  let ahead = 0;
  let behind = 0;
  if (upstream.ok) {
    const counts = await run('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], { cwd: ROOT });
    if (counts.ok) {
      const [a, b] = counts.stdout.split(/\s+/).map(Number);
      ahead = a || 0;
      behind = b || 0;
    }
  }

  const dirtyFiles = status.ok && status.stdout ? status.stdout.split('\n').filter(Boolean) : [];

  return {
    isRepo: branch.ok,
    branch: branch.ok ? branch.stdout : null,
    clean: dirtyFiles.length === 0,
    dirtyCount: dirtyFiles.length,
    hasUpstream: upstream.ok,
    ahead,
    behind,
  };
}
