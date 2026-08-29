---
name: friday
description: The canonical manual for `friday`, 10Q's authoritative development and operations CLI. Explains what Friday owns, its two surfaces (Riley's workflows and the agent-facing primitives), the capability registry that distinguishes designed from implemented, local-versus-CI execution, `--json` output, why no rebuild step exists, and how to respond when Friday refuses. Read this before running any development, backend, or release command in this repo, and whenever an agent is deciding between Friday and an underlying tool.
---

# Friday

`friday` is 10Q's development and operations CLI. It lives in `tools/friday` and is the
single deterministic surface over everything operational in this repository.

**Read this skill before running any build, backend, or release operation.** It is the
constitution the other Friday skills assume.

## Why Friday exists

10Q is one codebase with three distribution targets and a Supabase backend serving live
players. The operations that matter — promoting schema to production, cutting a release,
shipping to a store — are each a sequence of steps with invariants between them. Left as
shell recipes, those invariants live in whoever last remembered them.

Friday moves them into code, where they are testable and cannot be forgotten.

| Layer | Owns |
|---|---|
| [CLAUDE.md](../../../CLAUDE.md) | The law. Short, absolute, non-negotiable. |
| `.claude/skills/` | Workflow, sequencing and intent. Teaches *when* and *why*. |
| `friday` | The work, and the invariants. Enforces *what must be true*. |

**Skills explain. Friday enforces.** A rule that can be checked belongs in Friday, not in
prose an agent may or may not read. See [friday-development](../friday-development/SKILL.md).

## The rule that matters most

> **A Friday refusal is evidence of an unmet invariant, not an inconvenience to work around.**

```
$ friday ship production
REFUSED: staging does not represent HEAD
  staging  a41f9c2  (3 commits behind)
  HEAD     9b8084e
  → run `friday ship staging` first
```

The correct response is to satisfy the invariant. It is **never** to reach for
`supabase db push`, `wrangler deploy`, `gh workflow run`, `xcodebuild` or the Supabase
dashboard to accomplish the same thing by other means.

Bypassing a refusal is not a clever workaround. It is the specific failure the refusal
was written to prevent, and it will not be caught a second time.

If you believe a refusal is wrong, say so and stop. A wrong invariant is fixed in
Friday — not routed around.

## Friday has two surfaces

This is the central thing to understand, and the reason the command list is longer than
it first appears.

**Workflows** are task-shaped and few. They are what Riley — 10Q's developer, who is not
an engineer — uses, and all that `friday help` shows.

| Workflow | He means |
|---|---|
| `friday check` | "Is everything okay?" |
| `friday fix` | "Fix the safe automatic stuff." |
| `friday test` | "Prove this is ready." |
| `friday preview` | "Run it locally and look at it." |
| `friday ship staging` | "Put this on staging." |
| `friday ship production` | "Safely promote this to production." |
| `friday release` | "Get a new 10Q version out." |
| `friday undo` | "Undo the last production ship." |

**Primitives** are the engine underneath, namespaced `friday <noun> <verb>`. They exist
so an agent never has to guess which of five things a workflow actually did, and so the
workflows have something precise to orchestrate.

```
system doctor · system status
quality format · lint · typecheck · unit · e2e · export · gate
docker up · down · status · doctor
backend status · drift · diff · plan · verify · activation · promote
release status · preflight · prepare · rc · notes · tag
release web|ios|android <verb>
secrets list · set        docs generate · check        capabilities
```

Neither surface is the "real" Friday.

**Agents should use primitives when diagnosis or a specialised workflow requires them.**
Riley generally should not need to. So:

- Use a **workflow** when doing the ordinary thing, or when acting on the user's behalf
  in their vocabulary.
- Use a **primitive** when you need to distinguish causes, read a specific result, or
  drive one step of a longer sequence.

`friday check` says whether anything is wrong. `friday system doctor` tells you whether
the *machine* is misconfigured, as opposed to the code failing type checks. That
distinction is why both exist, and why Riley only ever needs the first.

## Designed versus implemented

**Most of Friday is designed and not yet built. This is intended.** The command surface
above is the target architecture; the implementation is a checkpoint against it.

`tools/friday/capabilities.json` is the **single source of truth** for which is which,
and it is cross-checked against the handler table on every run, so it cannot quietly
claim something exists when it does not.

```bash
friday capabilities           # the whole map: ✓ built, ○ designed
friday capabilities --planned # only what is left
friday capabilities --json    # machine-readable
```

**Check before you invoke.** Do not treat this skill's command tables as proof that a
command is available — that is what `friday capabilities` is for.

A planned capability prints what it will do and **exits 2**. It never reports false
success and never silently does nothing.

> **If a capability you need is planned but not implemented, treat implementing that
> Friday capability as the next development task. Do not permanently bypass Friday with
> an ad hoc shell workflow.**

That is the whole point of the registry. Discovering `friday release ios submit` is
`status: planned` should produce *"that is the next Friday feature to build"*, not
*"I will improvise some xcodebuild commands"*. See
[friday-development](../friday-development/SKILL.md) for how to add one.

If you must proceed before the capability exists, follow the documented manual procedure
in `docs/` and **say plainly that you did so, and why**.

### Exit codes

| Code | Means |
|---|---|
| `0` | Fine |
| `1` | Something is wrong — the thing you asked about failed |
| `2` | Designed, but not built yet. Nothing happened. |
| `70` | A bug in Friday itself |

`2` is distinct on purpose: an unbuilt capability must never be confused with a failure
you caused.

## check vs test vs quality gate vs ship

Frequently confused. Not interchangeable.

| | Answers | Touches network | Typical use |
|---|---|---|---|
| `check` | "Is anything wrong?" — machine *and* code | no | any time, after every edit |
| `test` | "Is this ready?" — the full suite | Docker only | before opening a PR |
| `quality gate` | "Is this allowed to ship at all?" | yes, read-only | before staging |
| `ship staging` | — ships to staging | yes | to try it for real |
| `ship production` | — ships to production | yes | deliberate, gated |

`friday system doctor` is orthogonal: it answers **"is my machine okay?"** rather than
"is my code okay?". `check` covers both so Riley never has to choose; reach past it for
`system doctor` when you specifically need to separate the two.

## Local versus CI

Friday executes read-only and developer-loop operations **locally**, and routes
operations with public impact through **CI**.

| Runs locally | Runs through CI |
|---|---|
| `check`, `fix`, `test`, `preview`, `quality *` | `ship staging`, `ship production` |
| `system *`, `secrets *`, `backend status/drift/diff/plan` | the web deploy |
| native builds (`release ios build`, `release android build`) | |

This is not arbitrary. Production credentials stay in GitHub rather than on a laptop,
there is exactly one code path that can write to the production database, and every
production write leaves an audit trail in Actions. CI is also free here — `10q-app` is a
public repository and every job runs on `ubuntu-latest`, so there are no macOS-runner
costs to avoid. Native builds are local because they need Xcode, Gradle and signing
material CI does not have.

**Consequence for agents:** a command that dispatches CI will take minutes and stream
remote output. That is expected. Do not interpret slowness as a hang, and do not re-run
it — a second dispatch against the same ref is how two migrations end up racing.

## `--json`

Friday commands accept `--json` and emit a single machine-readable object on **stdout**.
Human narration, progress and build chatter go to **stderr**.

```bash
friday capabilities --json
```

Prefer `--json` when the result will be parsed or reasoned over, and the human form when
the output is for the user to read. **Never scrape the human form.**

The JSON shape is a compatibility surface: fields are added, never removed or
repurposed — the same rule that governs Edge Function responses, for the same reason.

> `--json` is implemented per-command as each is built. `friday capabilities --json`
> works today. Check `friday capabilities` before assuming a given command supports it.

## Updating Friday

**There is no update step. `git pull` is the entire update mechanism.**

Friday is plain Node ESM with zero dependencies, so there is no build and no cache: the
source you pull is the program that runs. Editing anything under `tools/friday` takes
effect on the very next invocation.

One-time, per machine:

```bash
./tools/friday/install     # symlinks `friday` onto PATH
```

That is the only manual step, and it is never needed again — not after a pull, not after
Friday changes.

**Never instruct anyone to rebuild or reinstall Friday to pick up a change**, and never
doubt whether your own edit took effect. If you want to confirm it:

```bash
friday system doctor       # prints the mode and a source fingerprint
```

If `friday` genuinely appears out of date, the symlink is wrong or a different copy is
on `PATH` — see [friday-development](../friday-development/SKILL.md).

## When Friday has no command for it

Friday does not own everything. Writing application code, reading logs, editing
migrations and ordinary `git` work are all outside it.

The test is: **does the operation have an invariant that could be violated?** If yes, it
belongs in Friday — check `friday capabilities` before improvising. If no, use the
underlying tool directly.

If an operation *should* have a Friday capability and the registry does not list it at
all, say so, and add it. Do not quietly build a shell equivalent — that is exactly how
the guarantees erode.

## Related skills

| Skill | Use it for |
|---|---|
| [development](../development/SKILL.md) | The day-to-day edit → fix → check → test loop |
| [backend](../backend/SKILL.md) | Supabase state, drift, staging and promotion |
| [release](../release/SKILL.md) | The three-platform release lifecycle |
| [friday-development](../friday-development/SKILL.md) | Changing Friday itself |
