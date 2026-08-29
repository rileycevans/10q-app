/**
 * friday secrets list — where every secret resolves from.
 *
 * Presence and source only. This never decrypts and never prints a value, so it
 * is safe to run anywhere and cannot trigger a Keychain permission dialog.
 */
import { ui, paint } from '../ui.mjs';
import { REGISTRY, DELEGATED, resolve, howToSet } from '../secrets.mjs';

export async function secretsList() {
  ui.title('friday secrets list');
  ui.plain(paint.grey('  Presence and source only. No value is ever read or printed.'));
  ui.blank();

  for (const e of REGISTRY) {
    const r = await resolve(e);
    if (r.found) {
      ui.ok(`${e.name} ${paint.grey(`— ${r.detail}`)}`);
    } else {
      (e.required ? ui.fail : ui.warn)(`${e.name} — not set`);
      ui.detail(e.summary);
      if (e.where) ui.detail(`Get one at ${e.where}`);
      ui.detail(howToSet(e));
    }
  }

  for (const d of DELEGATED) {
    const ok = await d.check().catch(() => false);
    ok
      ? ui.ok(`${d.name} ${paint.grey(`— delegated to ${d.ownedBy}`)}`)
      : ui.fail(`${d.name} — not signed in · ${d.fix}`);
  }

  ui.blank();
  ui.plain(paint.grey('  Friday deliberately holds no production database password.'));
  ui.plain(paint.grey('  Production writes go through CI, where those credentials already live.'));
  ui.blank();
  return 0;
}
