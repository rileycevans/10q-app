---
name: release
description: Orchestrates the 10Q release lifecycle across web, iOS and Android as one versioned release with three distribution lanes. Owns the shared release state, safety rules, gate enforcement, the prepare/submit/release separation, and routing into the platform lanes. Applies whenever the user asks to release, ship, cut, promote, roll out, roll back, halt, or check what version is live on any platform.
---

# Release

10Q is one codebase with three distribution targets. A release is therefore **one
versioned thing** whose platform artifacts are in different states at the same time.

**This skill is the orchestrator. Load it first for any release request** — before
[release-web](../release-web/SKILL.md), [release-ios](../release-ios/SKILL.md) or
[release-android](../release-android/SKILL.md). It decides *whether* and *what*; the
lanes own *how*.

Read [friday](../friday/SKILL.md) first.

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

## The shared release state

One canonical object per release. Friday owns it; all three lanes consume it.

```json
{
  "version": "1.8.0",
  "sha": "abc123",
  "tag": "v1.8.0",
  "backend": "verified",
  "web":     "live",
  "ios":     "in_review",
  "android": "submitted"
}
```

```bash
friday release status
```

```
10Q 1.8.0   SHA abc123
Backend      ✓ active
Web          ✓ live
iOS          ○ App Review
Android      ○ staged rollout at 10%
```

**Never let a lane invent its own version or SHA.** That is how web ends up serving one
commit while the tag points at another and iOS ships a third. If a lane needs a value,
it reads it from the release state.

## Non-negotiable safety rules

### 1. `prepare` ≠ `submit` ≠ `release`

| Verb | Does | Public impact |
|---|---|---|
| `prepare` | Version, build, gate, produce an artifact | **none** |
| `submit` | Upload to TestFlight / a Play track / review | **none for the public** |
| `release` / `ship production` | Publish to users, or advance a rollout | **yes** |

Never collapse them. "Prepare an iOS release" must not publish to the App Store.
**Any operation with public impact requires explicit confirmation naming the platform
and the version**, even when the original request was broad. "Release 10Q" authorises
preparing all three; it does not authorise publishing any of them.

### 2. Never publish on an inferred intent

If scope is ambiguous — which platforms, prepare versus publish, which rollout
percentage — **ask**. Publishing to a store is not reversible.

### 3. Gates are not advisory

A lane does not advance until its gates pass. If a gate fails, report it and stop. Do
not offer to skip one. If the user explicitly overrides a gate, state plainly what risk
is being accepted and record it in the release notes.

### 4. Version skew is permanent

Web, iOS and Android do not go public simultaneously, and store binaries stay installed
for months. Never treat an API change as atomic across clients. A change requiring a
coordinated client update is a feature-flag problem, not a release-timing problem.

### 5. Backend before clients

Backend deploys precede the clients that depend on them and must stay compatible with
every client version still in the field. See [backend](../backend/SKILL.md).

### 6. Never commit secrets or signing material

Keystores, provisioning profiles, `.p8` keys and App Store Connect API keys never enter
the repo. Reference them by path, confirmed out of band.

### 7. Hand off what only a human can do

Apple Developer enrolment, certificate generation, anything needing a password, 2FA or
an authenticated store console session. State clearly what the human must do and what
you need back.

## Operating procedure

### Step 1 — Establish current state

Never act before knowing where things stand.

```bash
friday release status
```

If a source is unavailable, say which. **Do not guess.**

### Step 2 — Determine scope

Which platforms does this change actually affect? A backend-only or web-only change
should not trigger a mobile release. Mobile releases cost store review; spend them
deliberately.

### Step 3 — Preflight and cut

```bash
friday release preflight     # clean tree, current with main, gates, credentials
friday release prepare 1.8.0 # establishes version, SHA, tag, release notes
```

Preflight failing stops everything. The cut is what makes the release state canonical —
after it, every lane refers to the same SHA.

### Step 4 — Backend first

Confirm the backend is verified and active for this SHA before any client lane starts.

### Step 5 — One lane, one transition, then stop

Execute a single state transition. Report the outcome. Confirm before the next,
especially before anything with public impact. Route into the lane skill at this point,
not before.

### Step 6 — Verify and observe

After any transition, confirm it took effect and check observability filtered by
`client_platform` and `release`. After a rollout step, print the go/no-go block and
**ask**:

```
Play rollout:       10%
  crash-free rate   99.4%   (previous release 99.5%)
  new issues        0 significant
  game starts       normal
  completion rate   normal
→ Safe to promote to 50%?
```

Never advance a rollout automatically because signals look fine.

## The rollback asymmetry

**Web rollback is real. Mobile rollback does not exist.**

For mobile the levers are: halt the rollout, forward-fix through expedited review,
kill-switch via a feature flag, or the minimum-supported-version gate. Know which
apply before promising anything to anyone.

Contain first, diagnose second. Halting a rollout is fast and reversible; understanding
root cause is not urgent while users are affected.

## Prohibitions

- **Never** publish, promote or advance a rollout without explicit per-platform
  confirmation naming the version.
- **Never** let a lane derive its own version, SHA or tag.
- **Never** start a client lane before the backend is verified for that SHA.
- **Never** bypass a Friday refusal with `xcodebuild`, Gradle, `wrangler`, `gh` or a
  store console to accomplish the same transition.
- **Never** promise a mobile rollback.

## The lanes

| Lane | Load when |
|---|---|
| [release-web](../release-web/SKILL.md) | The web lane is the next transition |
| [release-ios](../release-ios/SKILL.md) | The iOS lane is the next transition |
| [release-android](../release-android/SKILL.md) | The Android lane is the next transition |

Load **one**, when its transition is next. An agent that loads all three at once tends
to run them as a batch, which is precisely what the per-platform confirmation rule
exists to prevent.
