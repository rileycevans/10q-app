# Android Release — Capacitor Export to Google Play

**Scope:** everything between a green `main` and a 10Q build running on a stranger's Android phone. Prerequisites and account setup, the build chain, signing, Sentry pinning, Play testing tracks, Managed Publishing, staged rollout, the Data safety declaration, target API level, and the automation boundary.

**Read first:** [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) for the release state machine, and [VERSIONING.md](VERSIONING.md) — this doc consumes `app_version` and `app_build` and does not define them. The operator skill that routes here is `.claude/skills/release/SKILL.md`.

**Sibling channels:** [WEB.md](WEB.md) · [IOS.md](IOS.md). They are three independently controllable channels. See [Version skew](#112-version-skew-is-permanent-on-android) — it is not optional reading.

---

## 0. Read this before you touch anything

### 0.1 What exists today: nothing

Verified against the repo at the time of writing:

| Thing | State |
|---|---|
| `android/` Capacitor project | **Does not exist.** No `capacitor.config.*`, no `@capacitor/*` dependency anywhere |
| `assetlinks.json` | **Does not exist.** `apps/web/public/` contains exactly one entry: `brand/` |
| Versioning | **None.** Zero git tags in history; all three `package.json` files say `"0.1.0"` and never move |
| `scripts/release/` | **Empty directory.** `scripts/build-native.sh` does not exist either |
| Play Console account | Unknown / not set up — see [1.1](#11-play-console-developer-account-human) |
| Non-production environment | **Does not exist.** One Supabase project, one Cloudflare Worker, one PostHog key, one Sentry DSN |

So this document describes the target procedure. Where a step depends on machinery that is not built yet, it says so. The build order is [05-migration-plan.md](../05-migration-plan.md) Phases 2, 3, 5 and 9.

### 0.2 DECISION REQUIRED placeholders

Do **not** invent values for these. They are one-way doors or they need a human with an account.

| Placeholder | What it is | Constraint | Who decides |
|---|---|---|---|
| `<APPLICATION_ID>` | Android `applicationId`, e.g. `com.example.tenq` | **Immutable after the first upload.** Changing it means a new Play listing and every user reinstalls. **Must be identical to the iOS bundle id** ([IOS.md](IOS.md)) — one identity for one product, and it is what `assetlinks.json` and the App Links intent filter key on | Riley |
| `<PLAY_ACCOUNT_TYPE>` | `organization` or `personal` | Drives whether the **12-tester / 14-day gate** applies ([4.4](#44-the-12-tester--14-day-production-gate-personal-accounts)). This decision has a **≥14 day schedule consequence** — make it early | Riley |
| `<KEYSTORE_CUSTODY>` | Where the upload keystore and its passwords live | Not the repo. Not an unencrypted shared drive. See [1.4](#14-the-upload-keystore-and-its-custody-human) | Riley |
| `<CAP_ROOT>` | Directory containing `capacitor.config.ts` and therefore `android/` | The Capacitor CLI roots at `process.cwd()` — there is no `--config` flag and no config env var, so the config file must sit in whatever directory you run `npx cap` from. This doc assumes **`apps/mobile/`** as its own workspace package; [05-migration-plan.md](../05-migration-plan.md) Phase 5 lists `capacitor.config.ts`, `ios/`, `android/` without pinning a directory. Pick one, then find-and-replace in this doc | Riley + the agent building Phase 5 |
| `<PLAY_SERVICE_ACCOUNT>` | Google Cloud service account with the `androidpublisher` scope, JSON key | Secret. Never committed. Stored as a GitHub Actions secret | Riley |
| Native crash reporting | Whether to add `@sentry/capacitor` alongside `@sentry/nextjs` | See [3.4](#34-what-sentrynextjs-does-not-catch-on-android) — without it, ANRs and native crashes appear in Play Console vitals only, never in Sentry | Riley |

### 0.3 The one deadline that is imminent

**From August 31, 2026, new apps and app updates must target Android 16 (API level 36) or higher.** That gates the ability to submit anything at all. See [8. Target API level](#8-target-api-level). A first Android release realistically lands after that date, so **build against API 36 from day one** rather than shipping API 35 and immediately being unable to update.

### 0.4 Not in scope

**Capacitor OTA / Appflow live updates are explicitly deferred.** V1 ships JS changes through the store, same as native changes. See [11.3](#113-ota-is-deferred-and-why-it-is-not-free-on-android).

---

## 1. Prerequisites — one-time, mostly human

Everything in this section requires an authenticated human session, a legal identity, or possession of a secret. **An agent cannot do any of it.** Start these early; several have multi-day or multi-week lead times and block nothing else. The account and listing runbook proper is [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) — this section covers the Android-specific parts and what the agent needs handed back.

### 1.1 Play Console developer account (human)

One-time $25 registration, identity verification, and — from **September 30, 2026** — Android developer verification. New Play Console Requirements effective that date: every app on Play must be registered in Play Console, **package names must be registered via Play Console**, and unregistered apps face "global removal from Google Play."

**Organization vs personal is a real decision, not a formality:**

| | Personal account | Organization account |
|---|---|---|
| Requires | Individual identity verification | D-U-N-S number consistent with the Dun & Bradstreet profile |
| 12-tester / 14-day production gate | **Yes**, if created after 2023-11-13 | **No** |
| Required for | — | Financial, health, VPN and government apps (10Q is none of these) |

10Q is a trivia game, so a personal account is permitted. **The cost of personal is the 12-tester / 14-day gate**, which puts a hard ≥14-day floor between "first closed-test build" and "eligible to apply for production." If the launch date matters, decide this before anything else. See [4.4](#44-the-12-tester--14-day-production-gate-personal-accounts).

**Hand back to the agent:** account type, developer name as it will appear on the listing.

### 1.2 App record (human, once)

Play Console → **All apps → Create app**. This cannot be done by the Play Developer API — app creation and the legal consents are explicitly Console-only.

The same page fixes `<APPLICATION_ID>` forever. Get it right: it must match the iOS bundle id, and it is the `package_name` in `assetlinks.json`.

**Also Console-only, and each is a blocking pre-review check:**

- IARC content rating questionnaire — answer it **after** the UGC moderation work lands ([03-blocking-fixes.md B2](../03-blocking-fixes.md)); UGC presence changes the answers
- Target audience and content declarations
- Data safety form — see [7. Data safety](#7-data-safety-declaration)
- Privacy policy URL — **required unconditionally**, even if you collected nothing. Does not exist yet ([03-blocking-fixes.md B4](../03-blocking-fixes.md))
- **Demo account and sign-in details for review.** Play Console Requirements mandate active demo accounts plus any resources reviewers need. 10Q is anonymous-first so the quiz needs no login, but leagues do — supply one anyway, and repeat the [STORE_READINESS.md](../STORE_READINESS.md) reviewer note that **the daily quiz drops at 11:30 UTC**; before that a reviewer sees a countdown, not a game

**Hand back to the agent:** the confirmed `<APPLICATION_ID>`, and confirmation that the app record exists (nothing in the automation path works until it does).

### 1.3 Play App Signing (human, once)

**Not optional in practice.** Google's own wording: "Because app bundles defer building and signing APKs to the Google Play Store, you need to configure Play App Signing before you upload your app bundle." AAB has been mandatory for new apps since August 2021, so every new app is enrolled. New apps are now auto-enrolled in **quantum-ready hybrid signing with Google-generated keys**.

The distinction that causes the most confusion:

| | **Upload key** | **App signing key** |
|---|---|---|
| Who holds it | You | Google (Cloud KMS) |
| What it signs | The AAB you upload | The APKs Play generates and delivers to devices |
| Size | ≥ 2048-bit RSA (use 4096) | Google-generated 4096-bit RSA; a supplied key must be ≥ 2048-bit |
| Lifetime | Rotatable | Constant for the app's lifetime |
| If lost | **Recoverable** — request a reset in Play Console by submitting a PEM certificate for a new upload key | You cannot retrieve a copy. Google keeps a disaster-recovery backup. (Without Play App Signing, a lost app signing key is **unrecoverable** and forces a new package name and a new listing) |
| SHA-256 you put in `assetlinks.json` | **No** (but include it too — see [1.5](#15-assetlinksjson-for-app-links-on-play10qcom-human--agent)) | **Yes, this is the one that matters** |

Key upgrade is supported (roughly once a year) via Play Console → **Test and release → Setup → App integrity → Upgrade key**, for compromise or stronger crypto. The new key signs installs and updates on Android 13+; the old key keeps signing updates for earlier Android versions, so the update chain does not break.

> **Cross-consequence that is easy to miss:** an app signing key upgrade changes the SHA-256 fingerprint. `assetlinks.json` on `play10q.com` must be updated to list **both** fingerprints in the same window, or App Links silently stop verifying for a slice of your users.

### 1.4 The upload keystore and its custody (human)

Generate it once:

```bash
keytool -genkeypair -v \
  -keystore 10q-upload.jks \
  -alias 10q-upload \
  -keyalg RSA -keysize 4096 \
  -validity 10000
```

**The keystore must NOT be committed to this repo. Neither must its passwords.**

This is not theoretical hygiene — the repo does not currently protect you:

- Root `.gitignore` has **no** `*.jks`, `*.keystore`, `*.p12` or `key*.properties` entries. Verified: `git check-ignore -v apps/mobile/android/keystore/upload.jks` reports **not ignored**.
- Capacitor's generated `android/.gitignore` ships keystore ignore lines **commented out by default**.

So the PR that creates the Capacitor Android project must also add explicit ignore rules:

```gitignore
# Android signing — never commit
*.jks
*.keystore
*.p12
keystore.properties
key.properties
version.properties
```

**Where it should actually live:**

| Copy | Location | Purpose |
|---|---|---|
| Primary | `<KEYSTORE_CUSTODY>` — a password manager / secrets vault entry (1Password or equivalent) holding the `.jks` as an attachment **plus** `storePassword`, `keyAlias`, `keyPassword` as fields | Human recovery |
| Backup | Encrypted offline copy, separate from the vault | Vault-loss recovery |
| CI | GitHub Actions secret `ANDROID_KEYSTORE_BASE64` (`base64 -i 10q-upload.jks`), plus `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Automated builds |
| Local dev machine | `~/.10q/android/10q-upload.jks`, referenced by an **absolute path** from an untracked `keystore.properties` outside the repo tree | Local release builds |

In CI, decode to a path under the runner's temp dir, never into the workspace, and let the runner's ephemeral disk be the deletion mechanism:

```yaml
- run: echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$RUNNER_TEMP/upload.jks"
  env: { ANDROID_KEYSTORE_BASE64: "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" }
```

This is safety rule 6 in `.claude/skills/release/SKILL.md`: *never commit secrets or signing material*. If a procedure needs the keystore, confirm its location out of band and reference it by path.

### 1.5 `assetlinks.json` for App Links on `play10q.com` (human + agent)

Android App Links (the auto-verified `https://` deep links that open the app instead of Chrome) require a Digital Asset Links file served from the domain. This is the Android counterpart of the AASA file in [IOS.md](IOS.md). Deep links are [05-migration-plan.md](../05-migration-plan.md) Phase 6 and are the invite growth loop, so treat this as load-bearing, not a footnote.

**File location in this repo:**

```
apps/web/public/.well-known/assetlinks.json   →  https://play10q.com/.well-known/assetlinks.json
```

**Content:**

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "<APPLICATION_ID>",
    "sha256_cert_fingerprints": [
      "<PLAY_APP_SIGNING_KEY_SHA256>",
      "<UPLOAD_KEY_SHA256>"
    ]
  }
}]
```

**The single most common failure is using the upload key fingerprint instead of the app signing key's.** Play re-signs your AAB, so the APK on a user's device carries the **app signing key**. Get the correct value from Play Console → **Test and release → Setup → App integrity → App signing** — that page also generates the exact JSON for you. Include the upload-key fingerprint as a second entry so locally-built `bundleRelease` APKs and Internal app sharing builds also verify; extra fingerprints are harmless.

**Serving requirements:** HTTPS, HTTP 200, **no redirect**, `Content-Type: application/json`.

Two repo-specific checks before you trust it:

1. `apps/web/wrangler.jsonc` routes both `play10q.com/*` and `www.play10q.com/*`. Whichever hostnames appear in the `<intent-filter>` `android:host` attributes must each serve the file.
2. Cloudflare serves static assets **without invoking the Worker** — `wrangler.jsonc` sets neither `run_worker_first` nor `not_found_handling`, so `src/middleware.ts:34`'s `Cache-Control: no-store` never applies to this file. Good. But **verify the dotfile directory actually survives the OpenNext build**: after `npm run build --workspace=apps/web`, confirm `apps/web/.open-next/assets/.well-known/assetlinks.json` exists, then `curl -sI https://play10q.com/.well-known/assetlinks.json` after deploy and check for `200` and `application/json`.

**Verification:**

```bash
# Google's own statement-list resolver
curl -s 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://play10q.com&relation=delegate_permission/common.handle_all_urls'

# On a device with the app installed
adb shell pm verify-app-links --re-verify <APPLICATION_ID>
adb shell pm get-app-links <APPLICATION_ID>     # expect: play10q.com  verified
```

**Ordering matters:** verification runs at install time. Publish `assetlinks.json` to `play10q.com` **before** the first build that declares `android:autoVerify="true"` reaches testers, or those installs come up unverified and you will chase a ghost.

---

## 2. The build chain

One direction, five steps. Every step is agent-executable once the machinery from Phases 2–5 exists.

```
version bump  →  next build (output:'export')  →  npx cap sync android  →  ./gradlew bundleRelease  →  signed .aab
  VERSIONING       scripts/build-native.sh          <CAP_ROOT>              <CAP_ROOT>/android         upload artifact
```

### 2.1 Preflight

```bash
scripts/release/preflight android
```

Confirms: clean tree, branch current with `main`, gates from [../TESTING.md](../TESTING.md) pass, version identifiers resolve, keystore and `<PLAY_SERVICE_ACCOUNT>` credentials are present. **Never proceed past a failed preflight.** Gates are not advisory (skill safety rule 3).

Android-specific additions to preflight:

- [ ] `versionCode` strictly greater than the highest `versionCode` ever uploaded **on any track**, not just production (see [2.5](#25-versioncode-and-versionname))
- [ ] `targetSdkVersion` ≥ 36 (see [8](#8-target-api-level))
- [ ] No outstanding/unpublished release on the target track (see [4.5](#45-the-outstanding-release-blocker))
- [ ] `assetlinks.json` live and resolving, if this build declares `autoVerify`

### 2.2 Version bump

[VERSIONING.md](VERSIONING.md) owns this. Android consumes two values:

| Identifier | Android field | Rules |
|---|---|---|
| `app_version` | `versionName` | User-facing string. Play enforces **no** format and **no** ordering, and it plays no role in update eligibility |
| `app_build` | `versionCode` | Positive integer, invisible to users. **Must strictly increase. Cannot be reused** — Play rejects an upload with a `versionCode` you have already used. Max 2,100,000,000 |

Define both in Gradle's `defaultConfig`, not `AndroidManifest.xml`, to avoid manifest-merge conflicts. Drive them from one generated, untracked file so the same numbers reach the bundle, PostHog and Sentry:

```gradle
// <CAP_ROOT>/android/app/build.gradle
def versionProps = new Properties()
def versionPropsFile = rootProject.file("version.properties")   // generated by scripts/release, gitignored
if (versionPropsFile.exists()) { versionProps.load(new FileInputStream(versionPropsFile)) }

android {
  defaultConfig {
    applicationId "<APPLICATION_ID>"
    versionCode (System.getenv("APP_BUILD")   ?: versionProps['versionCode']).toInteger()
    versionName (System.getenv("APP_VERSION") ?: versionProps['versionName'])
  }
}
```

### 2.3 Build the static export

```bash
scripts/build-native.sh android
```

That script does not exist yet; [04-shared-code-architecture.md](../04-shared-code-architecture.md) specifies it. What it must do, and why a plain `next build` is not enough:

1. Move `apps/web/src/middleware.ts`, `apps/web/src/instrumentation.ts`, `apps/web/sentry.server.config.ts` and `apps/web/sentry.edge.config.ts` aside — these are picked up by **file convention** and cannot be disabled from `next.config.ts`. Trap on `EXIT` so a failed build cannot leave the tree dirty.
2. `BUILD_TARGET=native next build` with **cwd = `apps/web`** — `apps/web/next.config.ts:5` resolves the `@vercel/og` stub through `process.cwd()`.
3. Restore the moved files.

Under `BUILD_TARGET=native` the config must set `output: 'export'`, `trailingSlash: true`, `images: { unoptimized: true }`. Output lands in `apps/web/out/` (already covered by `.gitignore`'s `out/`).

**The five identifiers must be inlined at this step.** `NEXT_PUBLIC_*` is baked in at build time, which is exactly what you want for a store binary — the identifiers describe the bundle the user is actually running, which may be months old.

```bash
NEXT_PUBLIC_CLIENT_PLATFORM=android \
NEXT_PUBLIC_APP_VERSION="$APP_VERSION" \
NEXT_PUBLIC_APP_BUILD="$APP_BUILD" \
NEXT_PUBLIC_RELEASE_SHA="$(git rev-parse --short HEAD)" \
NEXT_PUBLIC_ENVIRONMENT=production \
  scripts/build-native.sh android
```

Two CI checks that belong here and nowhere else:

- Fail if the export output contains `/_next/image` — `images.unoptimized` does **not** error at build time in Next 16; it silently emits references that 404 inside the WebView.
- Fail if `NEXT_PUBLIC_POSTHOG_KEY` is unset. Today `.github/workflows/ci.yml` gives PostHog env to the deploy job (`:85-86`) but **not** the build job (`:38-44`), so CI verifies an artifact that differs from what ships. Do not inherit that drift into a store binary you cannot roll back.

### 2.4 `npx cap sync android`

```bash
cd <CAP_ROOT>
npx cap sync android
```

`sync` = `copy` + `update`. `copy` puts the built web bundle and `capacitor.config.ts` into the native project; `update` installs/updates native Gradle dependencies and refreshes the plugin list.

`webDir` in `capacitor.config.ts` resolves as `resolve(appRootDir, webDir)` where `appRootDir` is `process.cwd()` — so with `<CAP_ROOT>` = `apps/mobile`, `webDir` is `'../web/out'`. Relative `../` paths are supported and are the standard monorepo pattern.

**`cap sync` is mandatory before every release build, in CI too.** Capacitor's shipped `android/.gitignore` deliberately excludes the copied web assets:

```
app/src/main/assets/public
app/src/main/assets/capacitor.config.json
app/src/main/assets/capacitor.plugins.json
app/src/main/res/xml/config.xml
```

A CI job that checks out and runs `./gradlew bundleRelease` without a preceding web build + `cap sync` produces an AAB with **no web app inside it**. That build installs, launches to a blank WebView, and — under Play's Minimum Functionality policy — is exactly the "loads, but is not responsive" failure Google names.

Commit `android/` itself. Capacitor's official position is that each platform project is a *source asset*, not a build-time asset: you check the Android Studio project into source control. The counter-pattern (gitignore `android/`, regenerate with `cap add` in CI) breaks the moment you hand-edit `AndroidManifest.xml` for the OAuth custom scheme, the App Links intent filter, or permissions — none of which are reproducible from `capacitor.config.ts`.

### 2.5 `versionCode` and `versionName`

The rule that surprises people: **keep `versionCode` monotonic across the whole app, not per track.** A device receives the version that "contains the highest version code compatible with the device" *and* "is published to a track the user is eligible to receive." A tester sitting on internal build `47` will not be pushed backward when production later ships `45`. Allocate `versionCode` from one global counter in [VERSIONING.md](VERSIONING.md) and never reset it per track.

Corollary: a build that was uploaded and then abandoned still consumed its number. Never reuse it — on Play it is rejected outright, and in Sentry it would collide with an already-uploaded `dist`.

### 2.6 Signed AAB

```bash
cd <CAP_ROOT>/android
./gradlew clean :app:bundleRelease
# → app/build/outputs/bundle/release/app-release.aab
```

Signing config in `<CAP_ROOT>/android/app/build.gradle`, reading env first (CI) and falling back to an untracked properties file (local):

```gradle
def keystoreProps = new Properties()
def keystorePropsFile = rootProject.file("keystore.properties")   // gitignored
if (keystorePropsFile.exists()) { keystoreProps.load(new FileInputStream(keystorePropsFile)) }

android {
  signingConfigs {
    release {
      storeFile     file(System.getenv("ANDROID_KEYSTORE_PATH")     ?: keystoreProps['storeFile'])
      storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: keystoreProps['storePassword']
      keyAlias      System.getenv("ANDROID_KEY_ALIAS")         ?: keystoreProps['keyAlias']
      keyPassword   System.getenv("ANDROID_KEY_PASSWORD")      ?: keystoreProps['keyPassword']
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.release
      minifyEnabled false     // Capacitor template default
    }
  }
}
```

**Verify the artifact before uploading anything:**

```bash
# Signer certificate — the SHA-256 here must be your UPLOAD key
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab

# versionCode actually baked in
bundletool dump manifest --bundle=app-release.aab \
  --xpath=/manifest/@android:versionCode

# Optional: install locally to smoke-test
bundletool build-apks --mode=universal --bundle=app-release.aab --output=/tmp/10q.apks
```

**Size ceilings:** 200MB maximum compressed download size of the APKs generated from the bundle **for one device** — not the AAB file size. A Next.js export is nowhere near this; it is here so nobody has to look it up.

**If you enable `minifyEnabled true` later**, you take on two new obligations: upload the ProGuard/R8 mapping to Play (deobfuscation files are supported by the Play Developer API and `supply`) *and* upload it to Sentry separately. They are different systems and neither covers the other.

### 2.7 Archive the artifact

Per release, before the AAB leaves the machine, archive to durable storage keyed by `app_version` + `app_build`:

- the `.aab`
- the JS source maps for that exact export
- the resolved `version.properties`
- the `release_sha`

[OBSERVABILITY.md](../OBSERVABILITY.md) is explicit about why: a crash arriving today may come from a binary reviewed and shipped four months ago, and the branch has long since moved.

---

## 3. Sentry on Android

**Same release + dist pinning discipline as iOS.** The mapping is the only Android-specific part.

### 3.1 The pinning

```ts
// apps/web/instrumentation-client.ts — currently 13 lines with no release, no dist,
// and environment: process.env.NODE_ENV (always "production")
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT ?? 'production',
  release: `10q@${process.env.NEXT_PUBLIC_APP_VERSION}`,   // 10q@1.4.0
  dist: process.env.NEXT_PUBLIC_APP_BUILD,                 // "42" — == versionCode
  initialScope: {
    tags: {
      client_platform: 'android',
      release_sha: process.env.NEXT_PUBLIC_RELEASE_SHA,
    },
  },
  enableLogs: true,
  tracesSampleRate: 0,
});
```

| Sentry field | Android source | Why |
|---|---|---|
| `release` | `10q@<versionName>` | Same string on web, iOS and Android for the same version — that is what makes a cross-platform regression one view |
| `dist` | `<versionCode>`, as a string | `release` alone is insufficient: the same `app_version` can have several builds, and on Android several of them can be live at once across tracks |
| `client_platform` tag | `android` | **Do not encode platform into `environment`.** `environment` is the deployment stage; platform is a tag you slice by |

### 3.2 Source maps per build

Non-negotiable on mobile, and materially harder than on web because old bundles stay installed indefinitely.

1. Upload source maps for **every** Android build, keyed to that exact `release` + `dist`.
2. Set the release name and dist on the build plugin (`withSentryConfig` in `apps/web/next.config.ts:41-48`) from the **same env vars** the runtime `Sentry.init` reads. Verify the exact option names against the installed `@sentry/nextjs` (`^9.41.0`, `apps/web/package.json:12`) — do not assume; an artifact bundle uploaded under a different `dist` than the runtime reports is invisible at triage time and looks identical to "no source maps."
3. Never reuse a `dist`. A build that was uploaded and then rejected still consumed its number.
4. Archive the maps alongside the AAB ([2.7](#27-archive-the-artifact)).

**Verification gate before promoting past internal:** trigger a deliberate error in the internal-track build and confirm Sentry shows a symbolicated stack with `client_platform: android` and the right `release`/`dist`. This is in the [STORE_READINESS.md](../STORE_READINESS.md) pre-submission checklist for a reason — an unsymbolicated Android crash stream is functionally no crash reporting at all.

### 3.3 Fix the double-upload drift first

`SENTRY_AUTH_TOKEN` is present in **both** the CI build job (`.github/workflows/ci.yml:44`) and the deploy job (`:84`), so each commit can upload two source-map sets for the same release — from two builds that are **not identical**, because the CI build lacks the PostHog env the deploy build has. Fix that before adding Android as a third uploader, or the Android maps land in a release that already has ambiguous artifacts.

### 3.4 What `@sentry/nextjs` does **not** catch on Android

`@sentry/nextjs` runs inside the WebView. It sees JS errors and the structured logs `apps/web/src/lib/logger.ts` forwards. It does **not** see:

- native crashes in the host process or a Capacitor plugin
- **ANRs** — which on Android are a Play Console vitals metric with a Bad Behaviour threshold that can suppress your store discoverability
- WebView renderer process kills (the classic low-end Android OOM), which look to JS like nothing happened at all

Today those are visible only in **Play Console → Quality → Android vitals**. Adding `@sentry/capacitor` (which wraps `sentry-android`) unifies them into the same Sentry project — marked **DECISION REQUIRED** in [0.2](#02-decision-required-placeholders). Until that decision is made, **Android vitals is a required stop in the promotion gate**, not an optional one. Record that in [ROLLOUTS.md](ROLLOUTS.md).

---

## 4. Testing tracks

Four rungs. They are not interchangeable, and the review characteristics differ sharply.

| Track | Tester limit | Tester mechanism | Review | Time to availability |
|---|---|---|---|---|
| **Internal** | **100 per app** | Email lists (comma-separated or CSV) only — **no Google Groups** | "Internal tests **might** not be subject to standard Play policy or security reviews" | "Available to testers within minutes" |
| **Closed** | Up to **200 lists × 2,000 users**; up to **50 lists per track**. Multiple named closed tracks | Email lists **and** Google Groups (`yourgroup@googlegroups.com`) | **Standard Google review** | Typically up to 7 days, "or longer in exceptional cases" |
| **Open** | **Unlimited** by default. If capped, the cap must be **≥ 1,000** | Public opt-in; discoverable on Play via search or an opt-in link | **Standard Google review** | Same as closed |
| **Production** | Everyone | — | **Standard Google review** | Same, plus rollout mechanics ([6](#6-staged-rollout)) |

**The "might" in the internal row is load-bearing.** It is not "never." If a previous submission was rejected, the next submission — including to the internal track — must be reviewed and approved before it becomes available. **Do not architect a release process that assumes internal is unconditionally review-free.**

### 4.1 Internal app sharing is a different thing

Frequently confused with the internal track:

| | Internal **testing track** | Internal **app sharing** |
|---|---|---|
| Distribution | Track release, opt-in URL | A shareable download link per artifact |
| Limits | 100 testers | 100 downloaders per link; **links expire 60 days after upload** |
| Review | Possibly | None |
| Appears in App bundle explorer | Yes | **No** — and artifacts "aren't shown in your app bundle explorer, nor can they be included in releases on testing or production tracks" |
| Counts toward the 12-tester gate | Yes | **No** |

Use internal app sharing for throwaway QA builds you never intend to promote. Use the internal track for anything on the release ladder.

### 4.2 Promotion mechanics

The **Promote release** control exists on a release's detail view: pick the target track → **Save → Send for review**. It reuses the **same AAB and the same `versionCode`** — no rebuild.

Three caveats, all from practice rather than Google's main docs:

1. **Google's official "Prepare and roll out a release" help page never documents promotion.** It only describes creating a release per track and reusing prior bundles via the **Included** section / **App bundle explorer**. If you cannot find the control, that is why.
2. **Promotion re-triggers review.** Internal → closed → open → production is not free or instant at each hop.
3. The **Promote release** option may not even appear for a closed-track release until that release has finished review.

Plan the ladder around review latency, not around clicks.

### 4.3 The ladder for 10Q

| Step | Track | Who | Exit criterion |
|---|---|---|---|
| 1 | Internal | Riley + up to 100 known testers | Full game loop on a real device: anonymous session survives 3 cold starts and a reinstall, quiz completes end to end, Android hardware back never traps the user in `/play/*`, Sentry shows a symbolicated error, PostHog events carry `client_platform: android` |
| 2 | Closed | ≥ 12 testers, continuously opted in ≥ 14 days if `<PLAY_ACCOUNT_TYPE>` is personal | The 14-day clock satisfied; no new Sentry issue classes; Android vitals clean |
| 3 | Production | Everyone | See [6](#6-staged-rollout). **Remember the first production release cannot be staged** |

Open testing is optional for 10Q. It is worth considering only if you want Play-store discoverability before a full launch; it costs a review cycle and makes the build publicly findable.

### 4.4 The 12-tester / 14-day production gate (personal accounts)

**If `<PLAY_ACCOUNT_TYPE>` is personal and the account was created after 2023-11-13, this is a hard, non-waivable gate on ever reaching production.**

- Run a **closed** test with a minimum of **12 testers** who have been "opted in continuously for at least 14 days."
- The 14 days must be **consecutive per tester**: "If a tester opts out and opts back in later, the 14 days must be consecutive to count toward the minimum requirement." You need 12 testers *simultaneously* satisfying the condition. One tester dropping out resets that tester's clock, not everyone's — but it can drop you below 12.
- Then **Apply for production** from the Play Console Dashboard and answer a written questionnaire: how you recruited testers and how they engaged; target audience and value proposition; what you changed based on feedback and why you consider the app production-ready. This is a human review of prose, not a checkbox. "Review usually takes seven days or less, but can occasionally take longer."

The requirement dropped from 20 testers to 12 in December 2024; the 14-day duration never changed. Organization accounts and personal accounts created on or before 2023-11-13 are exempt.

**Schedule consequence:** even with everything else perfect, personal-account production access is ≥ 14 days of closed testing **plus** up to ~7 days of application review **plus** the production release's own review. Budget four weeks, not four days.

### 4.5 The outstanding-release blocker

Verbatim, and it bites automation hardest:

> "You cannot create a new release when you have outstanding releases. Roll out any staged releases to 100%, or remove changes on the Publishing overview page and discard any unpublished releases first."

A stuck partial rollout or a forgotten draft blocks the next release on that track. Preflight checks this ([2.1](#21-preflight)). In practice the blocker applies to unpublished/draft changes — an in-progress *staged rollout* can be superseded by a new one, which reuses the same cohort ([6.5](#65-overlapping-rollouts)).

---

## 5. Managed Publishing

### 5.1 What it buys you

Managed publishing decouples **review completion** from **going live**:

> "As your changes are reviewed and approved, they'll begin to populate the 'Changes ready to publish' section."

So Google can finish reviewing while your release sits held, and you press **Publish changes** when you choose. That is the Android half of the `submit` ≠ `release` separation in [10](#10-prepare--submit--release-on-android).

Toggle it from **Publishing overview → Managed publishing status**. It "can be turned on or off at any time, including while your change is being reviewed and processed." **Turning it off releases queued approved changes** — so treat the toggle itself as an action with public impact.

### 5.2 What it does *not* hold — read this before relying on it

| Managed publishing **holds** | Managed publishing does **NOT** hold |
|---|---|
| Full and staged rollouts | **Increasing an existing staged rollout to 100%** |
| Pre-registration launch/updates | Release-notes updates |
| Store listing changes | Device exclusion rule changes |
| App content changes | Changes to email-list / Google-group membership on a testing track |
| | Unpublishing the app |
| | In-app products page changes, price changes |
| | Stopping store listing experiments |

The first row on the right is the one that catches people: once a staged rollout is running, **managed publishing will not stop you from taking it to 100%**. The hold applies to publishing the release, not to advancing it.

### 5.3 It does not shorten review

> "All app changes need to be processed before they can be published. Processing can take a few hours or up to seven days (or longer in exceptional cases)."

Managed publishing buys **timing control**, not **speed**.

### 5.4 Coordinating an Android + iOS release

This is the main reason to turn it on. The two stores have wildly different review latencies — Apple reviews ~90% of submissions in under 24 hours; Play's closed/production review is documented at up to seven days. If you submit both on the same day and let each auto-release, Android lands days after iOS.

The pattern:

| Step | Android | iOS |
|---|---|---|
| 1 | Enable Managed publishing **before** submitting | — |
| 2 | **Submit first** — it has the longer, less predictable review | — |
| 3 | — | Submit with the **Manually release this version** option → lands in *Pending Developer Release* on approval |
| 4 | Wait until it appears in **Changes ready to publish** | Wait for *Pending Developer Release* |
| 5 | Both approved and held. Choose the moment. | |
| 6 | **Publish changes**, then start the staged rollout at your first percentage | **Release This Version** (optionally with phased release) |

Two things not to over-promise:

- **Neither store gives you a simultaneous flip.** Apple notes it may take up to 24 hours for a released version to appear on the App Store; Play propagates on its own schedule. "Coordinated" means same day, not same minute.
- **Apple will email you** if a version sits in *Pending Developer Release* for more than 30 days. Do not park a held release indefinitely on either side.

**If the feature genuinely must appear at the same instant on all three platforms, that is a feature-flag problem, not a release-timing problem.** Ship the code dark on all channels, then flip a PostHog flag. That is skill safety rule 4, and it is the only mechanism that actually works across three independent review queues.

### 5.5 Managed publishing is not in the API

Google's managed publishing help page makes no mention of the Play Developer API. The closest API-side thing is `Edits.commit`'s `changesNotSentForReview` query parameter, which is a **different mechanism** — it withholds changes from review entirely rather than holding *approved* changes from publication.

**Treat "managed publishing via API" as undocumented and drive the publish step from the Console UI.** That makes step 6 above a human action. Say so when handing off.

---

## 6. Staged rollout

### 6.1 The first production release cannot be staged

**Verified, verbatim:**

> "Staged rollouts can only be used for app updates, not when publishing an app for the first time."

And the corollary, also verbatim, from the halt documentation:

> "you cannot halt your first release on a track since there would be no previous version to revert to."

**So the first 10Q production release goes to 100% of your targeted countries, with no percentage safety valve and no halt.** Plan accordingly:

- Do the risk-taking on internal and closed tracks, where you actually can iterate.
- Consider launching to a **restricted country list** on production and expanding afterward — country targeting is available on production releases and is the only throttle available on a first release.
- Make sure the **minimum-supported-version gate** ([05-migration-plan.md](../05-migration-plan.md) Phase 2) is live and functioning *before* the first production release. On a first release it is the only lever you have.
- Have a forward-fix build ready to go rather than a rollback plan, because there is no rollback.

### 6.2 How percentages work on updates

- You choose a percentage when rolling out; **Play picks recipients randomly**.
- **Increases are manual only.** Play never auto-advances a rollout. (This is the opposite of Apple's phased release, which advances on a fixed 7-day schedule unless you intervene.)
- Console path: **Manage rollout → Update rollout →** set new percentage **→ confirm**.
- Google publishes **no minimum and no fixed set of allowed percentages**. Via the API the field is `userFraction`, a decimal 0–1 (`0.05` = 5%).
- **Country-specific targeting is production-only.**

Recommended ladder for 10Q — the go/no-go block and the signals live in [ROLLOUTS.md](ROLLOUTS.md):

| Step | `userFraction` | Minimum hold | What you are actually watching |
|---|---|---|---|
| 1 | 0.05 | one full daily play window (the 11:30 UTC drop plus its peak) | Sentry crash-free rate vs previous `dist`; new issue classes; Android vitals ANR rate |
| 2 | 0.20 | one play window | Same, plus PostHog completion rate and auth failure rate filtered to `client_platform = android` |
| 3 | 0.50 | one play window | Same |
| 4 | 1.00 | — | — |

**Hold for a play window, not for a clock interval.** 10Q's traffic is a daily spike; a 5% slice sampled off-peak sees too few sessions to mean anything. Never promote automatically because signals look fine — ask (skill Step 5).

### 6.3 Halting — what it does and does not do

Verbatim:

> "Users who already received the app version in your staged rollout version will remain on that version."

**Halting stops further distribution. It does not downgrade anyone, and it is not a remote uninstall.** Google's own warning:

> "if the release you want to halt has been available for a significant length of time, or is being used by a large percentage of your users, halting it might not be the most effective solution as most users may have already updated."

**The real fix for a bad build is shipping a higher `versionCode`, not halting.** Halting buys you time to build that; it does not repair anything for users who already have the bad version. For those users your levers are, in order: a PostHog feature flag kill switch, the server-side minimum-supported-version gate, and a forward-fix release. See [ROLLBACKS.md](ROLLBACKS.md).

**Resuming reuses the same cohort:** "When you halt and then resume the rollout of your release, you'll be affecting the same set of users." Play does not re-randomize. Useful — the users who saw the bad build are the ones who get the fix first — but do not expect a fresh sample.

### 6.4 Halting a fully rolled-out release

Newer capability, and worth knowing before you need it. You can halt a release that is already at **100% on any track except internal**:

- Halting prevents "new and existing users from installing, or updating to the affected version."
- "The previous version of your app will automatically take its place and become available to new and eligible users."
- The fallback must be a previously live version **without policy violations**.
- Users already on the halted version **keep it**. Still not a forced downgrade.

Via the API this is release `status: halted`. Documented restrictions: you cannot halt a *serving fallback release*, nor halt a fully rolled-out release when the fallback has blocking policy issues.

### 6.5 Overlapping rollouts

You may start a new staged rollout before finishing the previous one:

> "When you do a staged rollout of a new release before completing the rollout of the previous release, the new release will use the same group of users as the previous release (depending on the percentage of the rollout)."

This is how a forward-fix reaches the affected cohort first. Note it sits in tension with the outstanding-release blocker ([4.5](#45-the-outstanding-release-blocker)); in practice the blocker applies to unpublished/draft changes, while an in-progress staged rollout can be superseded.

---

## 7. Data safety declaration

### 7.1 The rules that decide the answers

- **Mandatory even at zero collection.** "Even developers with apps that do not collect any user data must complete this form and provide a link to their privacy policy." A privacy policy URL is required unconditionally — and 10Q does not have one yet ([03-blocking-fixes.md B4](../03-blocking-fixes.md)).
- **Third-party SDK behavior is your responsibility.** Verbatim: "This includes user data transmitted off device from your app by libraries and/or SDKs used in your app, **irrespective of whether data is transmitted to you or a third-party server**." PostHog and Sentry are in the bundle; what they send is what you declare.
- **You are accountable for accuracy.** "You alone are responsible for making complete and accurate declarations." Misrepresentation is an enforcement matter — update blocking or removal — and **it is checked against observed SDK network behavior, not just your word.** Data safety accuracy is one of the most common causes of post-launch suspension.

### 7.2 What 10Q actually ships, and what that implies

Do not fill this in from the SDK vendor's marketing page. Fill it in from the code. Current state, with citations:

| Source in the repo | What leaves the device | Declare as |
|---|---|---|
| `apps/web/src/components/AuthButton.tsx:54-56` — `identifyUser(session.user.id, { email: session.user.email })` | **Email address**, for signed-in (non-anonymous) users, to PostHog | **Personal info → Email address.** Collected. Purposes: Analytics, Account management. Mark **Optional** (anonymous-first: most sessions never reach this) |
| Same call — the Supabase auth user id as PostHog `distinct_id`; Sentry user context | A stable account identifier | **Personal info → User IDs.** Collected |
| `apps/web/src/lib/analytics.ts` — 16 typed events, all through one `capture()` helper at `:14-21` | Screen views, quiz start/answer/finalize, results, leaderboard, profile, settings, handle update, sign-in, auth upgrade, share, app errors | **App activity → App interactions.** Collected. Purpose: Analytics |
| `apps/web/src/lib/posthog.ts:17-20` — **`autocapture` is ON** (never overridden) | DOM click/change/submit events as `$autocapture`, **including element text** | Broadens *App interactions* substantially, and is the single setting that most affects this declaration. **Decide it explicitly before submitting** ([OBSERVABILITY.md](../OBSERVABILITY.md)) |
| PostHog device/session properties persisted in `localStorage` | A persistent pseudonymous device/browser identifier | **Device or other IDs.** Collected |
| `apps/web/instrumentation-client.ts` — Sentry with `enableLogs: true` | Exceptions, stack traces, breadcrumbs | **App info and performance → Crash logs.** Collected |
| `apps/web/src/lib/logger.ts:37-60` — forwards structured logs to `Sentry.logger` in production | Arbitrary structured log attributes from UI code paths | **App info and performance → Diagnostics.** Collected. **Audit what the attributes contain** before declaring — a log line that includes a handle or an email changes the answer |
| PostHog and Sentry GeoIP enrichment on ingest | IP-derived coarse location, server-side | **Location → Approximate location, *if* GeoIP enrichment is enabled on the project.** Verify in the PostHog and Sentry project settings. **Do not guess this one** |
| Session recording | Not disabled in code, so whether it records is decided by **PostHog remote config** | If it is on, it is a far broader declaration. **Turn it off explicitly for the native build, or declare it** |

**Collected vs Shared — the trap.** "Collected" covers data transmitted off device, including by third-party SDKs; that is everything above. "Shared" covers transfer to a third party, and one of Google's listed exemptions is transfers to **service providers processing on your behalf**. PostHog and Sentry are plausibly processors — but that is a contractual question about your actual DPAs, not a code question. **Declare everything as collected; evaluate the service-provider exemption for "shared" against the real agreements, with a human.**

### 7.3 Deletion and encryption declarations

- Declare whether the app provides a **data-deletion request mechanism**, or alternatively that you "automatically initiate deletion or anonymization of collected data within 90 days of collection."
- Google requires **both** an in-app deletion path *and* a **web URL** where users can request account and data deletion **without reinstalling the app**. The page must be functional, relevant in scope, have deletion "prominently featured and easily discoverable," and reference the app or developer name.
- **That URL is submitted inside the Data safety form** (Play Console → **App content → Data safety →** the Data deletion questions), which is why a stale or 404 URL surfaces as a *Data safety* rejection: "Invalid account / data deletion link on your Data safety form."
- Partial deletion is allowed — retaining data "for legitimate reasons such as security, fraud prevention or regulatory compliance" — but you must "clearly inform users about your data retention practices, for example, within your privacy policy."
- Declare **encryption in transit** following best industry standards. 10Q is HTTPS to Supabase Edge Functions throughout.

**Blocked today.** Account deletion does not exist anywhere in the product — no Edge Function, no UI ([03-blocking-fixes.md B1](../03-blocking-fixes.md)). This is a hard blocker for both stores, and on Google it blocks the Data safety form specifically. Enforcement has been live since after 2024-05-31.

### 7.4 Data safety can be automated — and should be

Contrary to the common assumption, this is **not** Console-only. `POST applications.dataSafety` "writes the Safety Labels declaration of an app." The request body carries a `safetyLabels` field containing the contents of a CSV matching Google's Data safety CSV spec (download the template from Play Console). Success returns an empty body. Scope: `androidpublisher`.

**Recommendation:** keep that CSV in the repo — `docs/cross-platform/release/data-safety/play-data-safety.csv` (does not exist yet) — and push it from `scripts/release`. The declaration must change whenever `autocapture`, session recording, or any new SDK changes, and a CSV under review in a PR is the only mechanism that makes that a reviewable event instead of a forgotten one.

---

## 8. Target API level

Two different requirements. Do not conflate them.

| Requirement | Effective | Bar | Consequence of missing it |
|---|---|---|---|
| **New apps and app updates** | **2026-08-31** | Target **Android 16 (API 36)** or higher | **You cannot submit anything** — including an update to an existing app |
| **Existing apps staying discoverable** | 2026-08-31 | Target **Android 15 (API 35)** or higher | App stays available only to **new** users on devices running the same or lower Android version. **Existing installs are never removed** — this is a discovery/availability restriction, not a takedown |

Extensions to **2026-11-01** can be requested; extension forms appear in Play Console later in 2026. Form-factor exceptions for new submissions: Wear OS and Android Automotive → API 35; Android TV and Android XR → API 34. Permanently private apps distributed only within an organization are exempt entirely.

**For 10Q:** the first release lands after 2026-08-31, so target API 36 from the start. Set it in Capacitor's Gradle variables file:

```gradle
// <CAP_ROOT>/android/variables.gradle
ext {
  minSdkVersion = 23        // Capacitor default; raise deliberately, not by accident
  compileSdkVersion = 36
  targetSdkVersion = 36
}
```

Preflight asserts `targetSdkVersion >= 36` ([2.1](#21-preflight)). Bump `compileSdkVersion` in lockstep — targeting an API you did not compile against does not work.

**Related environment requirement:** Capacitor 8 requires **Node.js 22+**. `.github/workflows/ci.yml:21` and `:69` already pin `node-version: 22`, so CI is compatible as-is.

**Also worth a check, not a redesign:** the April 15, 2026 policy announcement requires the Android Contact Picker for broad contacts access, recommends the location button as the minimum scope for precise location, removed geofencing as an approved foreground-service use case, and requires the official Play Console workflow for account transfers. 10Q requests none of contacts, location or foreground services today — confirm that is still true at submission time rather than assuming.

---

## 9. Automation boundary

### 9.1 Play Developer API v3 — what it covers

Auth: a Google Cloud service account (`<PLAY_SERVICE_ACCOUNT>`) with the `https://www.googleapis.com/auth/androidpublisher` scope.

Covers: Edits (insert/validate/commit), AAB and APK upload, tracks and releases, deobfuscation/symbol files, localized store listings, images, country availability, testers per track, internal app sharing artifacts, app recovery actions, device tier configs, reviews (get/list/reply), in-app products, subscriptions, purchases/orders/refunds, user/permission management — and `applications.dataSafety` ([7.4](#74-data-safety-can-be-automated--and-should-be)).

Track release `status` accepts exactly four values:

| `status` | Meaning |
|---|---|
| `draft` | Created via API, deployed later from the Console. **This is your `submit` without `release`** |
| `inProgress` | Staged rollout; paired with `userFraction` |
| `halted` | Users cannot upgrade to this version |
| `completed` | 100% |

### 9.2 `fastlane supply`

Uploads APKs and AABs; sets `track`; promotes an existing build with `track_promote_to`; sets `rollout` (0–1 decimal), `release_status` (`completed`/`draft`/`inProgress`/`halted`), and in-app update priority (0–5); manages metadata — title, descriptions, changelogs organised by version code, icons, feature graphics, and phone/tablet/TV/wear screenshots, all multi-locale. Auth is the same service account JSON.

Two documented behaviors that produce silent damage:

- **Images and screenshots REPLACE rather than append.** A partial screenshot set wipes the rest of the listing's images.
- **Screenshot ordering follows alphanumeric filename sort.** Zero-pad (`01-`, `02-`, … `10-`) or your listing reorders itself.

### 9.3 What needs a human

| Action | Why |
|---|---|
| Creating the app record | Not in the API |
| **The very first upload** | "you will have to upload at least one APK through the Play Console before you can use this API." `supply` documents the same limitation |
| Legal consents required for publishing | "you cannot fill out the legal consents required for publishing" |
| Unpublishing the app | "you cannot change an app from published to unpublished via the API" |
| IARC content rating questionnaire | Console-only |
| Target audience / app content declarations | Console-only |
| **Production access application** (the 12-tester questionnaire) | Prose answers, human-reviewed |
| **Pressing "Publish changes" under Managed publishing** | No documented API ([5.5](#55-managed-publishing-is-not-in-the-api)) |
| Account and organization verification, D-U-N-S | Console-only |

**So the automation ceiling is: everything except the first upload, the legal/declaration surface, and the publish button.** That is enough to automate `prepare` and `submit` fully, and to automate `release` for staged-rollout percentage changes — but not to automate the moment a release first goes public under managed publishing.

### 9.4 Gotchas that will bite CI specifically

1. **Edits concurrency.** "If you create a new edit, any existing edit you may have open is invalidated." Only one edit per user at a time, and **changes made in the Play Console UI while an API edit is open will discard that API edit.** This is a real source of flaky CI failures when a human is poking the Console during a deploy. Announce deploys, or serialize them.
2. **`changesNotSentForReview`.** `Edits.commit` accepts this optional boolean: "the changes in this edit won't be reviewed until they are explicitly sent for review from within the Google Play Console UI." It is commonly **required to be `true`** for apps that have never had a reviewed release, and **rejected as an error** in other states. **Test both paths in the pipeline** — the first-ever release and every subsequent one take different branches.
3. **Track identifiers do not match the Console labels.** The API's historical identifiers are `internal`, `alpha` (the default *closed* testing track), `beta` (the default *open* testing track), and `production`. Custom closed tracks use their own IDs. **Verify empirically with `tracks.list` against your app before hardcoding anything.**
4. **Form-factor tracks use a prefix**, e.g. `wear:production`, `automotive:beta`. Not relevant to 10Q today; relevant the moment anyone adds a Wear target.

---

## 10. `prepare` / `submit` / `release` on Android

Same three verbs as iOS and web. `.claude/skills/release/SKILL.md` safety rule 1: **never collapse them.**

| Verb | Android meaning | Mechanism | Public impact |
|---|---|---|---|
| **prepare** | Version bump → static export → `cap sync android` → `bundleRelease` → signed AAB → source maps uploaded to Sentry under `release`+`dist` → artifact archived | `scripts/release/prepare android` | **None** |
| **submit** | Upload the AAB to a track and send for review. Production releases created with `status: draft`, and Managed publishing ON | `scripts/release/submit android --track internal\|closed\|production` | **None for the public.** *But* an internal-track upload reaches up to 100 testers within minutes — real, if small |
| **release** | Publish held changes; start the staged rollout at the first percentage; advance the percentage | Console **Publish changes** (human), then `scripts/release/release android --rollout 0.05` | **Yes** |

None of those scripts exist yet — `scripts/release/` is an empty directory. Until they do, run the steps in [2](#2-the-build-chain) by hand and say so, per the skill's *Current Limitations* section.

**Android's separation is weaker than Apple's and you have to construct it deliberately.** On Apple, *Pending Developer Release* is a first-class state. On Play, "submit to production" and "release to production" collapse into one action unless you actively use **both** levers:

1. `status: draft` on the track release via the API, **and**
2. **Managed publishing** enabled ([5](#5-managed-publishing))

Use both. Using neither means `submit` *is* `release`, which violates safety rule 1 by accident rather than by choice.

**Any operation with public impact requires explicit user confirmation naming the platform, the version and the percentage** — even when the original request was broad. "Release 10Q" authorizes preparing all three channels; it does not authorize publishing any of them.

---

## 11. Standing constraints

### 11.1 Backend before clients

Supabase migrations and Edge Function deploys precede the client releases that depend on them, and must stay compatible with every client version still in the field. Supabase is **not in CI** — 22 Edge Functions and all migrations are deployed by hand (`supabase db push`, `supabase functions deploy`). That is tolerable while clients auto-update. It is a hazard the moment a Play binary can lag a contract change by weeks. See [05-migration-plan.md](../05-migration-plan.md) Phase 2.

### 11.2 Version skew is permanent on Android

Play offers an update only when the candidate `versionCode` is higher than the installed one — and it never forces one. A user who ignores updates stays on the version they have, indefinitely. Halting does not move them. Rolling back does not exist.

**Rules that follow, and they are not negotiable:**

1. **Additive API changes only.** Never remove or repurpose a field in an Edge Function response. The real contract is `apps/web/src/lib/api/edge-functions.ts` — **not** `packages/contracts/openapi.yaml`, which is abandoned and wrong.
2. **No API change may assume web, iOS and Android update atomically.** They are three independently controllable channels and they do not go public together.
3. **A coordinated cross-platform feature launch is a feature-flag problem**, not a release-timing problem.
4. **The server-side minimum-supported-version gate is the only lever that works on a binary you cannot recall.** It must exist before the first production release ([05-migration-plan.md](../05-migration-plan.md) Phase 2).

**One Android-only advantage worth knowing:** Play supports **in-app updates** (flexible and immediate) plus an in-app update **priority** (0–5), settable through `supply`. Immediate updates can block a user in a stale build until they update — a lever iOS simply does not have. It needs a Capacitor plugin and is not required for V1, but it is the correct answer to "how do we get everyone off a bad `versionCode`" and belongs in [ROLLBACKS.md](ROLLBACKS.md)'s Android section.

### 11.3 OTA is deferred, and why it is not free on Android

Capacitor OTA / Appflow live updates are **explicitly out of scope for V1**. If asked to ship a JS-only change without a store release, say it is not supported and explain the constraint rather than improvising one.

The commonly cited blocker is Apple guideline 2.5.2, and the current synthesis is narrower than the folklore: OTA-delivered interpreted code is permissible provided it does not change the app's primary purpose or add functionality inconsistent with what was submitted, does not bypass signing/sandbox/OS security, and does not create a storefront for other applications. **The practical rule is: OTA may fix and refine what was reviewed, never add what was not.** Note also guideline 4.2.3(ii) — if the shipped bundle downloads resources to function on first launch, you must disclose the download size and prompt the user.

**Google's version of the risk is different and less discussed.** Play's policy split relevant here:

- **Spam → Webviews and Affiliate Spam**: "We don't allow apps whose primary purpose is to drive affiliate traffic to a website or provide a webview of a website **without permission from the website owner or administrator**." 10Q owns `play10q.com`, so the ownership test is clear.
- **Functionality, Content, and User Experience → Minimum Functionality**: this is the clause that actually catches thin wrappers. Apps must provide "a stable, responsive, and engaging user experience," and named violations include apps that "load, but are not responsive."

(The legacy umbrella name "Spam and Minimum Functionality" still appears in enforcement emails, so search **both** pages when diagnosing a rejection.)

An OTA channel makes the Minimum Functionality exposure worse, not better: a bad OTA payload turns into a fleet-wide blank or broken WebView with no store review in the path and no `versionCode` to halt. That is a self-inflicted Minimum Functionality violation delivered at OTA speed.

If OTA is ever revisited, the costs to price in are: Appflow subscription or self-hosted update infrastructure, a rollback mechanism for the OTA channel itself, integrity/signing of the payload, the Apple 2.5.2 and 4.2.3(ii) constraints above, and the Play Minimum Functionality exposure. **None of that is cheaper than a store release for a product that ships weekly.**

---

## 12. Checklists

### 12.1 One-time, before the first Android build exists

- [ ] Play Console developer account created; `<PLAY_ACCOUNT_TYPE>` decided and recorded **(human)**
- [ ] App record created; `<APPLICATION_ID>` fixed and **identical to the iOS bundle id** **(human)**
- [ ] Play App Signing enrolled **(human)**
- [ ] Upload keystore generated; stored at `<KEYSTORE_CUSTODY>`; passwords in the vault **(human)**
- [ ] `.gitignore` rules for `*.jks`, `*.keystore`, `keystore.properties`, `version.properties` committed — the repo has **none** today
- [ ] CI secrets set: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON` **(human)**
- [ ] Google Cloud service account created with the `androidpublisher` scope; invited to Play Console with the right permissions **(human)**
- [ ] `apps/web/public/.well-known/assetlinks.json` committed, deployed, and resolving over HTTPS with `Content-Type: application/json` — using the **app signing key** SHA-256
- [ ] Privacy policy, support URL and the web deletion-request page live on `play10q.com` **(blocked: [03-blocking-fixes.md B1, B4](../03-blocking-fixes.md))**
- [ ] Data safety form completed from actual SDK behavior; `autocapture` and session recording decided explicitly
- [ ] IARC content rating answered **after** the UGC work lands
- [ ] Demo account + reviewer notes prepared, including the **11:30 UTC quiz drop**
- [ ] `targetSdkVersion = 36`, `compileSdkVersion = 36` in `variables.gradle`
- [ ] **The first AAB uploaded manually through the Play Console** — the API and `supply` cannot do this one

### 12.2 Every release

- [ ] `scripts/release/preflight android` green
- [ ] `versionCode` strictly greater than every `versionCode` ever uploaded, on any track
- [ ] Web export rebuilt with `NEXT_PUBLIC_CLIENT_PLATFORM=android` and the other four identifiers
- [ ] `npx cap sync android` ran **after** the web build (otherwise the AAB has no app in it)
- [ ] Export contains no `/_next/image` references
- [ ] `./gradlew clean :app:bundleRelease` produced a signed AAB; `keytool -printcert -jarfile` shows the upload key
- [ ] `bundletool dump manifest` confirms the expected `versionCode`
- [ ] Sentry source maps uploaded under `release: 10q@<version>` + `dist: <versionCode>`
- [ ] AAB, source maps and `version.properties` archived to durable storage
- [ ] Managed publishing ON before submitting
- [ ] Uploaded to the internal track; smoke suite green on a real device
- [ ] Sentry received a **symbolicated** error tagged `client_platform: android`
- [ ] PostHog received events with `client_platform: android` and the right `app_version` / `app_build`
- [ ] Android vitals checked (ANRs are invisible to Sentry today)
- [ ] Data safety declaration still accurate for this build's SDK configuration
- [ ] Promotion to production explicitly confirmed by a human, naming version and rollout percentage

---

## Related

- [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) — the release state machine and change-impact matrix
- [VERSIONING.md](VERSIONING.md) — where `app_version` and `app_build` come from
- [IOS.md](IOS.md) · [WEB.md](WEB.md) — the sibling channels
- [ROLLOUTS.md](ROLLOUTS.md) — promotion gates and the go/no-go block
- [ROLLBACKS.md](ROLLBACKS.md) — incident response; note mobile rollback does not exist
- [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) — the one-time account, listing and asset runbook
- [../OBSERVABILITY.md](../OBSERVABILITY.md) — the five identifiers, and what PostHog and Sentry actually collect
- [../STORE_READINESS.md](../STORE_READINESS.md) — the requirements register and pre-submission checklist
- [../03-blocking-fixes.md](../03-blocking-fixes.md) — account deletion, UGC moderation, privacy policy: all blockers here
- [../01-architecture-decision.md](../01-architecture-decision.md) — why Capacitor, and the Play Minimum Functionality posture
