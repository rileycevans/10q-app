# Observability — One PostHog Project, One Sentry Project, Dimensioned by Platform

**Requirement:** all analytics flow through a single PostHog project and all errors through a single Sentry project — but we must always be able to tell which platform a signal came from. One product funnel, one error stream, sliceable by `web` / `ios` / `android`.

**Anti-goal:** three parallel projects, or platform-prefixed event names like `ios_quiz_start`. Those make the one question we most want to answer — *"is completion rate worse on Android?"* — require manual union queries forever.

---

## The identifier set

Every release stamps the same five identifiers into **both** PostHog and Sentry. This is the contract that ties observability to [release engineering](release/RELEASE_ARCHITECTURE.md).

| Identifier | Example | Source |
|---|---|---|
| `release_sha` | `af86e61` | git SHA at build time |
| `client_platform` | `web` \| `ios` \| `android` | build target |
| `app_version` | `1.4.0` | version source of truth — see [VERSIONING.md](release/VERSIONING.md) |
| `app_build` | `42` | monotonic build number, shared by iOS `CFBundleVersion` and Android `versionCode` |
| `environment` | `production` \| `staging` \| `development` | build config |

**None of these exist today.** There is no version file, zero git tags, Sentry sets `environment: process.env.NODE_ENV` (so everything is `production`), no Sentry `release` is set at all, and PostHog registers no super properties. Establishing the identifiers is a prerequisite for both pillars, not a nice-to-have.

Because `NEXT_PUBLIC_*` values are inlined at build time, these are baked into the artifact. That is exactly what we want for a store binary — the identifiers describe the bundle a user is actually running, which may be months old.

---

## PostHog

### Why this is cheap

All 16 events already route through **one** `capture()` helper:

```
apps/web/src/lib/analytics.ts:14-21   ← single choke point
```

So registering super properties once means every current and future event inherits the platform dimension automatically. No event call sites change. This is roughly a five-line diff and it is **identical work under Capacitor or Expo**.

### The change

In `apps/web/src/lib/posthog.ts` (init is currently 4 lines at `:17-20`), after `posthog.init(...)`:

```ts
posthog.register({
  client_platform: process.env.NEXT_PUBLIC_CLIENT_PLATFORM ?? 'web',
  app_version:     process.env.NEXT_PUBLIC_APP_VERSION,
  app_build:       process.env.NEXT_PUBLIC_APP_BUILD,
  release_sha:     process.env.NEXT_PUBLIC_RELEASE_SHA,
  environment:     process.env.NEXT_PUBLIC_ENVIRONMENT ?? 'production',
});
```

`register()` sets **super properties** — persisted and attached to every subsequent event. Prefer this over `setPersonProperties` for these five: they describe the *build emitting the event*, not the person. A user who plays on web and iOS must produce events with different `client_platform` values under the **same** `distinct_id`.

### Identity must stay unified — this is the part that is easy to get wrong

Identity is the Supabase auth user id (`AuthButton.tsx:54-56`), and it survives the anonymous→OAuth upgrade because `linkIdentity` preserves the user id. **Do not change this.** It is what makes one funnel possible across platforms.

Two rules:

1. **Never fork `distinct_id` by platform.** The same human on web and iOS is one person with two `client_platform` values.
2. **Anonymous users get no person profile.** posthog-js defaults to `person_profiles: 'identified_only'`, and `identifyUser` fires only for non-anonymous users — anonymous players get `setPersonProperties({ is_anonymous: true })` instead. Since 10Q is anonymous-first, **most sessions have no person profile**. Build funnels on events and super properties, not on person properties.

### Capacitor-specific settings

```ts
persistence: 'localStorage'   // native builds only
```

posthog-js defaults to `'localStorage+cookie'`, which is unreliable under `capacitor://localhost`. Same root cause as the Supabase session problem in [02-current-state.md §2](02-current-state.md).

Also reconsider for native:
- **`autocapture` is currently ON** and never overridden. It ships DOM click/change/submit events as `$autocapture`. Decide deliberately whether that is wanted in a native binary — it is high-volume, it captures element text, and it feeds the App Privacy and Data Safety declarations in [FIRST_STORE_RELEASE.md](release/FIRST_STORE_RELEASE.md).
- **There are no `$pageview` events at all.** `capture_pageview: false` plus `capture_pageleave` defaulting to `"if_capture_pageview"` means `screen_view` is the only navigation signal. That is fine and arguably better for an app — just know it, because most PostHog funnel templates assume `$pageview`.
- **Session recording** is not disabled in code, so whether it records is decided by PostHog remote config. Decide explicitly before shipping a binary.

### Event taxonomy

The de facto contract is the TypeScript signatures in `apps/web/src/lib/analytics.ts` plus its 24 tests, which pin exact event names and property shapes. **Keep it that way** — the taxonomy is code, not a wiki page. (The only written taxonomy was in the old MVP plan and named five events that do not exist; it has been deleted.)

**Rule for new events: add them to `analytics.ts` as a typed wrapper.** Never call `posthog.capture()` directly from a component — that is how the choke point erodes and the platform dimension starts going missing.

### Platform-specific events

A small number are genuinely native-only and should be named for what they are, not prefixed by platform (`client_platform` already tells you):

`push_permission_requested`, `push_permission_granted`, `push_notification_opened`, `deep_link_opened`, `app_backgrounded_mid_quiz`, `app_resumed_mid_quiz`, `offline_answer_queued`, `offline_queue_drained`, `share_sheet_opened`.

Note the last one: `share_clicked` already exists and today only copies to clipboard. When the native share sheet lands, keep `share_clicked` firing at the same point so the historical funnel stays continuous, and add `share_sheet_opened` for the new step.

### Feature flags

Zero usage today. They become load-bearing for [rollouts](release/ROLLOUTS.md) — flags are the decoupling tool that lets a cross-platform feature appear simultaneously despite staggered store approvals, and the kill switch when mobile cannot roll back.

---

## Sentry

### Current state

Three near-identical inits sharing one DSN: `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`. `tracesSampleRate: 0` everywhere, no Session Replay — so Sentry is errors plus structured logs, wired to `apps/web/src/lib/logger.ts`.

Under static export the server and edge configs become dead (they gate on `NEXT_RUNTIME`, which does not exist), and they are already near-dead weight because there is nothing to instrument. **Client Sentry ports as-is.**

### The two gaps that matter

**1. `environment` cannot distinguish anything.** It is `process.env.NODE_ENV`, which yields only `development` or `production` — and with one deploy target, everything is `production`. iOS and Android would land in the same undifferentiated bucket.

**2. No `release` is set, and no `dist`.** The Next Sentry plugin auto-derives a git SHA at build time, which is adequate for web, where the deployed version is whatever shipped last. **It is not adequate for mobile**, where old bundles stay installed indefinitely.

### The change

```ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT ?? 'production',
  release: `10q@${process.env.NEXT_PUBLIC_APP_VERSION}`,
  dist: process.env.NEXT_PUBLIC_APP_BUILD,
  initialScope: {
    tags: {
      client_platform: process.env.NEXT_PUBLIC_CLIENT_PLATFORM ?? 'web',
      release_sha: process.env.NEXT_PUBLIC_RELEASE_SHA,
    },
  },
  enableLogs: true,
  tracesSampleRate: 0,
});
```

**Use `environment` for the deployment stage** (`production` / `staging` / `development`) and a **`client_platform` tag** for the platform. Do not encode platform into `environment` — Sentry's environment filter is a coarse global selector, and you want to see a cross-platform regression in one view, then slice.

`release` + `dist` is the pairing Sentry uses for mobile symbolication. `release` alone is not enough when the same `app_version` can have several builds.

### Source maps are the operationally hard part

Web can afford to be casual: the deployed bundle is current, so the latest uploaded sourcemap matches. **Mobile cannot.** A crash report arriving today may come from a binary reviewed and shipped four months ago.

Rules:
1. Upload sourcemaps for **every** native build, keyed to that exact `release` + `dist`.
2. **Archive the built bundle and its sourcemaps per store version** — the artifact must be retrievable long after the branch has moved on.
3. Never reuse a `dist` for a different bundle. A rejected build that was uploaded still consumed its number.

There is a related defect today: `SENTRY_AUTH_TOKEN` is present in **both** the CI build job and the deploy job (`ci.yml:44` and `:84`), so each commit can produce two sourcemap uploads for the same release — from two builds that are not identical, because the CI build lacks the PostHog env the deploy build has. Fix that CI drift before adding a third build target.

---

## What good looks like

Once the identifiers land, these are answerable without a union query:

- Completion rate by `client_platform`, filtered to `app_version = 1.4.0`.
- Crash-free session rate for `ios` at `dist = 42` versus `dist = 41` — the promotion gate in [ROLLOUTS.md](release/ROLLOUTS.md).
- Auth failure rate on `android` after the OAuth rework, isolated from web.
- How many users are still on an `app_version` below the minimum supported — the input to the force-upgrade decision in [VERSIONING.md](release/VERSIONING.md).
- Whether an error is web-only (likely a Cloudflare/middleware issue) or all-platform (likely a shared React or Edge Function issue) — a one-tag distinction that saves real triage time.

---

## Privacy and store disclosure

What these SDKs collect drives the **App Privacy** answers on Apple and the **Data Safety** declaration on Google, and both explicitly cover third-party SDK behavior. See [FIRST_STORE_RELEASE.md](release/FIRST_STORE_RELEASE.md).

Two things to be accurate about rather than cautious about:

**ATT is not automatically triggered by PostHog.** App Tracking Transparency is required when data is used to track a person across *other companies'* apps and websites for advertising or measurement, or is shared with a data broker. First-party product analytics that are not used that way do not require it. 10Q today runs first-party product analytics with no ad SDK, no attribution SDK, and no data-broker sharing. **Re-check this the moment an ads or attribution SDK is added** — that is what would change the answer, not PostHog's presence.

**Autocapture and session recording are the two settings that most affect the disclosure**, because they broaden what is collected beyond the 16 declared events. Decide both explicitly before the first store submission rather than inheriting the defaults.

---

## Implementation checklist

- [ ] Establish the version source of truth ([VERSIONING.md](release/VERSIONING.md)) — blocks everything else here
- [ ] Add the five `NEXT_PUBLIC_*` identifier vars to `.env.example`, CI build **and** deploy jobs, and the native build config
- [ ] Fix the CI/deploy env drift so both jobs build the same artifact
- [ ] `posthog.register({...})` in `initPostHog()`
- [ ] `persistence: 'localStorage'` for native builds
- [ ] Decide autocapture and session recording for native; record the decision here
- [ ] Sentry `environment` + `release` + `dist` + `client_platform` tag
- [ ] Per-build sourcemap upload with archival retrievable per store version
- [ ] Delete the dead `sentry.server.config.ts` / `sentry.edge.config.ts` paths from the native build
- [ ] Add the native-only events listed above as typed wrappers in `analytics.ts`
- [ ] Build the promotion-gate dashboard queries in [ROLLOUTS.md](release/ROLLOUTS.md)
