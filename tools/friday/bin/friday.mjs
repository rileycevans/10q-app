#!/usr/bin/env node
/**
 * friday — entry point.
 *
 * Dispatch only. Every command lives in lib/commands/ and returns an exit code;
 * nothing here knows what any of them do.
 */
import process from 'node:process';
import { ui } from '../lib/ui.mjs';
import { help } from '../lib/commands/help.mjs';
import { check } from '../lib/commands/check.mjs';
import { notYet } from '../lib/commands/not-yet.mjs';

// Commands that exist. Anything listed as `planned` prints what it WILL do and
// exits non-zero, so an unbuilt command can never be mistaken for a passing one.
const COMMANDS = {
  check: { run: check, blurb: 'Is everything OK? Checks your machine and your code.' },
  fix: { planned: true, blurb: 'Format and auto-fix what can be fixed.' },
  preview: { planned: true, blurb: 'Run the app locally and open it.' },
  ship: { planned: true, blurb: 'Ship to staging, or to production behind the gate.' },
  undo: { planned: true, blurb: 'Show how to undo the last production ship.' },
  help: { run: help, blurb: 'Show this.' },
};

async function main(argv) {
  const [name, ...rest] = argv;

  if (!name || name === '--help' || name === '-h') return help([], COMMANDS);
  if (name === '--version' || name === '-v') {
    ui.plain('friday 0.1.0 (preview)');
    return 0;
  }

  const cmd = COMMANDS[name];
  if (!cmd) {
    ui.fail(`There is no \`friday ${name}\` command.`);
    help([], COMMANDS);
    return 1;
  }

  if (cmd.planned) return notYet(name, cmd.blurb);
  return cmd.run(rest, COMMANDS);
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
