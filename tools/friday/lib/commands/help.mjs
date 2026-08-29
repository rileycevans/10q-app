import { ui, paint } from '../ui.mjs';

export function help(_args = [], commands = {}) {
  ui.title('friday');
  ui.plain(paint.grey('  The one tool for working on 10Q.'));
  ui.blank();

  const width = Math.max(...Object.keys(commands).map((k) => k.length));

  for (const [name, cmd] of Object.entries(commands)) {
    const pad = name.padEnd(width);
    const tag = cmd.planned ? paint.grey('  (not built yet)') : '';
    ui.plain(`  ${paint.blue(pad)}  ${cmd.blurb}${tag}`);
  }

  ui.blank();
  ui.plain(paint.grey('  Start with:  friday check'));
  ui.plain(paint.grey('  Plan:        docs/friday/PLAN.md'));
  ui.blank();
  return 0;
}
