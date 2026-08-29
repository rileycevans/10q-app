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

## Commands

| Command | Does | Built |
|---|---|---|
| `friday check` | Is everything OK? Machine, secrets, project config, repo, code | **yes** |
| `friday fix` | Format and auto-fix | no |
| `friday preview` | Run the app locally | no |
| `friday ship staging` | Run the checks, ship to staging | no |
| `friday ship production` | The gated path to the live database | no |
| `friday undo` | How to undo the last production ship | no |

Unbuilt commands print what they will do and exit non-zero. They never pretend
to have worked — that distinction matters more than it sounds, because a command
that fails silently is indistinguishable from a mistake you made.

`friday check --quick` skips lint, types and tests when you only want to know
about your machine.

## How it is put together

```
tools/friday/
  friday            the wrapper — what gets symlinked onto your PATH
  install           creates that symlink
  bin/friday.mjs    dispatch, and nothing else
  lib/
    ui.mjs          everything friday prints
    exec.mjs        running other programs
    repo.mjs        where we are, what git thinks
    config.mjs      loads friday.config.mjs and the refs file
    keychain.mjs    macOS Keychain
    secrets.mjs     the secret registry
    commands/       one file per command
friday.config.mjs   configuration, at the repo root
supabase/refs.json  which Supabase project is which
```

### Three decisions worth knowing

**No build step.** Sonnet's Friday is Swift, so its wrapper checksums the
sources and rebuilds when they change. This one is Node with no dependencies, so
there is nothing to compile. If friday ever grows a dependency, the checksum and
rebuild logic goes in `tools/friday/friday` — see the comment there.

**Config is `.mjs`, not `.yml`.** Parsing YAML without a dependency means
hand-rolling a parser. A JS module gets comments for free and Node reads it
natively. Data that CI also needs (`supabase/refs.json`) stays JSON.

**Checking a secret never decrypts it.** `keychain.exists()` runs
`find-generic-password` *without* `-w`, so macOS does not raise a permission
dialog. If `friday check` decrypted every secret it inspected, a health check
would become a wall of prompts and you would learn to click Deny.

## What friday will not do

It will not hold a production database password. Production writes go through
GitHub Actions, where the credentials already live and where every deploy leaves
an audit trail. friday's job on your laptop is to read, to check, and to ask CI
for things — see `docs/friday/PLAN.md`.
