/**
 * friday capabilities — what Friday is designed to do, and what is built.
 *
 * Exists so that "is this capability real?" is answerable without reading
 * source or trusting prose. A skill can describe the whole target architecture
 * without misleading anyone, because this is where the truth lives.
 */
import { ui, paint } from '../ui.mjs';
import { all, workflows, byNamespace, integrity } from '../capabilities.mjs';
import { HANDLER_PATHS } from '../handlers.mjs';

const mark = (c) => (c.status === 'implemented' ? paint.green('✓') : paint.grey('○'));
const display = (p) => p.replace(/\./g, ' ');

export function capabilities(args = []) {
  const jsonOut = args.includes('--json');
  if (jsonOut) {
    console.log(JSON.stringify({ capabilities: all(), integrity: integrity(HANDLER_PATHS) }, null, 2));
    return 0;
  }

  const plannedOnly = args.includes('--planned');
  const show = (c) => !plannedOnly || c.status === 'planned';

  ui.title('Friday capabilities');
  ui.plain(paint.grey('  ✓ built    ○ designed, not built yet'));

  ui.section("what riley uses");
  for (const c of workflows().filter(show)) {
    ui.plain(`  ${mark(c)} ${paint.blue(display(c.path).padEnd(18))} ${paint.grey(c.riley || c.summary)}`);
  }

  ui.section('the engine — for agents, and for the workflows above');
  for (const [ns, caps] of byNamespace()) {
    const visible = caps.filter(show);
    if (!visible.length) continue;
    ui.plain('');
    ui.plain(`  ${paint.bold(ns)}`);
    for (const c of visible) {
      ui.plain(`    ${mark(c)} ${paint.blue(display(c.path).padEnd(26))} ${paint.grey(c.summary)}`);
    }
  }

  const counts = all().reduce((a, c) => ((a[c.status] = (a[c.status] || 0) + 1), a), {});
  ui.blank();
  ui.rule();
  ui.plain(`  ${counts.implemented || 0} built, ${counts.planned || 0} designed.`);

  // A planned capability is a development task, not a dead end. Say so, because
  // the alternative an agent reaches for is an ad hoc shell command that
  // bypasses every invariant Friday exists to enforce.
  ui.blank();
  ui.plain(paint.grey('  Need one that is not built? Implementing it in Friday is the next task —'));
  ui.plain(paint.grey('  do not route around Friday with an ad hoc shell command.'));

  const bad = integrity(HANDLER_PATHS);
  if (bad.lying.length || bad.undeclared.length) {
    ui.blank();
    ui.fail('This registry disagrees with the code. That is a bug in Friday:');
    for (const p of bad.lying) ui.detail(`${display(p)} claims to be built, but nothing implements it`);
    for (const p of bad.undeclared) ui.detail(`${display(p)} is implemented but missing from capabilities.json`);
    ui.blank();
    return 1;
  }

  ui.blank();
  return 0;
}
