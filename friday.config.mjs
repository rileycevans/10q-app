/**
 * friday's configuration.
 *
 * WHY THIS IS .mjs AND NOT .yml
 * Sonnet's Friday uses friday.yml because Swift has a YAML parser to hand.
 * friday here has ZERO dependencies on purpose — that is what lets it run the
 * instant you `git pull`, with no install and no build. Parsing YAML without a
 * dependency means hand-rolling a parser, so config is a JS module instead:
 * Node reads it natively, and unlike JSON it can carry comments, which matter
 * more here than the file extension does.
 *
 * Data that OTHER tools also need (project refs, the functions manifest) lives
 * in .json next to what it describes, so a GitHub workflow can read it too.
 */
export default {
  // What the app is called when friday talks about it.
  appName: '10Q',

  // The npm workspace that holds the client. Named "web" for historical
  // reasons; it feeds web, iOS and Android. See CLAUDE.md.
  clientWorkspace: 'apps/web',

  // What `friday check` runs to check the CODE, as opposed to the machine.
  // Each is a plain npm script so there is exactly one definition of "lint".
  codeChecks: [
    { id: 'lint', label: 'Lint', argv: ['npm', 'run', 'lint'] },
    { id: 'types', label: 'Types', argv: ['npm', 'run', 'typecheck'] },
    { id: 'tests', label: 'Unit tests', argv: ['npm', 'test'] },
  ],

  // Tools friday expects on the machine. `why` is shown when one is missing,
  // because "install supabase" without a reason is just an order.
  tools: [
    { bin: 'node', label: 'Node', why: 'runs the app and friday itself', install: 'brew install node' },
    { bin: 'npm', label: 'npm', why: 'installs dependencies', install: 'comes with Node' },
    { bin: 'git', label: 'git', why: 'version control', install: 'brew install git' },
    { bin: 'gh', label: 'GitHub CLI', why: 'reads CI status and starts deploys', install: 'brew install gh' },
    { bin: 'supabase', label: 'Supabase CLI', why: 'talks to the database', install: 'brew install supabase/tap/supabase' },
  ],

  // Where the project refs live. Committed data, shared with CI.
  refsFile: 'supabase/refs.json',
};
