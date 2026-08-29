/**
 * The secret registry, and how a secret is resolved.
 *
 * The registry declares every secret's LOCATION and never its value. That is
 * what lets `friday check` say "you are missing X, here is where to get it"
 * instead of failing somewhere downstream with a stack trace.
 *
 * Resolution order is env var, then Keychain. friday reports which one won,
 * because "it works on my machine" is almost always an env var nobody
 * remembered was exported.
 *
 * This list is SHORT on purpose. Because production writes go through GitHub
 * Actions rather than this laptop, friday never needs a production database
 * password. If you find yourself adding one, check that decision still holds.
 */
import * as keychain from './keychain.mjs';

export const KEYCHAIN_SERVICE = '10q-friday';

export const REGISTRY = [
  {
    name: 'SUPABASE_ACCESS_TOKEN',
    summary: 'Lets the Supabase CLI read your projects',
    required: true,
    env: 'SUPABASE_ACCESS_TOKEN',
    keychain: { service: KEYCHAIN_SERVICE, account: 'supabase-access-token' },
    where: 'https://supabase.com/dashboard/account/tokens',
    // The classic mistake is grabbing a project API key instead of an account
    // token. Both look like credentials; only one authenticates to the account.
    shape: (v) =>
      v.startsWith('sbp_')
        ? null
        : 'This does not look like a personal access token (they start with sbp_). A project API key will not work here.',
  },
];

/**
 * Delegated credentials: things friday needs but deliberately does not store,
 * because another tool already owns them properly.
 */
export const DELEGATED = [
  {
    name: 'GitHub',
    summary: 'Used to read CI status and, later, to start a deploy',
    ownedBy: 'the gh CLI',
    check: async () => {
      const { run } = await import('./exec.mjs');
      const r = await run('gh', ['auth', 'status']);
      return r.ok;
    },
    fix: 'gh auth login',
  },
];

/**
 * Where does this secret's value come from? Presence-only by default so this
 * is safe to call from a health check.
 */
export async function resolve(entry, { decrypt = false } = {}) {
  const fromEnv = entry.env ? process.env[entry.env] : undefined;
  if (fromEnv) {
    return {
      found: true,
      source: 'environment',
      detail: `the ${entry.env} environment variable`,
      value: decrypt ? fromEnv : null,
      problem: entry.shape ? entry.shape(fromEnv) : null,
    };
  }

  if (entry.keychain && (await keychain.exists(entry.keychain))) {
    const value = decrypt ? await keychain.read(entry.keychain) : null;
    return {
      found: true,
      source: 'keychain',
      detail: 'your macOS Keychain',
      value,
      // Shape can only be checked when we actually decrypted it.
      problem: value && entry.shape ? entry.shape(value) : null,
    };
  }

  return { found: false, source: null, detail: null, value: null, problem: null };
}

export const howToSet = (entry) => keychain.setCommand(entry.keychain);
