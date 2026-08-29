/**
 * The refs file: which Supabase project is staging, and which is production.
 *
 * This is DATA, not configuration — CI reads the same file — so it stays JSON
 * next to what it describes. Friday's own repo facts live in project.mjs; see
 * the note there about when a general config file becomes worth introducing.
 *
 * Reports what is wrong rather than throwing, because "both refs are empty" is
 * a thing `friday check` must be able to say in a sentence.
 */
import { PROJECT } from './project.mjs';
import { readJSON } from './repo.mjs';

export function loadRefs() {
  const rel = PROJECT.refsFile;
  const raw = readJSON(rel);

  if (raw === null) return { ok: false, missing: true, rel, environments: [] };
  if (raw.__parseError) return { ok: false, parseError: true, rel, environments: [] };

  const environments = Object.entries(raw.environments || {}).map(([key, v]) => ({
    key,
    ref: v.ref,
    displayName: v.displayName || key,
    isProduction: Boolean(v.isProduction),
    githubSecret: v.githubSecret || null,
    hint: v._hint || null,
  }));

  const unset = environments.filter((e) => !e.ref);
  return { ok: unset.length === 0 && environments.length > 0, rel, environments, unset };
}
