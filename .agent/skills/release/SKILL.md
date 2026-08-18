---
name: Release 10Q
description: Operate the 10Q release state machine across web, iOS and Android. Owns safety rules, gate enforcement, and the prepare/submit/release separation. Applies whenever the user asks to release, ship, promote, roll out, roll back, or check what version is live on any platform.
---

# Release 10Q

## When This Skill Applies

Any request about shipping or release state. Examples that route here:

- "Release 10Q" · "Prepare the next mobile release" · "Ship this fix to web only"
- "Send the next iOS build to TestFlight" · "Roll Android from 10% to 50%"
- "What version is currently live on each platform?" · "Roll back the web release"
- "Is it safe to promote?" · "Halt the Android rollout"

## Division of Responsibility

This skill is the **operator**. It does not restate procedures.

| Layer | Owns | Location |
|---|---|---|
| **This skill** | State machine, safety rules, gate enforcement, intent routing | here |
| **Docs** | Source of truth for every procedure | `docs/cross-platform/release/` |
| **Scripts** | Deterministic machinery | `scripts/release/` |

**Always read the relevant doc before acting.** Do not act from memory of these procedures — they change, and the doc is authoritative.

| Intent | Read first |
|---|---|
| Anything release-related | [RELEASE_ARCHITECTURE.md](../../../docs/cross-platform/release/RELEASE_ARCHITECTURE.md) |
| Version numbers, build numbers, tags | [VERSIONING.md](../../../docs/cross-platform/release/VERSIONING.md) |
| Web deploy | [WEB.md](../../../docs/cross-platform/release/WEB.md) |
| iOS build, TestFlight, App Store | [IOS.md](../../../docs/cross-platform/release/IOS.md) |
| Android build, Play tracks | [ANDROID.md](../../../docs/cross-platform/release/ANDROID.md) |
| Promotion decisions, staged rollout | [ROLLOUTS.md](../../../docs/cross-platform/release/ROLLOUTS.md) |
| Something is wrong | [ROLLBACKS.md](../../../docs/cross-platform/release/ROLLBACKS.md) |
| First ever store submission | [FIRST_STORE_RELEASE.md](../../../docs/cross-platform/release/FIRST_STORE_RELEASE.md) |

## Non-Negotiable Safety Rules

### 1. `prepare` ≠ `submit` ≠ `release`

Three distinct verbs. **Never collapse them.**

| Verb | Does | Public impact |
|---|---|---|
| `prepare` | Bumps version, builds, runs gates, produces an artifact | **None** |
| `submit` | Uploads to TestFlight / Play track / store review | **None for the public** |
| `release` / `promote` | Publishes to users, or advances a rollout percentage | **Yes** |

"Prepare an iOS release" must never publish to the App Store. **Any operation with public impact requires explicit user confirmation naming the platform and the version**, even if the user's original request was broad. "Release 10Q" authorizes preparing all three; it does not authorize publishing all three without a confirmation per platform.

### 2. Never publish on an inferred intent

If the request is ambiguous about scope — which platforms, prepare vs publish, which percentage — **ask**. Publishing to a store is not reversible and mobile cannot be rolled back.

### 3. Gates are not advisory

A channel does not advance a state until its gates pass. See `docs/cross-platform/TESTING.md` for the gate table. If a gate fails, report it and stop. Do not offer to skip a gate; if the user explicitly instructs you to override one, say plainly what risk is being accepted and record it in the release notes.

### 4. Version skew is always in effect

Web, iOS and Android **do not** go public simultaneously. Never treat an API change as atomic across clients. Backward-compatible backend changes deploy **before** the clients that need them, never after. If a change requires a coordinated client update, that is a feature-flag problem, not a release-timing problem.

### 5. Backend before clients

Supabase migrations and Edge Function deploys precede the client releases that depend on them, and must remain compatible with every client version still in the field — including store binaries that may be months old.

### 6. Never commit secrets or signing material

Keystores, provisioning profiles, `.p8` keys and App Store Connect API keys must never enter the repo. If a procedure needs one, confirm its location out of band and reference it by path.

### 7. Hand off what only a human can do

Apple Developer enrollment, certificate generation, store console actions requiring an authenticated human session, and anything needing a password or 2FA. State clearly what the human must do and what you need back.

## Operating Procedure

### Step 1 — Establish current state

Never act before knowing where things stand. Report:

```
CHANNEL   VERSION   BUILD   STATE                  ROLLOUT
web       1.4.0     41      live                   100%
ios       1.3.2     38      live                   100%
          1.4.0     42      in review              —
android   1.3.2     38      live (staged)          50%
```

Sources: git tags ([VERSIONING.md](../../../docs/cross-platform/release/VERSIONING.md)), `scripts/release/verify`, and the store consoles. If a source is unavailable, say which and do not guess.

### Step 2 — Determine scope

Which platforms does this change actually affect? Use the change-impact matrix in [RELEASE_ARCHITECTURE.md](../../../docs/cross-platform/release/RELEASE_ARCHITECTURE.md). A backend-only or web-only change should not trigger a mobile release.

### Step 3 — Preflight

```bash
scripts/release/preflight
```

Confirms a clean tree, the branch is current with `main`, gates pass, version identifiers resolve, and required credentials are present. **Never proceed past a failed preflight.**

### Step 4 — Execute one state transition

One transition at a time. Report the outcome. Then stop and confirm before the next — especially before anything with public impact.

### Step 5 — Verify and observe

After any transition, confirm it took effect and check the observability signals from [OBSERVABILITY.md](../../../docs/cross-platform/OBSERVABILITY.md), filtered by `client_platform` and `release`.

After a rollout step, print the go/no-go block from [ROLLOUTS.md](../../../docs/cross-platform/release/ROLLOUTS.md) and **ask before promoting**:

```
Play rollout:       10%
Sentry
  crash-free rate   99.4%  (prev release 99.5%)
  new issues        0 significant
PostHog
  game starts       normal
  completion rate   normal
  auth failures     normal
→ Safe to promote to 50%?
```

Never promote automatically because signals look fine.

## Incident Response

If the user reports something broken, or a gate check surfaces a regression, switch to [ROLLBACKS.md](../../../docs/cross-platform/release/ROLLBACKS.md) immediately.

**Order of operations:** contain first, diagnose second. Halting a mobile rollout and rolling back web are both fast and both reversible. Understanding root cause is not urgent while users are affected.

Remember the asymmetry: **web rollback is real; mobile rollback does not exist.** For mobile the levers are halt the rollout, forward-fix through expedited review, kill-switch via a PostHog feature flag, or the minimum-supported-version gate. Know which apply before promising anything.

## Current Limitations — read before your first run

As of the migration described in `docs/cross-platform/`, parts of this machinery do not exist yet. Check before assuming:

- `scripts/release/` may be stubs. Read them; if a script is a stub, follow the doc procedure manually and say so.
- There is **no staging environment** yet, and **no version source of truth** — the identifiers this skill reports depend on Phase 2 of [05-migration-plan.md](../../../docs/cross-platform/05-migration-plan.md).
- **Supabase deploys are manual** and not in CI.
- **No iOS or Android app exists yet.** Until the first store release, route to [FIRST_STORE_RELEASE.md](../../../docs/cross-platform/release/FIRST_STORE_RELEASE.md) instead of the normal flow.
- **Capacitor OTA / live updates are explicitly out of scope for V1.** If asked to ship a JS-only change without a store release, say it is not supported and explain the constraint (Apple guideline 2.5.2) rather than improvising one.
