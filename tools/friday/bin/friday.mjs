#!/usr/bin/env node
/**
 * friday — entry point.
 *
 * Friday has two surfaces on purpose:
 *
 *   WORKFLOWS   what Riley uses. Task-shaped, few, shown in `friday help`.
 *   PRIMITIVES  the engine. Namespaced and precise, for agents and for the
 *               workflows to orchestrate. Listed by `friday capabilities`.
 *
 * Neither is the "real" Friday. The workflows exist so a person never has to
 * choose between `system doctor` and `backend drift`; the primitives exist so
 * an agent never has to guess which of five things a workflow actually did.
 *
 * Dispatch is data-driven: capabilities.json says what exists, handlers.mjs
 * says what runs, and the two are cross-checked so they cannot drift apart.
 */
import process from 'node:process';
import { ui, paint } from '../lib/ui.mjs';
import { resolve, get } from '../lib/capabilities.mjs';
import { HANDLERS } from '../lib/handlers.mjs';
import { help } from '../lib/commands/help.mjs';
import { notYet } from '../lib/commands/not-yet.mjs';

async function main(argv) {
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    return help(argv.slice(1));
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    const { freshness } = await import('../lib/freshness.mjs');
    ui.plain(`friday 0.2.0 (preview) · source fingerprint ${freshness().fingerprint}`);
    return 0;
  }

  const { capability, rest, attempted } = resolve(argv);

  if (!capability) {
    ui.blank();
    ui.fail(`\`friday ${attempted}\` is not something Friday can do.`);
    ui.blank();
    ui.plain('  Riley\'s commands:  ' + paint.blue('friday help'));
    ui.plain('  Everything else:   ' + paint.blue('friday capabilities'));
    ui.blank();
    return 1;
  }

  if (capability.status !== 'implemented') return notYet(capability);

  const handler = HANDLERS[capability.path];
  if (!handler) {
    // capabilities.json and handlers.mjs disagree. Friday's bug, not the user's.
    ui.fail(`${capability.path} is marked implemented but has no handler.`);
    ui.detail('This is a bug in Friday. Run `friday capabilities` for the full report.');
    return 70;
  }

  return handler(rest);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    ui.fail('friday hit an error it did not expect.');
    ui.blank();
    ui.plain(String(err?.stack || err));
    ui.blank();
    ui.plain('This is a bug in friday, not something you did.');
    process.exit(70);
  });
