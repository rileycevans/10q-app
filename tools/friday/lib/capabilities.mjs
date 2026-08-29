/**
 * The capability registry, and how argv maps onto it.
 *
 * capabilities.json is the single source of truth for what Friday is designed
 * to do and what is built. This module reads it, resolves a command line
 * against it, and — importantly — checks the registry against the handlers
 * that actually exist.
 *
 * That last check is the same discipline the repo failed at with its hardcoded
 * Edge Function list: a description of reality drifting from reality, failing
 * silently. Friday should not repeat it about itself.
 */
import { readFileSync } from 'node:fs';

const REGISTRY = JSON.parse(
  readFileSync(new URL('../capabilities.json', import.meta.url), 'utf8'),
).capabilities;

export const all = () => Object.entries(REGISTRY).map(([path, meta]) => ({ path, ...meta }));
export const get = (path) => (REGISTRY[path] ? { path, ...REGISTRY[path] } : null);
export const isImplemented = (path) => REGISTRY[path]?.status === 'implemented';

export const workflows = () => all().filter((c) => c.surface === 'workflow');
export const primitives = () => all().filter((c) => c.surface === 'primitive');

/** Group primitives by their namespace, for display. */
export function byNamespace() {
  const groups = new Map();
  for (const c of primitives()) {
    const ns = c.path.includes('.') ? c.path.split('.')[0] : '(top level)';
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns).push(c);
  }
  return groups;
}

/**
 * Longest-prefix match of argv against the registry.
 *
 *   ["check", "--quick"]            -> check,           rest ["--quick"]
 *   ["ship", "production"]          -> ship.production, rest []
 *   ["release"]                     -> release          (the workflow)
 *   ["release", "ios", "build"]     -> release.ios.build
 */
export function resolve(argv) {
  const words = [];
  for (const a of argv) {
    if (a.startsWith('-')) break;
    words.push(a);
  }

  for (let n = words.length; n > 0; n--) {
    const path = words.slice(0, n).join('.');
    if (REGISTRY[path]) return { capability: get(path), rest: argv.slice(n) };
  }
  return { capability: null, rest: argv, attempted: words.join(' ') };
}

/**
 * Registry vs handlers, both directions. Either kind of mismatch is a bug in
 * Friday itself, not something a user did.
 */
/** Fields every capability must carry, so no capability is just a name. */
const REQUIRED_DESIGN = ['summary', 'execution', 'governedBy', 'success', 'invariant'];

export function integrity(handlerPaths) {
  const handlers = new Set(handlerPaths);
  const claimed = all().filter((c) => c.status === 'implemented').map((c) => c.path);

  // A planned capability whose entire design is its command name is useless to
  // whoever has to implement it. The registry is the design, so it must carry
  // enough to act on: what it is for, where it runs, which skill governs it,
  // what success means, and the invariant it protects.
  const underDesigned = all()
    .filter((c) => REQUIRED_DESIGN.some((f) => !c[f]))
    .map((c) => ({ path: c.path, missing: REQUIRED_DESIGN.filter((f) => !c[f]) }));

  return {
    // Registry says implemented, but nothing implements it.
    lying: claimed.filter((p) => !handlers.has(p)),
    // Something implements it, but the registry does not admit it exists.
    undeclared: [...handlers].filter((p) => !REGISTRY[p]),
    underDesigned,
  };
}
