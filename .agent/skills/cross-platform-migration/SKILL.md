---
name: Cross-Platform Migration Control
description: Temporary migration-control skill for the Web/iOS/Android migration. Preserves architectural intent, routes to the authoritative docs, enforces phase sequencing and exit gates, and stops local decisions drifting from the cross-platform design. Applies when working on client architecture, mobile platforms, the platform seam, analytics, observability, testing strategy, CI/CD, or releases — and whenever a session resumes after compaction.
---

# Cross-Platform Migration Control

> **This skill is temporary.** It exists only while the Web/iOS/Android migration is
> in progress. Its job is to preserve architectural intent across many sessions,
> machines and branches — not to hold the plan. The documentation holds the plan.
> Delete this skill when the contract in [§4](#4-completion-and-deletion-contract) is satisfied.

**Invoke it whenever a session starts, resumes, or has been compacted.** The useful
phrase is *"Use the cross-platform migration skill and continue the migration."*
That forces rediscovery of where the work actually stands instead of trusting
whatever survived the last 100k tokens.

---

## 1. The north star

10Q is being migrated from a web-only Next.js product into one cross-platform
product delivered through:

- Web
- iOS App Store
- Google Play

The architecture must maximize practical sharing of product code while preserving
a high-quality experience on each platform.

**Do not create independent web, iOS and Android implementations unless a genuine,
documented platform boundary requires it.**

### Invariants

These do not bend for implementation convenience:

| | Invariant |
|---|---|
| **One** | product |
| **One** | backend |
| **One** | canonical frontend architecture |
| **One** | PostHog analytics model — explicit `web` / `ios` / `android` dimension |
| **One** | Sentry observability model — explicit platform / release / build dimension |
| **Max** | shared test coverage — platform-specific tests only where necessary |
| **Three** | controlled release channels — Web / App Store / Play Store |

**Repository documentation is the source of truth.**

---

## 2. The map to the documentation

This skill deliberately does **not** restate the architecture. If it did, the skill
and the docs would eventually disagree. Go to the source.

Paths are relative to the repository root.

### Read first, every time

| Document | What it holds |
|---|---|
| [docs/cross-platform/STATUS.md](../../../docs/cross-platform/STATUS.md) | **The live checkpoint.** Current phase, what is done, what is blocked, next gate, discoveries. |

### The architecture

| Document | What it holds |
|---|---|
| [01-architecture-decision.md](../../../docs/cross-platform/01-architecture-decision.md) | ADR-001. The decision, the Phase 0 gate that validates it, and the App Store review posture. |
| [02-current-state.md](../../../docs/cross-platform/02-current-state.md) | Pre-migration audit evidence. What the repository actually was before work started. |
| [03-blocking-fixes.md](../../../docs/cross-platform/03-blocking-fixes.md) | Security, store-compliance and correctness blockers that must land before any external build. |
| [04-shared-code-architecture.md](../../../docs/cross-platform/04-shared-code-architecture.md) | What is shared vs. platform-specific, **the platform seam**, native capabilities, two builds from one tree. |
| [05-migration-plan.md](../../../docs/cross-platform/05-migration-plan.md) | Phases 0–9, each with an entry condition, scope, and a checkable **exit gate**. |
| [OBSERVABILITY.md](../../../docs/cross-platform/OBSERVABILITY.md) | PostHog and Sentry architecture, the identifier set, the implementation checklist. |
| [TESTING.md](../../../docs/cross-platform/TESTING.md) | Testing architecture: the five tiers, what is shared vs. platform-specific, and the release gate table. |
| [STORE_READINESS.md](../../../docs/cross-platform/STORE_READINESS.md) | Apple and Google requirements, hard blockers, Guideline 4.2, pre-submission checklist. |

### Release

Distribution is owned by the **[release skill](../release/SKILL.md)** — do not duplicate its
procedures here. Its source of truth is [docs/cross-platform/release/](../../../docs/cross-platform/release/):
[RELEASE_ARCHITECTURE.md](../../../docs/cross-platform/release/RELEASE_ARCHITECTURE.md) ·
[VERSIONING.md](../../../docs/cross-platform/release/VERSIONING.md) ·
[WEB.md](../../../docs/cross-platform/release/WEB.md) ·
[IOS.md](../../../docs/cross-platform/release/IOS.md) ·
[ANDROID.md](../../../docs/cross-platform/release/ANDROID.md) ·
[ROLLOUTS.md](../../../docs/cross-platform/release/ROLLOUTS.md) ·
[ROLLBACKS.md](../../../docs/cross-platform/release/ROLLBACKS.md) ·
[FIRST_STORE_RELEASE.md](../../../docs/cross-platform/release/FIRST_STORE_RELEASE.md)

### Where two expected documents actually live

Do not create these as new files — you would fork the source of truth:

- **Platform services** (auth, deep links, notifications, lifecycle, sharing) —
  the seam and capability contracts are in
  [04-shared-code-architecture.md](../../../docs/cross-platform/04-shared-code-architecture.md);
  the sequenced work is Phases 4, 6 and 7 of the migration plan.
- **Acceptance tests / definition of done** — these are the per-phase **Exit**
  checklists in [05-migration-plan.md](../../../docs/cross-platform/05-migration-plan.md).
  The phase gate *is* the acceptance test.

> **When this skill and a referenced document appear inconsistent, stop and resolve
> the discrepancy. Do not silently choose one.** Drift is a finding, not a nuisance.

---

## 3. Operating rules

### Start here, before touching anything

```bash
.agent/skills/cross-platform-migration/check-docs
```

It proves the documentation map is intact rather than assuming it, and prints the
**observed** implementation state — static export, Capacitor, native projects, the
platform seam, release scripts — next to the phase STATUS.md *claims*. Exits non-zero
when a referenced document is missing or a cross-reference is broken.

**If the observed state and STATUS.md disagree, the observation wins.** Correct
STATUS.md as part of your work.

### Then

1. **Determine the current migration phase** — `check-docs`, then STATUS.md, then the
   phase table in [05-migration-plan.md](../../../docs/cross-platform/05-migration-plan.md).
2. **Read the authoritative docs for that phase.** Not a summary of them.
3. **Inspect the implementation state.** Do not assume prior work is correct or complete.
4. **Identify any conflict** between implementation and architecture, and surface it.
5. **Continue only within the current phase** unless its exit gate has demonstrably passed.
6. **Run the required tests and verification** for the phase.
7. **Update durable documentation** when an implementation discovery changes something
   we believed to be true — including [02-current-state.md](../../../docs/cross-platform/02-current-state.md)
   when the audit turns out to be wrong.
8. **Never weaken an architectural invariant** merely to make implementation easier.
   If an invariant is genuinely wrong, change it in the docs, deliberately, with a reason.
9. **Prefer shared implementation** unless a documented platform boundary justifies divergence.
10. **Leave the repository in a state another agent can understand** without this conversation.

### The rule that matters most

> **Treat previous Claude output as implementation history, not authority.**
> The repository's current architecture documentation is authoritative.

A choice made by another session four days ago is evidence about what happened —
not permission. If it contradicts the documentation, the documentation wins until
the documentation is deliberately changed.

### Repo conventions still apply

Branch `<type>/<domain>-<slug>`, commits `<type>(<domain>): <summary>`, one PR per phase,
never commit to `main`. See [git-workflow-and-prs](../git-workflow-and-prs/SKILL.md).
The enforcement gate applies: schema changes need a migration, access-pattern changes
need RLS updates, correctness work needs tests in the same PR.

### A green build is not evidence

From the audit, this actually happened: a build was made green by deleting the dynamic
routes under test. **A gate satisfied by removing the thing under test proves nothing.**
When a check passes, confirm it passed for the reason you intended.

---

## 4. Completion and deletion contract

Deleting this skill is part of the plan, so the scaffolding does not become immortal.

**This skill must remain in the repository until all of the following hold:**

- [ ] production Web uses the final shared architecture
- [ ] production iOS has shipped through the App Store
- [ ] production Android has shipped through Google Play
- [ ] PostHog is proven across all three platforms
- [ ] Sentry is proven across all three platforms
- [ ] required shared and platform-specific test suites are operational
- [ ] release procedures for all three platforms are documented and proven
- [ ] the permanent [release skill](../release/SKILL.md) and `scripts/release/` are operational
- [ ] temporary migration-only compatibility code has been reviewed
- [ ] all migration acceptance criteria (the phase exit gates) pass
- [ ] cross-platform documentation has been converted from migration guidance into
      permanent architecture and operations documentation where appropriate

**Then delete this skill**, and remove the *Active cross-platform migration* section
from the root `CLAUDE.md`. Fold anything still load-bearing into permanent docs or the
permanent skills first — do not delete knowledge along with the scaffolding.
