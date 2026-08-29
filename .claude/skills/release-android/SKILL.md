---
name: release-android
description: The 10Q Android release lane — static export, Capacitor sync, Gradle build, signing, AAB upload to Google Play, testing tracks, staged rollout and verification. Covers the state machine and its decision points, including what only a human can do. Load only when the Android lane is the next transition in a release; the release skill decides whether Android should ship.
---

# Release — Android

The Google Play lane for 10Q (`com.play10q.app`). **[release](../release/SKILL.md) owns
whether Android should ship and at what version. This skill owns how the Play lane
works.** Load it when the Android transition is next.

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

## The state machine

```
release state (version · versionCode · SHA)
      │  friday release android build
      ▼
 static export → cap sync android → Gradle bundle → signed AAB
      │  friday release android submit        ← no public impact
      ▼
 Play Console → internal / closed / open track
      │ promote to production                 ← PUBLIC IMPACT · explicit confirmation
      ▼
 staged rollout   1% → 10% → 50% → 100%       ← each step is its own decision
```

Android's staged rollout is the most controllable lane 10Q has. **Use it.** Going
straight to 100% discards the only real safety mechanism here.

## Version and build identity

From the release state, never from Gradle. `versionCode` must increase monotonically;
Play rejects a duplicate.

```bash
friday release android build
```

Runs the export, syncs Capacitor, builds and signs the AAB. Refuses on a dirty tree or a
SHA mismatch with the release state.

## Submitting and promoting

```bash
friday release android submit      # to a testing track — no public impact
```

Promoting to production, and every rollout increase, has public impact and needs
explicit confirmation naming the platform and version.

Before each increase, print the go/no-go block and ask:

```
Play rollout:       10%
  crash-free rate   99.4%   (previous release 99.5%)
  new issues        0 significant
  game starts       normal
→ Safe to promote to 50%?
```

**Never advance automatically because signals look fine.** Signals looking fine is the
precondition for asking, not a substitute for it.

## Halting

A staged rollout can be **halted** — the closest thing to a rollback that mobile has.
It stops further users receiving the build; it does **not** remove it from users who
already have it. Halting is fast and reversible, so halt first and diagnose second.

## Signing and credentials

The upload keystore and the Play service-account JSON **never enter the repo**, and
neither does any password. `friday system doctor` reports whether they resolve.

Play App Signing means the upload key is not the key users verify against. Losing the
upload key is recoverable; the `assetlinks.json` published for the release signing key
must match, or deep links silently stop resolving.

## What only a human can do

- Play Console account and agreement acceptance
- Keystore generation and custody
- Store listing, content rating, data-safety declarations
- The decision to promote to production or advance a rollout

## Prohibitions

- **Never** run Gradle or `bundletool` directly to work around a Friday refusal.
- **Never** promote to production or advance a rollout without explicit confirmation.
- **Never** ship an AAB whose SHA is not in the release state.
- **Never** reuse a `versionCode`.
- **Never** go straight to a 100% rollout for a release carrying meaningful change.
- **Never** ship a JS-only change without a store release. Capacitor OTA is out of scope.

## Related skills

| Skill | Use it for |
|---|---|
| [release](../release/SKILL.md) | Whether Android should ship, and at what version |
| [release-ios](../release-ios/SKILL.md) | The parallel lane — do not run both at once |
