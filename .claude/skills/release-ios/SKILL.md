---
name: release-ios
description: The 10Q iOS release lane — static export, Capacitor sync, Xcode archive, signing, upload to App Store Connect, TestFlight, App Review and phased release. Covers the state machine and its decision points, including what only a human can do. Load only when the iOS lane is the next transition in a release; the release skill decides whether iOS should ship.
---

# Release — iOS

The Apple distribution lane for 10Q (`com.play10q.app`). **[release](../release/SKILL.md)
owns whether iOS should ship and at what version. This skill owns how the Apple lane
works.** Load it when the iOS transition is next.

This is not general iOS development. It is getting a cut release onto Apple's rail.

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
release state (version · build · SHA)
      │  friday release ios build
      ▼
 static export → cap sync ios → xcodebuild archive → signed IPA
      │  friday release ios submit          ← no public impact
      ▼
 App Store Connect → TestFlight
      │  submit for review                  ← human decision
      ▼
 App Review  ──rejected──▶ fix, new build, resubmit
      │ approved
      ▼
 release / phased release                   ← PUBLIC IMPACT · explicit confirmation
```

Each arrow is a separate decision. **Never run two in one action** because the previous
one succeeded.

## Version and build identity

Comes from the release state, never from Xcode and never invented here. The build
number must increase monotonically — Apple rejects a duplicate, and it is the only
thing distinguishing two uploads of the same version.

```bash
friday release ios build
```

Friday derives the identifiers, runs the static export, syncs Capacitor, archives and
signs. It refuses if the working tree is dirty or the SHA does not match the release
state, because an IPA that cannot be traced to a commit is unsupportable the moment it
crashes.

## Submitting

```bash
friday release ios submit
```

Uploads to App Store Connect and TestFlight. **No public impact** — this is the safe
half of the lane and can be done freely.

Sending a build to **App Review** is a separate, deliberate action. Approval does not
publish either: an approved build sits until released.

## Releasing to the public

**This is irreversible. There is no rollback.** Requires explicit confirmation naming
the platform and version, per rule 1 in [release](../release/SKILL.md).

Prefer **phased release** so a bad build reaches a fraction of users before everyone.
The levers if something is wrong are: pause the phased release, expedited review with a
fix, a feature-flag kill switch, or the minimum-supported-version gate. **Never promise
a rollback.**

## Signing and credentials

Certificates, provisioning profiles and the App Store Connect `.p8` key **never enter
the repo**. They are referenced by path, confirmed out of band. `friday system doctor` reports
whether they resolve, without printing them.

Release builds need the production APNs entitlement. A build signed for development
will upload and then fail to deliver notifications in a way that looks like a backend
bug — check the entitlement before debugging the server.

## What only a human can do

State clearly what you need and stop:

- Apple Developer enrolment, and any renewal
- Certificate and provisioning profile generation
- Anything requiring an Apple ID password or 2FA
- Accepting agreements in App Store Connect
- The final decision to submit for review or release to the public

## Prohibitions

- **Never** run `xcodebuild`, `altool` or `xcrun notarytool` directly to work around a
  Friday refusal.
- **Never** publish, or advance a phased release, without explicit confirmation.
- **Never** ship an IPA whose SHA is not in the release state.
- **Never** reuse a build number.
- **Never** promise a rollback.
- **Never** ship a JS-only change without a store release. Capacitor OTA updates are out
  of scope; Apple guideline 2.5.2 constrains this. Say so rather than improvising.

## Related skills

| Skill | Use it for |
|---|---|
| [release](../release/SKILL.md) | Whether iOS should ship, and at what version |
| [release-android](../release-android/SKILL.md) | The parallel lane — do not run both at once |
