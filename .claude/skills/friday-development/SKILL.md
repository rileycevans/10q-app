---
name: friday-development
description: How to safely modify Friday itself — its architecture, the capability registry that keeps designed and implemented from drifting, the zero-dependency rule and the freshness guarantee it protects, command design across Friday's two surfaces, stdout/stderr discipline, JSON compatibility, and keeping skills in sync. Enforces the rule that repo policy belongs in Friday rather than in skill prose. Applies whenever changing anything under tools/friday, adding a Friday capability, or deciding where a new invariant should live.
---

# Friday Development

Changing Friday itself. This is a different activity from using Friday — see
[friday](../friday/SKILL.md) for that.

Friday is the thing every other operation trusts. A bug here is not one broken command;
it is a broken guarantee that other work is built on.

## The rule this skill exists to protect

> **An invariant that can be checked belongs in Friday, not in skill prose.**

When you discover a rule — say, *production promotion must verify the staging SHA* — the
fix is **not**:

```
# backend/SKILL.md
Remember to check that staging matches HEAD before promoting.
```

The fix is:

```
Friday enforces it.  The skill explains that Friday enforces it.
```

Prose is advisory and drifts. An agent may not read it, may read a stale copy, or may
decide the situation is an exception. Code refuses every time.

**Whenever you are about to add a "remember to…" sentence to a skill, stop.** That
sentence is a missing Friday check. Write the check. If it genuinely cannot be checked —
it needs human judgement, or knowledge Friday cannot reach — then it belongs in a skill,
and say explicitly *why* it could not be enforced.

## Where Friday lives

```
tools/friday/
  friday               the wrapper — what PATH points at
  install              symlinks `friday` onto PATH, once per machine
  capabilities.json    WHAT EXISTS — the target architecture and its build status
  bin/friday.mjs       dispatch, and nothing else
  lib/
    capabilities.mjs   reads the registry, resolves argv, checks for drift
    handlers.mjs       WHAT RUNS — dotted capability path to implementation
    freshness.mjs      proves the source on disk is what executed
    project.mjs        the few facts about THIS repo that Friday needs
    toolchain.mjs      what Friday needs installed on the machine
    ui.mjs · exec.mjs · repo.mjs · config.mjs · keychain.mjs · secrets.mjs
    commands/          one file per implemented capability
supabase/refs.json     which Supabase project is which
```

## There is no config file, and no `friday.yml`

Sonnet's Friday reads a `friday.yml` because it genuinely needs configuring: workspace
and scheme names, test destinations, build configurations, DerivedData paths. That is a
real cluster of repo facts.

10Q has almost none of it. Two rules follow, and both are deliberate divergences from
Sonnet rather than oversights:

**Never YAML.** A YAML parser is a dependency, a dependency is an install step, and an
install step is what would reintroduce the possibility of running a stale Friday.
Declarative data is JSON, parsed natively.

**No general config file yet.** A file holding `{"name": "10Q"}` is ceremony, not
configuration. The few repo facts live in `lib/project.mjs`; Friday's own requirements
(which tools, which checks) are not repo configuration at all and live in
`lib/toolchain.mjs` and `lib/commands/quality.mjs`.

Introduce `tools/friday/config.json` only when the release work produces a genuine
cluster — Cloudflare project, Apple bundle id, Xcode project and scheme, Android
application id, GitHub workflow names, release branch and tag conventions — under this
rule:

> `config.json` holds declarative, non-secret, relatively stable facts about how Friday
> operates this repository. It holds neither credentials nor mutable deployment or
> release state.

**Guard that rule.** Friday keeps five kinds of data apart: `capabilities.json` (what
Friday can do), `supabase/refs.json` (which project is which), repo facts, release
state, and credentials in the Keychain or CI. A general config file is exactly where
those five quietly become one junk drawer.

## Zero dependencies, and the guarantee it buys

`tools/friday/friday` is a thin shim that resolves the repo root and execs
`bin/friday.mjs`. **That is all it does, deliberately.**

Friday is plain Node ESM with **zero dependencies**, so the source that is pulled is the
program that runs. No compile, no cache, no staleness — the entire class of "the binary
is out of date" bugs does not exist.

This matters more than it sounds. The worst failure for a tool like this is silent
staleness: an agent edits a command, runs it, sees the old behaviour, and every
subsequent decision rests on a false premise. Friday makes that state unreachable rather
than unlikely.

**Protect this property.** Adding a dependency is not a small decision — it reintroduces
install state, a lockfile, and a version of Friday that can disagree with its source.
Prefer writing the fifty lines. `tools/friday/install` must stay trivial.

### The guard

`lib/freshness.mjs` makes the guarantee verifiable rather than assumed. It fingerprints
Friday's own source, and **fails loudly** if anything appears that would break the
property: a `node_modules`, a build output, a `.friday` cache, or a dependency declared
in a `package.json`. `friday system doctor` reports it first, before anything else,
because if that guarantee is broken nothing else it prints can be trusted.

Never weaken this to silence a warning. The warning *is* the feature.

### If Friday ever does need a build step

Only then does checksum-and-rebuild belong in `tools/friday/friday`, and it must obey all
four of these:

- **Content, not mtime.** A rebase or checkout churns timestamps without changing code.
  Fingerprint content, path-sorted, so those do not trigger spurious rebuilds.
- **Fingerprint written last.** A failed build must not poison the cache — exit non-zero,
  leave the fingerprint alone, retry next invocation. **Never serve a stale binary after
  a failed build.**
- **Self-tests gate activation.** Compiling is necessary, not sufficient. "It built" is
  exactly the standard Friday refuses to accept everywhere else.
- **Rebuild under a lock.** Two sessions in one worktree can rebuild simultaneously.
  Stage the artifact atomically.

The contract `freshness.mjs` reports must not change: running Friday always runs the
source you can see.

## Adding a capability

Friday has two surfaces, and a new capability belongs to exactly one. See
[friday](../friday/SKILL.md).

- **Primitive** — the default. Namespaced `friday <noun> <verb>`, precise, for agents and
  for workflows to orchestrate. Almost everything new is a primitive.
- **Workflow** — task-shaped, for Riley. Adding one is a product decision, not a
  refactor: it must correspond to something he would say out loud, and it should
  orchestrate primitives rather than contain logic. **Do not add a top-level verb for
  something that belongs under a noun.**

Every capability requires **both** halves, in the same change:

1. An entry in `capabilities.json` — `surface`, `status`, `summary`, and `riley` for a
   workflow. Mark it `planned` if you are declaring intent without implementing it.
2. A handler in `lib/handlers.mjs`, keyed by the same dotted path — only when the status
   is `implemented`.

The two are cross-checked on every run. A capability that claims to be implemented with
no handler, or a handler the registry does not declare, is reported as a bug in Friday
and dispatch refuses with exit 70. **This is deliberate**: it is the same drift class
that left three Edge Functions undeployed for weeks because a hardcoded list fell behind
what was on disk. Friday must not repeat it about itself.

**Declaring a capability `planned` is encouraged.** The registry is the design, not an
inventory of what happens to be finished. A planned entry tells the next agent what to
build, in Friday, instead of improvising around it.

## Designing the command

Before adding one, ask what invariant it owns. A command that only sequences shell calls
and enforces nothing probably belongs in a skill instead.

**Refusals are the product.** A refusal must say what was expected, what was found, and
what to do next:

```
REFUSED: staging does not represent HEAD
  staging  a41f9c2  (3 commits behind)
  HEAD     9b8084e
  → run `friday ship staging` first
```

A refusal that only says "failed" teaches nothing and will be worked around.

**Never add a flag that skips a safety check** to make a workflow convenient. If a check
is wrong, fix or remove it. A `--force` that bypasses an invariant is that invariant
deleted, with extra steps.

**Confirmation is a pure function.** Keep the decision separate from the terminal so it
is testable, and so non-interactive callers must pass the token explicitly rather than
inheriting a yes.

**Unimplemented means exit 2, never 0.** A planned capability says what it will do and
stops. A command that fails invisibly is indistinguishable from the user's own mistake,
which is worse than not existing — the trap `scripts/release/*` already sets.

**Write for the reader who is not an engineer.** Riley sees the workflows. "Your database
is not reachable" beats `ECONNREFUSED 5432`. Every output goes through `lib/ui.mjs` so
tone and layout stay consistent.

## stdout, stderr and `--json`

- **stdout** carries the result, and nothing else.
- **stderr** carries narration, progress and warnings.

With `--json`, stdout is a single valid JSON object — a consumer must be able to pipe
stdout straight into a parser.

**JSON is a compatibility surface.** Add fields; never remove or repurpose one. Agents,
scripts and CI read this output and are not all updated together — the same reasoning
that governs Edge Function responses.

## Testing Friday

**Friday has no test suite yet. This is the largest gap in it.**

Say so plainly rather than implying coverage that does not exist. The parts that most
need tests, in order: the Keychain presence/read split, capability resolution and the
registry integrity check, the freshness guard, and — once they exist — confirmation
parsing and migration diffing.

Once tests exist they run in `friday quality gate`. **Do not add a capability with an
invariant and no test for the refusal path** — the refusal is the feature, so an untested
refusal is an untested feature.

## Keeping skills in sync

Skill content splits in two:

| Belongs in the registry | Belongs in prose |
|---|---|
| Which capabilities exist, and their status | Why an invariant exists |
| Command surfaces, flags, JSON shapes | When to reach for a lane |
| Configuration keys, environment names | What must never be bypassed |

```bash
friday docs check        # implemented — fails if a skill names a capability Friday does not declare
friday docs generate     # planned — will regenerate the generated portions
```

`friday docs check` is the enforced half: every `friday …` invocation a skill mentions
must resolve to a declared capability, so renaming a capability without updating the
skills fails loudly. It will run in `quality gate` once that exists; until then, run it
yourself after any capability change.

It deliberately does **not** check whether the prose is right, whether the sequencing is
sound, or whether a skill omits something. Those need judgement, and claiming to verify
them would be its own kind of lie. That half stays manual.

Skills should describe the **whole target architecture** and defer to
`friday capabilities` for status. Do not shrink a skill to match what is implemented
today — that discards the design. Do not assert a command works, either; point at the
registry.

## Prohibitions

- **Never** encode a checkable repo policy in skill prose instead of in Friday.
- **Never** add a dependency without treating it as an architectural change.
- **Never** weaken the freshness guard to silence a warning.
- **Never** add a handler without a `capabilities.json` entry, or vice versa.
- **Never** put anything but the result on stdout.
- **Never** remove or repurpose a `--json` field.
- **Never** add a flag that bypasses a safety check.
- **Never** let a command exit 0 for work it did not do.
- **Never** commit a built Friday artifact. There are none, and there should be none.

## Related skills

| Skill | Use it for |
|---|---|
| [friday](../friday/SKILL.md) | Using Friday, its two surfaces, and its refusal contract |
| [development](../development/SKILL.md) | The ordinary code loop |
