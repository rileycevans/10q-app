---
name: backend
description: Supabase state and safety for 10Q — the repo → staging → verification → production model, reading drift, planning and applying migrations and Edge Function deploys, and the gated promotion path. Covers resource ownership between 10Q and the co-located Transfers project. Applies whenever working on migrations, Edge Functions, RLS, or anything that changes what is deployed to a hosted Supabase project.
---

# Backend

Supabase is where 10Q keeps everything that matters: the answer key, every attempt,
scores, streaks and leagues. It serves live players continuously. This skill covers
getting changes into it safely.

Read [friday](../friday/SKILL.md) first. For writing the code, see
[development](../development/SKILL.md).

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

## The model

```
   repo — the desired state
        │  friday backend diff / plan
        ▼
   staging — proves it applies
        │
   verification receipt — proves it worked, against this exact SHA
        │  friday ship production
        ▼
   production — live players
        │
   activation — proves it actually serves traffic
```

Each arrow is a proof obligation, not a step. Friday will not advance one until the
previous is satisfied, and the receipt is what makes `ship production` meaningful: it ties a
successful staging run to a specific commit, so promoting cannot silently ship
something staging never saw.

**Backend before clients, always, and only ever backward-compatible.** A client that
ships before the schema it needs is broken for every user; a schema that ships before
its client is merely inert. This ordering is enforced, not advisory.

## Reading the current state

Always establish state before acting. These are read-only, local and fast:

```bash
friday backend status # what is deployed where
friday backend drift  # repo vs staging vs production
friday backend diff   # the concrete change a promotion would apply
friday backend plan   # the ordered plan, including what runs first
```

`drift` is the one to reach for when something is confusing. It answers the question
that causes the most wasted debugging: *is the thing I am looking at actually deployed?*

## Applying a change

```bash
friday ship staging    # apply to staging, produce the receipt
# go try it
friday ship production # gated: diff, snapshot, typed confirmation, ordered ship
```

`ship staging` is cheap and reversible and should feel that way — the whole point of gating
production is that staging stays free. Use it liberally.

`ship production` has public impact. It prints what is about to change in plain language,
takes a snapshot, and requires an explicit typed confirmation. **Never pass a
confirmation flag non-interactively to move production without a human deciding.**

## Migrations versus Edge Functions

They fail differently and the distinction matters.

| | Migrations | Edge Functions |
|---|---|---|
| State | Cumulative, ledgered | Replaced wholesale |
| Reversible | Rarely, and never for dropped data | Yes — redeploy the previous version |
| Failure mode | Partially applied schema | Old version keeps serving, or 404 |
| Ordering | Must precede the client | Must precede the client |

A migration that half-applies leaves the database in a state no commit describes.
This is why migrations go through the receipt path and are never hand-applied.

## Resource ownership — 10Q and Transfers share this repo

A **separate project's** backend code lives in this repository:

- `supabase/transfers-migrations/`
- Edge Functions: `extract-claim`, `ingest-claim`, `poll-tweets`, `poll-tweets-batch`

These belong to Transfers and **must never be deployed into a 10Q project**. Everything
else under `supabase/functions/` is 10Q's.

Friday owns this distinction through the functions manifest. Do not maintain it by
hand, and do not add a function to a deploy list in a workflow file.

> **The failure this prevents.** Deploy lists were once hardcoded in two workflow jobs.
> The entire push-notification stack — `register-device-token`, `send-notifications`,
> `verify-push-credentials` — was written, reviewed, merged and never deployed, because
> nobody updated the lists. Its tables shipped, the client called the endpoint, and
> pg_cron dutifully POSTed to a function that did not exist. **Nothing errored. Nothing
> turned red.** That is the failure class the manifest closes: an allowlist fails
> silently when it falls behind, so ownership is declared in data that Friday reads.

When adding a 10Q Edge Function, it deploys by default. When adding a Transfers one, it
must declare itself foreign.

## "Deployed" is not "working"

A successful deploy proves a resource exists. It does not prove it serves traffic,
that its secrets resolved, or that anything calls it successfully.

```bash
friday backend activation
```

Run it after any promotion. **Never report a backend change as done on the strength of
a command exiting 0.** The push-notification failure above passed every deploy it was
given, because it was never given one.

## Prohibitions

- **Never** deploy 10Q resources into the Transfers project, or the reverse.
- **Never** mutate production directly — no `supabase db push` against the production
  ref, no SQL editor in the dashboard, no manual function deploy — when Friday has a
  promotion path. If Friday refuses, satisfy the invariant.
- **Never** repair migration history as part of routine work. `migration repair`
  rewrites the applied-migrations ledger. If a remote version is missing locally,
  something applied a migration outside this repo; **find out what**. Repair belongs in
  a deliberate, reviewed session with a human present, never in automation.
- **Never** treat "command succeeded" as "production activation proven".
- **Never** remove or repurpose a field in an Edge Function response. Clients in the
  field may be months old. Additive changes only.
- **Never** run two promotions concurrently. Friday serialises this; do not defeat it
  by dispatching CI directly.

## When something is already wrong

Contain before diagnosing. Establish state with `friday backend status` and
`friday backend drift` first — acting on an assumption about what is deployed is how a
small problem becomes a data-loss problem.

Restoring a snapshot rewinds **player data** as well as schema. In a game where each
player gets one attempt per day, a restore permanently destroys those players' only
attempt. It is rarely the right answer to a schema problem. Weigh forward-fix first.

## Related skills

| Skill | Use it for |
|---|---|
| [friday](../friday/SKILL.md) | Refusals, `--json`, local-vs-CI |
| [development](../development/SKILL.md) | Writing and testing the migration |
| [release](../release/SKILL.md) | Coordinating backend with client releases |
