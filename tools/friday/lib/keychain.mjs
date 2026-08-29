/**
 * macOS Keychain, via /usr/bin/security.
 *
 * THE IMPORTANT PART is the split between exists() and read():
 *
 *   exists()  runs `find-generic-password` WITHOUT -w. That returns the item's
 *             metadata and never decrypts the secret, so macOS does not show an
 *             "allow access?" dialog.
 *   read()    runs it WITH -w, which decrypts, which may prompt.
 *
 * `friday check` inspects every secret it knows about. If checking presence
 * decrypted them, a health check would turn into a wall of permission dialogs
 * and Riley would learn to click Deny. So check() only ever calls exists().
 */
import { run } from './exec.mjs';

const SECURITY = '/usr/bin/security';

/** True if the item is in the Keychain. Never decrypts, never prompts. */
export async function exists({ service, account }) {
  const r = await run(SECURITY, ['find-generic-password', '-s', service, '-a', account]);
  return r.ok;
}

/** The secret itself. May prompt for permission the first time. */
export async function read({ service, account }) {
  const r = await run(SECURITY, ['find-generic-password', '-s', service, '-a', account, '-w']);
  return r.ok ? r.stdout : null;
}

/**
 * Store a secret. Deliberately not wired to any command yet: writing secrets is
 * `friday secret set`, which is not built. Here so the storage half is complete
 * and testable.
 */
export async function write({ service, account, value, label }) {
  const r = await run(SECURITY, [
    'add-generic-password',
    '-s', service,
    '-a', account,
    '-l', label || service,
    '-w', value,
    '-U', // update if it already exists rather than failing
  ]);
  return r.ok;
}

/** The command a human would run to set this themselves. Never includes a value. */
export function setCommand({ service, account }) {
  return `security add-generic-password -s ${service} -a ${account} -U -w`;
}
