# friday

The one tool for working on 10Q.

```bash
friday check
```

That is the command to reach for whenever anything feels wrong. It looks at your
machine and at your code, and ends with a single next action rather than a
report.

## Install

Once, per machine:

```bash
./tools/friday/install
```

That creates a symlink onto your `PATH`. There is no build and no `npm install`:
friday is plain Node with zero dependencies, so **the source you pull is the
program that runs**. Updating it is `git pull` and nothing else.

You can also run it without installing:

```bash
./tools/friday/friday check
```

## Two surfaces

**Workflows** — what Riley uses, and all `friday help` shows:

```
friday check · fix · test · ship staging · ship production · release · undo
```

**Primitives** — the engine, namespaced, for agents and for the workflows to
orchestrate:

```
friday system doctor · quality lint · secrets list · backend drift · …
```

Neither is the real Friday. Workflows exist so a person never has to choose
between `system doctor` and `backend drift`; primitives exist so an agent never
has to guess which of five things a workflow actually did.

## What is built

Most of Friday is designed and not built. The registry says which:

```bash
friday capabilities            # ✓ built / ○ designed
friday capabilities --planned  # what is left
friday capabilities --json     # machine-readable
```

`tools/friday/capabilities.json` is the single source of truth, and it is
cross-checked against the handler table on every run — so it cannot quietly
claim something exists when it does not.

A planned capability prints what it will do and exits non-zero. It never
pretends to have worked, because a command that fails silently is
indistinguishable from a mistake you made.

**If you need a capability that is planned, building it in Friday is the next
task.** Do not route around Friday with an ad hoc shell command.

`friday check --quick` skips lint, types and tests when you only want to know
about your machine.

## How it is put together

```
tools/friday/
  friday            the wrapper — what gets symlinked onto your PATH
  install           creates that symlink
  bin/friday.mjs    dispatch, and nothing else
  capabilities.json  WHAT EXISTS — the target architecture and its build status
  lib/
    capabilities.mjs  reads the registry, resolves argv, checks for drift
    handlers.mjs      WHAT RUNS — dotted path to implementation
    freshness.mjs     proves the source on disk is what executes
    ui.mjs            everything friday prints
    exec.mjs          running other programs
    repo.mjs          where we are, what git thinks
    project.mjs       the few facts about THIS repo that Friday needs
    toolchain.mjs     what Friday needs installed on the machine
    config.mjs        reads the refs file
    keychain.mjs      macOS Keychain
    secrets.mjs       the secret registry
    commands/         one file per implemented capability
supabase/refs.json  which Supabase project is which
```

### Three decisions worth knowing

**Your edits always take effect.** Sonnet's Friday is Swift, so its wrapper
checksums the sources and rebuilds when they change. This one is Node with no
dependencies, so there is nothing to compile: `friday` execs the source
directly, and the file you just edited is the code that just ran. There is no
state in which a stale Friday can run — a stronger guarantee than
checksum-and-rebuild, which can still serve a stale binary when a build fails.

It holds only while Friday stays dependency-free, so it is guarded rather than
assumed. `friday system doctor` prints the mode and a source fingerprint, and
fails loudly if a `node_modules`, a build output, or a dependency in
`package.json` ever appears. If Friday does need a build one day, the rebuild
goes in `tools/friday/friday` — see the comment there — and the contract must
not change.

**There is no config file, and there will never be a `friday.yml`.** Parsing
YAML needs a dependency, a dependency needs installing, and an install step is
exactly what would reintroduce the possibility of running a stale Friday. Zero
dependencies is what makes `git pull` the entire update mechanism.

Nor is there a JSON config file yet. 10Q has almost no repo configuration — a
file holding `{"name": "10Q"}` is ceremony, not configuration — so the handful
of facts live in `lib/project.mjs`, which documents the rule for when to promote
them to `tools/friday/config.json`: a real cluster of declarative, non-secret,
stable facts (Cloudflare project, Apple bundle id, Xcode scheme, Android
application id, workflow names), and never credentials or release state.

Data that CI and the skills also read stays JSON: `capabilities.json` and
`supabase/refs.json`.

**Checking a secret never decrypts it.** `keychain.exists()` runs
`find-generic-password` *without* `-w`, so macOS does not raise a permission
dialog. If `friday check` decrypted every secret it inspected, a health check
would become a wall of prompts and you would learn to click Deny.

## What friday will not do

It will not hold a production database password. Production writes go through
GitHub Actions, where the credentials already live and where every deploy leaves
an audit trail. friday's job on your laptop is to read, to check, and to ask CI
for things — see `docs/friday/PLAN.md`.
