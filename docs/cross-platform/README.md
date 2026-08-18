# Cross-Platform Client Architecture

Bringing 10Q to iOS and Android from the existing codebase, without creating a second frontend.

**Decision: Capacitor.** One React codebase, one backend, three platform outputs, with a deliberately small platform-services layer for native capabilities.

---

## Start here

| Order | Doc | Read it for |
|---|---|---|
| 1 | [STATUS.md](STATUS.md) | **Where the work actually stands right now** |
| 2 | [01-architecture-decision.md](01-architecture-decision.md) | The ADR — Capacitor over Expo, and the gate that decided it |
| 3 | [02-current-state.md](02-current-state.md) | Audit evidence. Read before re-deriving anything |
| 4 | [03-blocking-fixes.md](03-blocking-fixes.md) | Security and compliance work that must land first |
| 5 | [04-shared-code-architecture.md](04-shared-code-architecture.md) | How one codebase serves three platforms |
| 6 | [05-migration-plan.md](05-migration-plan.md) | Phased execution with exit gates |

## The four cross-cutting pillars

Each is first-class infrastructure, not post-migration cleanup.

| Pillar | Doc | Core idea |
|---|---|---|
| **Observability** | [OBSERVABILITY.md](OBSERVABILITY.md) | One PostHog project and one Sentry project, dimensioned by `client_platform`. One funnel, one error stream, always sliceable |
| **Testing** | [TESTING.md](TESTING.md) | Test product behavior **once** against shared code. Platform tests cover only genuine divergence |
| **Distribution** | [release/](release/) | One source tree, three independently controllable release channels |
| **Automation** | [`.agent/skills/release/`](../../.agent/skills/release/SKILL.md) | One operator skill. Docs are the source of truth; `scripts/release/` is the machinery |

Plus [STORE_READINESS.md](STORE_READINESS.md) — Apple and Google compliance status.

## Release documentation

| Doc | Owns |
|---|---|
| [RELEASE_ARCHITECTURE.md](release/RELEASE_ARCHITECTURE.md) | The spine: channels, version-skew rule, prepare/submit/release state machine |
| [VERSIONING.md](release/VERSIONING.md) | Version and build number contract, tagging, minimum-supported-version |
| [WEB.md](release/WEB.md) · [IOS.md](release/IOS.md) · [ANDROID.md](release/ANDROID.md) | Per-channel procedures |
| [ROLLOUTS.md](release/ROLLOUTS.md) | Promotion gates and staged-rollout policy |
| [ROLLBACKS.md](release/ROLLBACKS.md) | Incident response, and the web/mobile asymmetry |
| [FIRST_STORE_RELEASE.md](release/FIRST_STORE_RELEASE.md) | The one-time setup runbook |

---

## The three things most likely to bite you

**1. There are live security defects.** `delete-attempt` lets any signed-in user wipe their attempt and replay it with the answer key in hand, for a perfect 100 every day — stopped today only by a client-side `if (!isAdmin)`. `publish-quiz` is an unauthenticated service-role write. Packaging the app makes both trivially discoverable. **Section A of [03-blocking-fixes.md](03-blocking-fixes.md) must land before any external build exists.**

**2. Google Play production access may be a four-week gate.** If the Play account is a personal account created after 2023-11-13, production requires a closed test with **12 testers opted in for 14 consecutive days**, then a human-reviewed written application. This is the single largest schedule risk in the program and it blocks nothing else — **start it first.** See [ANDROID.md](release/ANDROID.md) §4.4.

**3. Gate 0 has not been run.** The static export's behavior inside a real WebView — specifically Next's export-mode `HEAD` probe through Capacitor's scheme handler — is the one assumption the audit could not verify. If it fails, in-flight quiz state is destroyed on every question transition. **Do not start native work before Phase 0 passes.** See [05-migration-plan.md](05-migration-plan.md).

---

## Working on this

Invoke the [cross-platform migration skill](../../.agent/skills/cross-platform-migration/SKILL.md) at the start of every session — and again after any context compaction:

> *"Use the cross-platform migration skill and continue the migration."*

It routes to the authoritative docs and forces rediscovery of actual state rather than trusting whatever survived the last compaction.

Validate the documentation map at any time:

```bash
.agent/skills/cross-platform-migration/check-docs
```

It resolves every cross-reference and probes the observed implementation state directly — if reality contradicts [STATUS.md](STATUS.md), **reality wins and STATUS.md is wrong.**

---

## Provenance

This package was produced on 2026-08-18 against commit `af86e61` by a 12-agent parallel audit with three adversarial verification passes, plus a research pass against current Apple and Google developer documentation.

Claims marked ⚠️ UNVERIFIED in [02-current-state.md](02-current-state.md) were contaminated by agents running builds concurrently and **must be re-measured in Gate 0**. Two claims from the first pass were disproved by verification and have been corrected in place. The audit's original "moderate work" estimate was refuted by all three verification lenses; the honest framing is **port the routing layer and the auth entry/exit points, then wrap** — not "wrap the existing site."
