/**
 * Output primitives.
 *
 * Everything friday prints goes through here, so tone and layout stay
 * consistent and so colour can be turned off in one place.
 *
 * Rule of thumb for the wording: assume the reader knows the app but not the
 * plumbing. "Your database is not reachable" beats "ECONNREFUSED 5432".
 */
import process from 'node:process';

// NO_COLOR is a de-facto standard; respect it, and never colour a pipe.
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const ESC = '\x1b[';
const c = (code) => (s) => (useColour ? `${ESC}${code}m${s}${ESC}0m` : String(s));

export const paint = {
  bold: c('1'),
  dim: c('2'),
  red: c('31'),
  green: c('32'),
  yellow: c('33'),
  blue: c('34'),
  grey: c('90'),
};

// Symbols, not emoji: they align in a terminal and survive copy-paste.
export const MARK = { ok: '+', warn: '!', bad: 'x', info: '-' };

export const ui = {
  plain: (s = '') => console.log(s),
  blank: () => console.log(''),

  title: (s) => {
    console.log('');
    console.log(paint.bold(s));
  },

  section: (s) => {
    console.log('');
    console.log(paint.grey(s.toUpperCase()));
  },

  ok: (s) => console.log(`  ${paint.green(MARK.ok)} ${s}`),
  warn: (s) => console.log(`  ${paint.yellow(MARK.warn)} ${s}`),
  fail: (s) => console.log(`  ${paint.red(MARK.bad)} ${s}`),
  info: (s) => console.log(`  ${paint.grey(MARK.info)} ${s}`),

  // Secondary line under a result: the detail, indented and quiet.
  detail: (s) => console.log(`    ${paint.grey(s)}`),

  rule: () => console.log(paint.grey('  ' + '-'.repeat(56))),

  /**
   * The single next action. This is the most important thing friday prints:
   * for a non-engineer, "what do I do now" must never require reading a report.
   */
  nextAction: (headline, command) => {
    console.log('');
    console.log(`  ${paint.bold('Do this next:')} ${headline}`);
    if (command) console.log(`  ${paint.blue('$ ' + command)}`);
  },
};
