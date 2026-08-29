/**
 * Loads friday.config.mjs and the refs file, and reports what is wrong with
 * them rather than throwing.
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROOT, path, readJSON } from './repo.mjs';

export async function loadConfig() {
  const p = path('friday.config.mjs');
  if (!existsSync(p)) {
    return { ok: false, reason: 'friday.config.mjs is missing from the repo root.' };
  }
  try {
    const mod = await import(pathToFileURL(p).href);
    return { ok: true, config: mod.default };
  } catch (err) {
    return { ok: false, reason: `friday.config.mjs could not be read: ${err.message}` };
  }
}

/**
 * The refs file, with the "is it actually usable" question answered separately
 * from "does it parse". A file full of nulls parses fine and is still useless.
 */
export function loadRefs(config) {
  const rel = config?.refsFile || 'supabase/refs.json';
  const raw = readJSON(rel);

  if (raw === null) return { ok: false, missing: true, rel, environments: [] };
  if (raw.__parseError) return { ok: false, parseError: true, rel, environments: [] };

  const envs = Object.entries(raw.environments || {}).map(([key, v]) => ({
    key,
    ref: v.ref,
    displayName: v.displayName || key,
    isProduction: Boolean(v.isProduction),
    githubSecret: v.githubSecret || null,
    hint: v._hint || null,
  }));

  const unset = envs.filter((e) => !e.ref);
  return { ok: unset.length === 0 && envs.length > 0, rel, environments: envs, unset };
}

export { ROOT };
