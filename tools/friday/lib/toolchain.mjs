/**
 * What Friday needs on the machine.
 *
 * These are FRIDAY's requirements, not the repo's configuration, which is why
 * they are source rather than config — see project.mjs.
 *
 * `why` is shown when one is missing, because "install supabase" without a
 * reason is an order rather than an explanation.
 */
export const TOOLS = [
  { bin: 'node', label: 'Node', why: 'runs the app and Friday itself', install: 'brew install node' },
  { bin: 'npm', label: 'npm', why: 'installs dependencies', install: 'comes with Node' },
  { bin: 'git', label: 'git', why: 'version control', install: 'brew install git' },
  { bin: 'gh', label: 'GitHub CLI', why: 'reads CI status and starts deploys', install: 'brew install gh' },
  { bin: 'supabase', label: 'Supabase CLI', why: 'talks to the database', install: 'brew install supabase/tap/supabase' },
];
