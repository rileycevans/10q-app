# friday — designed, and built

`friday` is the one tool for working on 10Q. It has **two surfaces**, and the
distinction is the whole design:

| Surface | Who | Shape |
|---|---|---|
| **Workflows** | Riley | Task-shaped, few. `friday help` shows these and nothing else. |
| **Primitives** | Agents, and the workflows | Namespaced and precise. `friday capabilities` lists them. |

Riley says *"is everything okay"* and gets one answer. An agent that needs to
tell a misconfigured Mac from failing type checks reaches past the workflow for
`friday system doctor`. Both are correct; neither is the real Friday.

## The registry is the source of truth

`tools/friday/capabilities.json` declares every capability and whether it is
`implemented` or `planned`. Skills, `CLAUDE.md` and the CLI all read it, so
there is exactly one place that knows what exists.

```bash
friday capabilities            # ✓ built / ○ designed
friday capabilities --planned  # just what is left
friday capabilities --json     # machine-readable
```

**Most of Friday is designed and not yet built. That is intended.** The target
architecture is the thing being committed to; today's CLI is a checkpoint
against it. Do not shrink the design to match the implementation.

> **The rule for agents.** If you need a capability that is planned but not
> implemented, **implementing it in Friday is the next development task**. Do
> not permanently route around Friday with an ad hoc shell command — the
> invariants Friday enforces are the reason it exists.

The registry is cross-checked against the handler table every run. A capability
claiming to be built with nothing implementing it, or an implementation missing
from the registry, is reported as a bug in Friday. This is the same drift class
that left three Edge Functions undeployed for weeks; Friday should not repeat it
about itself.

## Built today

```
✓ check              the workflow: machine, secrets, config, repo, code
✓ capabilities       what is designed, what is built
✓ system doctor      diagnosis, including Friday's own freshness
✓ quality lint · quality typecheck · quality unit
✓ secrets list       where each secret resolves from, never its value
✓ docs check         fails if a skill names a capability Friday does not declare
```

Plus the wrapper, the Keychain layer, the secret registry, and
`supabase/refs.json` — **scaffolded with both refs `null`** until someone
confirms in the dashboard which project is which.

## Your edits to Friday always take effect

Friday is plain Node ESM with **zero dependencies and no build step**, so
`friday` execs the source directly. The file you just edited is the code that
just ran. There is no cache, no binary, and therefore no state in which a stale
Friday can run.

This is stronger than checksum-and-rebuild, which can still serve a stale binary
when a build fails — but it holds only while Friday stays dependency-free.
`friday system doctor` prints the mode and a source fingerprint, and fails
loudly if a `node_modules`, a build output, or a dependency ever appears. If
Friday does need a build one day, `tools/friday/friday` is where it goes, and
the contract this reports must not change.

## What comes next

**Prerequisites — data and repo changes, not CLI work.** Each is independently
worth doing:

1. **Fill in `supabase/refs.json`.** Friday will not address a database until it
   can tell staging from production. A local tool that cannot make that
   distinction is more dangerous than no tool.
2. **A functions manifest.** Both jobs in `.github/workflows/supabase.yml`
   iterate a hardcoded list of 24 Edge Functions; 27 are on disk. Replace both
   loops with one committed file Friday also reads.
3. **A formatter.** No Prettier config exists. `quality format` and `fix` both
   need one, and introducing it is a single large reformat commit — do it
   deliberately and alone.

**Then, roughly in order:** `quality gate` and the `test` workflow · `fix` and
`ship staging` · the `backend` family · `ship production`, `undo` and the
production gate · the `release` lanes.

Two constraints that do not move:

- **`ship production` runs through GitHub Actions**, not the laptop. That keeps
  production credentials off the machine and gives every deploy an audit trail.
- **`undo` prints the restore command; it never runs it.** A restore rewinds
  player data as well as schema, and in a game where each player gets one
  attempt per day, that permanently erases those players' only attempt. `undo`
  must say how many attempts a restore would discard before anyone runs it.

## Known rough edges

- **`check` can report "Types — failed" when nothing is wrong.** A stale
  `.next/` leaves generated route types referencing deleted pages. `.next/` is
  gitignored so CI never sees it; delete it and re-run.
- **No tests for Friday itself.** The Keychain split, the capability resolver
  and the integrity check are the parts worth testing first.
