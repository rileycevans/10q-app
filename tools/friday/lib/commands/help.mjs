/**
 * friday help — Riley's front door, and nothing else.
 *
 * The primitives are deliberately absent. Someone who needs them knows to run
 * `friday capabilities`; someone who does not should never be asked to choose
 * between `system doctor` and `backend drift` to find out if things are okay.
 */
import { ui, paint } from '../ui.mjs';
import { workflows } from '../capabilities.mjs';

export function help() {
  const ws = workflows();
  const width = Math.max(...ws.map((c) => c.path.length)) + 2;

  ui.title('friday');
  ui.plain(paint.grey('  The one tool for working on 10Q.'));
  ui.blank();

  for (const c of ws) {
    const name = c.path.replace(/\./g, ' ');
    const built = c.status === 'implemented';
    const label = built ? paint.blue(name.padEnd(width)) : paint.grey(name.padEnd(width));
    const tail = built ? '' : paint.grey('  (not built yet)');
    ui.plain(`  ${label} ${c.riley || c.summary}${tail}`);
  }

  ui.blank();
  ui.plain(paint.grey('  Not sure? Start with:  friday check'));
  ui.blank();
  ui.plain(paint.grey('  Friday has a larger engine underneath these, for agents and'));
  ui.plain(paint.grey('  specialised work:      friday capabilities'));
  ui.blank();
  return 0;
}
