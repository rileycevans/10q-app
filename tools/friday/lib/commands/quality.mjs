/**
 * friday quality * — the individual code checks, as primitives.
 *
 * `friday check` runs the fast ones and reports them as one answer. These exist
 * so an agent can run exactly one and read its real output, rather than
 * inferring from a summary line which of three things failed.
 */
import { ui } from '../ui.mjs';
import { runLive } from '../exec.mjs';
import { ROOT } from '../repo.mjs';

/**
 * The single definition of what each code check IS. `friday check` runs these
 * too, so there is exactly one place that knows what "lint" means here — the
 * forked-constants problem CLAUDE.md flags about packages/contracts is not one
 * to reproduce inside Friday.
 */
export const SCRIPTS = {
  'quality.lint': { label: 'Lint', argv: ['npm', 'run', 'lint'] },
  'quality.typecheck': { label: 'Types', argv: ['npm', 'run', 'typecheck'] },
  'quality.unit': { label: 'Unit tests', argv: ['npm', 'test'] },
};

/** The fast subset `friday check` runs. Ordered cheapest-first. */
export const FAST_CHECKS = ['quality.lint', 'quality.typecheck', 'quality.unit'];

export function qualityRunner(path) {
  return async function run() {
    const spec = SCRIPTS[path];
    ui.title(`friday ${path.replace('.', ' ')}`);
    ui.plain('');
    // Output goes straight through: a primitive's job is the real output.
    const r = await runLive(spec.argv[0], spec.argv.slice(1), { cwd: ROOT });
    ui.blank();
    r.ok ? ui.ok(`${spec.label} passed`) : ui.fail(`${spec.label} failed`);
    ui.blank();
    return r.ok ? 0 : 1;
  };
}
