/**
 * Subprocess helpers.
 *
 * Nothing here throws on a non-zero exit — a failing command is data, not an
 * exception. Callers decide what a failure means.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

/** Run a command, capture its output, never throw. */
export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    // A missing binary arrives as an error event, not an exit code.
    child.on('error', (err) =>
      resolve({ ok: false, code: 127, stdout: '', stderr: String(err.message), missing: true }),
    );

    child.on('close', (code) =>
      resolve({
        ok: code === 0,
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        missing: false,
      }),
    );
  });
}

/** Run a command with its output going straight to the terminal. */
export function runLive(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: 'inherit',
    });
    child.on('error', () => resolve({ ok: false, code: 127, missing: true }));
    child.on('close', (code) => resolve({ ok: code === 0, code: code ?? 1, missing: false }));
  });
}

/** Is this binary on PATH at all? */
export async function has(cmd) {
  const r = await run('/usr/bin/which', [cmd]);
  return r.ok;
}
