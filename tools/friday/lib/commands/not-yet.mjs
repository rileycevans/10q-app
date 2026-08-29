/**
 * The honest response for a designed-but-unbuilt capability.
 *
 * Two traps this avoids:
 *
 *   1. Exiting 0. A command that fails because it is unimplemented would then
 *      be indistinguishable from one that succeeded — the trap
 *      scripts/release/* already sets.
 *   2. Reading as a dead end. The correct response to a planned capability is
 *      to BUILD it, not to reach for an ad hoc shell command that bypasses
 *      every invariant Friday exists to enforce. So it says so.
 */
import { ui, paint } from '../ui.mjs';

export function notYet(capability) {
  const name = capability.path.replace(/\./g, ' ');

  ui.title(`friday ${name}`);
  ui.blank();
  ui.plain(`  ${paint.yellow('Designed, but not built yet. Nothing happened.')}`);
  ui.blank();
  ui.plain(`  ${paint.bold('It will:')} ${capability.summary}`);
  if (capability.blockedBy) ui.plain(`  ${paint.bold('Blocked:')} ${capability.blockedBy}`);
  ui.blank();

  if (capability.surface === 'workflow') {
    ui.plain(paint.grey('  What exists today:  friday check'));
  } else {
    ui.plain(paint.grey('  Implementing this in Friday is the next development task.'));
    ui.plain(paint.grey('  Do not route around Friday with an ad hoc shell command — the'));
    ui.plain(paint.grey('  invariants it enforces are the reason it exists.'));
    ui.blank();
    ui.plain(paint.grey('  See tools/friday/capabilities.json and docs/friday/PLAN.md'));
  }
  ui.blank();
  return 2;
}
