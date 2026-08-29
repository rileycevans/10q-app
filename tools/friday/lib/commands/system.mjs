/**
 * friday system doctor — the diagnostic primitive.
 *
 * `friday check` answers "is everything okay" for a person. This answers
 * "what exactly is wrong with this machine" for someone who needs to tell a
 * misconfigured Mac apart from failing code. Riley should never need it;
 * an agent debugging his machine will.
 */
import { ui, paint } from '../ui.mjs';
import { has } from '../exec.mjs';
import { ROOT, readText } from '../repo.mjs';
import { loadConfig } from '../config.mjs';
import { REGISTRY, DELEGATED, resolve } from '../secrets.mjs';
import { freshness, freshnessStatement } from '../freshness.mjs';

export async function systemDoctor() {
  const { ok, config, reason } = await loadConfig();
  if (!ok) {
    ui.fail(reason);
    return 1;
  }

  ui.title('friday system doctor');

  // Friday's own integrity comes first. If an agent cannot trust that its edits
  // to Friday took effect, nothing else this command prints is worth reading.
  const f = freshness();
  ui.section('friday itself');
  if (f.guaranteed) {
    ui.ok(`runs from source — no build step, no cache`);
    ui.detail(freshnessStatement(f));
    ui.detail(`${f.fileCount} files · fingerprint ${f.fingerprint} · last edited ${f.lastEdited.toISOString()}`);
  } else {
    ui.fail('cannot prove the source on disk is what runs');
    for (const h of f.hazards) ui.detail(`${h.path}: ${h.why}`);
    ui.detail('Until this is resolved, do not trust any change made to Friday.');
  }

  ui.section('toolchain');
  const pinned = (readText('.nvmrc') || '').trim();
  const running = process.versions.node;
  if (pinned && running.split('.')[0] !== pinned) {
    ui.warn(`Node ${running} — repo pins ${pinned}`);
  } else {
    ui.ok(`Node ${running}`);
  }
  for (const t of config.tools) {
    if (t.bin === 'node') continue;
    (await has(t.bin)) ? ui.ok(t.label) : ui.fail(`${t.label} — missing (${t.why}) · ${t.install}`);
  }

  ui.section('secrets');
  for (const e of REGISTRY) {
    const r = await resolve(e); // presence only — never decrypts
    r.found ? ui.ok(`${e.name} from ${r.detail}`) : ui.fail(`${e.name} — not set`);
  }
  for (const d of DELEGATED) {
    ((await d.check().catch(() => false)) ? ui.ok : ui.fail)(`${d.name} (${d.ownedBy})`);
  }

  ui.section('repo');
  ui.info(ROOT);
  ui.blank();
  return f.guaranteed ? 0 : 1;
}
