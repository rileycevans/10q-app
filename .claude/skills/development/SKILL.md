---
name: development
description: The day-to-day 10Q development loop — edit, `friday fix`, `friday check`, focused tests, then `friday test` when the change warrants it. Explains which gate a given change actually needs, when Docker and the local Supabase stack are required versus wasted, and how to verify static-export and native behaviour. Applies whenever writing or changing application code, tests, or migrations in this repo.
---

# Development

The normal loop for changing 10Q. For backend state and promotion see
[backend](../backend/SKILL.md); for shipping see [release](../release/SKILL.md).

Read [friday](../friday/SKILL.md) first if you have not.

## Before invoking any Friday command

Most of Friday is **designed and not yet built**. This skill describes the target
architecture; `friday capabilities` is the source of truth for what exists today.

```bash
friday capabilities        # ✓ built, ○ designed
```

A planned capability prints what it will do and **exits 2**. It never reports false
success.

> **If a capability you need is planned but not implemented, treat implementing that
> Friday capability as the next development task. Do not permanently bypass Friday with
> an ad hoc shell workflow.**

If you must proceed before it exists, follow the documented manual procedure in `docs/`
and **say plainly that you did so, and why**. See [friday](../friday/SKILL.md).

## The loop

```
        make the change
              │
        friday fix          format + auto-fix
              │
        friday check        lint · types · fast unit tests
              │
     focused tests for what you touched
              │
        friday test         only when the change warrants it  ─┐
              │                                                │
          open the PR                                          │
                                                    see "Which gate" below
```

`friday check` is the one you run constantly. It is fast, local and touches no network.
Run it after every meaningful edit rather than saving it for the end — a type error
found three edits ago is a smaller problem than one found at PR time.

## Which gate does this change need?

Do not guess, and do not reflexively run everything. **Ask Friday**:

```bash
friday check --explain
```

It reports which gate the working tree actually requires and why. The table below is
the mental model behind that answer, not a substitute for asking.

| What you changed | Needs | Why |
|---|---|---|
| Component, styling, copy | `check` | No contract or schema surface |
| Domain adapter, `lib/api` client | `check` + unit tests | Reshaping is where silent breakage lives |
| `packages/contracts` | `check` + **both** consumers | The Deno copy is forked — see below |
| Edge Function | `check` + function tests | Trusted business logic |
| `supabase/migrations/**` | **`friday test`** — Docker required | RLS and schema invariants only hold against a real stack |
| Routing, `GameProvider`, app shell | **`friday test`** + export check | Static export and Capacitor break differently than dev |
| Release machinery, CI | `friday quality gate` | It gates everything else |

**When in doubt, run `friday test`.** It is slower, not dangerous.

## Docker and the local Supabase stack

`friday test` boots a real Postgres via the Supabase CLI when the change requires it.
That needs Docker running, takes a few minutes, and is the **only** way to verify RLS
policies and schema invariants — CI does exactly this in its `Schema invariants + RLS`
job, and it is the check that stands between a bad policy and the live database.

- Docker is **required** for any change under `supabase/migrations/**`.
- Docker is **not** required for component, styling, adapter or contract work.
- If Docker is not running, `friday test` says so plainly. Start Docker; do not
  skip the schema checks and do not `--skip` past them to get a green result.

If the stack fails to boot, run `friday system doctor` before debugging the migration. A
stale container or a port collision presents identically to a broken migration.

## Verifying the export and native behaviour

10Q ships as a Next.js static export inside a Capacitor shell. **Behaviour in
`next dev` does not prove behaviour in the packaged app.** The routing model
specifically differs: the export-mode router probes routes over a scheme handler that
does not exist in dev.

Any change to routing, navigation, providers or app-shell lifecycle needs the export
verified, not just the dev server:

```bash
friday test --export
```

This builds the static export and exercises it the way the packaged app will. If
in-flight quiz state can be destroyed by a navigation, this is where it surfaces.

`friday preview` runs the ordinary dev server and is for iteration, not verification.

## The forked constants

`supabase/functions/_shared/scoring.ts` is a hand-maintained Deno copy of
`packages/contracts`, because Deno cannot import the Node workspace package. **Change
one, change the other.** `friday check` flags divergence, but the fix is yours to make
and the two must agree before anything ships.

Related: `packages/contracts/src/scoring.ts` has no runtime importers — the Edge
Functions run the duplicate. Editing only the contracts copy changes nothing in
production, and tests will still pass.

## What Friday will refuse

- A gate you have not satisfied. Satisfy it; do not run the underlying tool directly.
- Shipping with a dirty working tree.
- Tests skipped via a flag on a code path that requires them.

A refusal here is cheap to fix and expensive to bypass. See the refusal rule in
[friday](../friday/SKILL.md).

## Prohibitions

- **Never** interpret "exit code 0" as "correct". A passing gate means no known
  invariant was violated, not that the change is right.
- **Never** disable a lint rule, skip a test or widen a type to make a gate pass.
  Fix the cause, or say why the rule is wrong.
- **Never** hand-run `eslint`, `tsc`, `vitest` or `playwright` to get a greener result
  than Friday reported. Friday's composition of them is the contract.
- **Never** commit `.env.local`, keystores or signing material.

## Related skills

| Skill | Use it for |
|---|---|
| [friday](../friday/SKILL.md) | Command surface, refusals, local-vs-CI |
| [backend](../backend/SKILL.md) | Migrations, drift, staging, promotion |
| [release](../release/SKILL.md) | Getting a change to users |
