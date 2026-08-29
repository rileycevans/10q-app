/**
 * The honest stub.
 *
 * There is a specific trap here, learned from scripts/release/*: a command that
 * fails because it is unimplemented looks exactly like a command that fails
 * because the user did something wrong. So this never exits 0, never pretends
 * to have done work, and says plainly that nothing happened.
 */
import { ui, paint } from '../ui.mjs';

const WHEN = {
  fix: 'Phase 05. Needs a formatter in the repo first — there is none today.',
  preview: 'Phase 05. Thin wrapper over `npm run dev`.',
  ship: 'Phase 06 for production; staging lands in Phase 05.',
  undo: 'Phase 06. Ships together with `friday ship production`, never before it.',
};

export function notYet(name, blurb) {
  ui.title(`friday ${name}`);
  ui.blank();
  ui.plain(`  ${paint.yellow('This command is not built yet. Nothing happened.')}`);
  ui.blank();
  ui.plain(`  ${paint.bold('It will:')} ${blurb}`);
  if (WHEN[name]) ui.plain(`  ${paint.bold('When:')}     ${WHEN[name]}`);
  ui.blank();
  ui.plain(paint.grey('  The full plan is in docs/friday/PLAN.md'));
  ui.blank();
  return 2;
}
