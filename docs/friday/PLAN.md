# friday — what is built, and what is not

`friday` is the one tool for working on 10Q. The full design plan, with the
reasoning behind each decision, lives in the **Friday for 10Q** design doc.
This file is the short, current version: what exists today and what comes next.

## Built

| | |
|---|---|
| `friday check` | Machine, secrets, project config, repo state, and code. Ends with one next action. |
| `friday help` | Lists the commands. |
| The wrapper | `tools/friday/friday` — no build step, no install step; `git pull` is the whole update mechanism. |
| Keychain layer | Presence checks that never decrypt, so a health check never triggers a permission dialog. |
| Secret registry | Declares where each secret lives, never its value. |
| `supabase/refs.json` | **Scaffolded, not filled in.** Both refs are `null` until someone confirms them in the dashboard. |

## Not built

Every unbuilt command prints what it will do and exits non-zero. None of them
pretend to succeed.

### Phase 04 — prerequisites, before any more commands

These are data and repo changes, not CLI work, and each is independently worth
doing:

1. **Fill in `supabase/refs.json`.** Until this happens friday cannot safely
   address a database, because it cannot tell staging from production. A local
   tool that cannot make that distinction is more dangerous than no tool.
2. **A functions manifest.** Both jobs in `.github/workflows/supabase.yml`
   iterate a hardcoded list of 24 Edge Functions. There are 27 10Q functions on
   disk. Replace both loops with one committed file that friday also reads.
3. **A formatter.** There is no Prettier config in this repo. `friday fix` has
   to introduce one, which means a single large reformat commit — do that
   deliberately and on its own, or the first `friday fix` produces a diff nobody
   can review.

### Phase 05 — the everyday loop

`friday fix`, `friday preview`, `friday ship staging`. Nothing here touches
production, so the blast radius stays at zero while the command shapes settle.

### Phase 06 — the gate

`friday ship production` and `friday undo`, built last and only once the first
five are proven.

- Production writes run through **GitHub Actions**, not this laptop. That keeps
  production credentials off the machine and gives every deploy an audit trail.
- `friday undo` **prints** the restore command; it does not run it. A restore
  rewinds player data as well as schema, and in a game where each player gets
  one attempt per day, that permanently erases those players' only attempt.
  `undo` must say how many attempts a restore would discard before anyone runs
  it.
- Moving production off the push path also requires fixing the poll in
  `ci.yml`, which waits on a Supabase job that would no longer run for every
  commit. Those are one change, not two.

## Known rough edges

- **`friday check` can report "Types — failed" when nothing is wrong.** A stale
  `.next/` directory leaves generated route types behind that reference deleted
  pages. `.next/` is gitignored so CI never sees it. If types fail locally but
  pass in CI, delete `.next` and re-run.
- **No tests for friday itself.** The Keychain split and the secret resolver are
  the parts worth testing first.
- `friday check` runs lint, types and tests serially. `--quick` skips all three.
