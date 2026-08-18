# iOS Release Procedure

**Channel:** iOS · App Store Connect · TestFlight
**Artifact:** a signed `.ipa` containing a Next.js static export served from the device filesystem by WKWebView, per [ADR-001](../01-architecture-decision.md).
**Counterparts:** [ANDROID.md](ANDROID.md) · [WEB.md](WEB.md) · [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md)

> **iOS is an independently controllable release channel.** It does not go public when web deploys. A binary approved today may still be running in six months against a backend that has moved on. Every rule in this document about pinning identifiers, tolerating version skew, and archiving artifacts exists because of that one fact.

---

## Read this first

| If you are | Read |
|---|---|
| Setting up the Apple account for the first time | [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) — one-time account, signing and listing setup |
| Deciding what version number to ship | [VERSIONING.md](VERSIONING.md) — the source of truth for `app_version` / `app_build` |
| Deciding *whether* to promote a build | [ROLLOUTS.md](ROLLOUTS.md) — promotion gates, kill switches |
| Checking compliance status | [STORE_READINESS.md](../STORE_READINESS.md) and [03-blocking-fixes.md §B](../03-blocking-fixes.md) |

**This document is not executable yet.** It describes the procedure once Phases 3–5 of [05-migration-plan.md](../05-migration-plan.md) have landed. As of the current `main`:

- There is no Capacitor project — no `capacitor.config.*`, no `ios/`, no `@capacitor/*` dependency (`apps/web/package.json`).
- There is no version source of truth — zero git tags, all three `package.json` files pinned at `0.1.0`, nothing stamps a build id.
- There is no non-production environment to point a TestFlight build at ([02-current-state.md §6](../02-current-state.md)).
- `next.config.ts:36-43` passes no `release` and no `dist` to `withSentryConfig`, so Sentry symbolication for a shipped binary would not work today.

Do not attempt an upload until those exist. Everything below assumes they do.

---

## The three gates — prepare, submit, release

**Read this before touching App Store Connect.** These are three distinct operations. Two of them are commonly confused, and neither of the first two makes anything public.

| Gate | What it is | Console action | State after | Public? | Reversible? |
|---|---|---|---|---|---|
| **1. Prepare** | Create the App Store version record, attach a build, fill in metadata | Version page, "+ Version or Platform" → edit fields → **Save** | `Prepare for Submission` | **No** | Yes — edit freely, swap the build as often as you like |
| **2. Submit** | Hand the version to Apple's reviewers | **Add for Review** → **Submit for Review** | `Ready for Review` → `Waiting for Review` → `In Review` | **No** | Yes — cancel the review submission |
| **3. Release** | Make it visible on the App Store | Governed by the release option chosen at submission | `Pending Developer Release` → `Ready for Distribution` | **Yes** | **No** — there is no rollback on iOS |

Corollaries an agent must not get wrong:

- **Saving a version is not submitting it.** A version can sit in `Prepare for Submission` indefinitely.
- **Submitting is not releasing.** With `Manually release this version`, an approved build sits in `Pending Developer Release` until a human (or an `appStoreVersionReleaseRequests` API call) releases it. Apple emails a reminder if it sits there over 30 days.
- **There is no "promote from TestFlight."** TestFlight and App Review are two independent consumers of the *same uploaded build*. You do not move a build between them; you attach the build to a version and submit that version.
- **Phased release is a modifier on gate 3**, not a fourth gate. See [§8](#8-phased-release).
- After release it can take **up to 24 hours** for the version to appear on the App Store.

---

## 1. Prerequisites

### 1.1 Who does what

| Item | Human or agent | Notes |
|---|---|---|
| Apple Developer Program membership ($99/yr) | **Human only** | Requires Apple ID, 2FA on a trusted device, and identity verification. Enrollment can take days. Start it before anything else in this document — it blocks everything and depends on nothing |
| Accept the Apple Developer Program License Agreement | **Human only** | Console action, no API. A lapsed agreement silently blocks uploads |
| Banking, tax and paid-app agreements | **Human only** | Not required for a free app, but the free-app agreement must be current |
| EU DSA trader status verification | **Human only** | Since 2025-02-17, apps without verified trader status are removed from the EU App Store until verified. App Store Connect → Business → Trader Status |
| Register the bundle identifier | Agent may drive via the App Store Connect API (`bundleIds`), or human via portal | **Value is [DECISION REQUIRED](#decision-register) — do not invent one** |
| Create the App Store Connect app record | **Human** (recommended) | Console: My Apps → **+** → New App. App creation via API is not reliably documented; treat the console as authoritative for this one step |
| Signing certificates + provisioning profiles | Agent-capable with a human-supplied key | See [§1.3](#13-signing) |
| Associated Domains entitlement | Agent edits the project; **human** enables the capability on the App ID | See [§1.4](#14-associated-domains-and-universal-links) |
| Age rating questionnaire | **Human** | Since 2026-01-31, an unanswered updated questionnaire **blocks version updates**. Answers depend on UGC — do not fill it in before [Phase 8](../05-migration-plan.md) |
| App Privacy (nutrition labels) | **Human** enters; agent prepares the answers | See [§7.2](#72-app-privacy--privacy-nutrition-labels) |
| Expedited review request | **Human only** | Web form, not in App Store Connect and not in the API |
| App Review Board appeal | **Human only** | Web form |

**Hand-off protocol for an agent:** when a step is human-only, stop and emit a single message containing (a) the exact console URL or navigation path, (b) the exact values to enter, (c) what to paste back. Do not proceed on an assumption about what the human did — verify by reading the resulting state back through the API or by asking for a screenshot.

### 1.2 Toolchain — hard blockers

| Requirement | Value | Consequence of missing it |
|---|---|---|
| Xcode | **26.0 or later**, building against an iOS 26 SDK | Since **2026-04-28** Apple rejects non-conforming uploads **at upload time, before review**. This is not a review finding; the binary never lands |
| Node | **22+** | Capacitor 8 requires it. `ci.yml:21` already pins Node 22 |
| Capacitor | 8.x (current: 8.5.0) | iOS deployment target 15.0; new iOS projects default to **Swift Package Manager**, not CocoaPods |
| macOS runner | Required | `xcodebuild` does not exist on `ubuntu-latest`. The existing `ci.yml` has no macOS job |

Verify before every release build:

```bash
xcodebuild -version              # expect Xcode 26.x
xcrun --sdk iphoneos --show-sdk-version   # expect 26.x
node -v                          # expect v22.x or later
```

### 1.3 Signing

Two things must exist, both tied to the Apple Developer team:

1. An **Apple Distribution** certificate (private key + `.cer`), and
2. An **App Store** provisioning profile for the bundle id, including the Associated Domains capability.

**Recommended path for this project:** Xcode automatic signing driven by an App Store Connect API key. It avoids managing a certificate repository and works headlessly.

Human steps (once):

1. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API** → generate a key with the **App Manager** role.
2. Download the `.p8` **once** — Apple will not let you download it again.
3. Record the **Key ID** and **Issuer ID**.
4. Place the key where the toolchain expects it:
   ```bash
   mkdir -p ~/.appstoreconnect/private_keys
   mv ~/Downloads/AuthKey_<KEY_ID>.p8 ~/.appstoreconnect/private_keys/
   ```

In CI, store the `.p8` contents, Key ID and Issuer ID as secrets and reconstruct the file at job start. The key is a credential with write access to the App Store listing — treat it accordingly.

`fastlane match` (a git repo of encrypted certificates) is the alternative and is worth it once more than one machine builds releases. It is not worth it for a single developer on a single Mac.

### 1.4 Associated Domains and Universal Links

Universal Links are what make `https://play10q.com/invite/<code>` open the installed app instead of Safari. That link **is the growth loop** ([04-shared-code-architecture.md](../04-shared-code-architecture.md)), so this is load-bearing, not decoration.

Three pieces must all be correct. Any one wrong and the link silently opens Safari with no error anywhere.

**(a) The entitlement — in the Xcode project.**

`ios/App/App/App.entitlements`:

```xml
<key>com.apple.developer.associated-domains</key>
<array>
  <string>applinks:play10q.com</string>
  <string>applinks:www.play10q.com</string>
</array>
```

Commit this file. It is not reproducible from `capacitor.config.ts` — which is exactly why Capacitor's official guidance is to check `ios/` into source control.

**(b) The capability on the App ID — human step.**

Apple Developer portal → Certificates, Identifiers & Profiles → **Identifiers** → the app's identifier → enable **Associated Domains** → Save. Then **regenerate the provisioning profile**; an existing profile does not pick up a newly enabled capability.

**(c) The AASA file — served from `play10q.com`.**

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<TEAM_ID>.<BUNDLE_ID>"],
        "components": [
          { "/": "/invite/*", "comment": "league invite" },
          { "/": "/invite",   "?": { "code": "?*" }, "comment": "query-param invite route" },
          { "/": "/u",        "?": { "handle": "?*" } },
          { "/": "/leagues/detail", "?": { "id": "?*" } }
        ]
      }
    ]
  }
}
```

Both `<TEAM_ID>` and `<BUNDLE_ID>` are [DECISION REQUIRED](#decision-register).

Note the route shapes: [04-shared-code-architecture.md](../04-shared-code-architecture.md) converts the three unbounded dynamic routes to query params, and keeps a permanent redirect for the legacy `/invite/<code>` form. **The AASA must cover both shapes**, or already-circulating invite links will open Safari.

Serve it from `apps/web/public/.well-known/apple-app-site-association`. Requirements Apple enforces: HTTPS, HTTP 200, `Content-Type: application/json`, **no redirects**, **no `.json` extension**.

Two repo-specific traps:

- **Dot-directories are a known casualty of static asset pipelines.** The web deploy is `opennextjs-cloudflare` writing to `.open-next/assets` (`apps/web/wrangler.jsonc`). Do not assume `public/.well-known/` survives. Verify after every web deploy:
  ```bash
  curl -sI https://play10q.com/.well-known/apple-app-site-association
  # expect: HTTP/2 200 and content-type: application/json
  ```
  If it 404s, serve it from the Worker instead (an `assets.run_worker_first` path pattern, or a route handler) rather than fighting the asset pipeline.

- **The middleware matcher does not exclude it.** `apps/web/src/middleware.ts:41` excludes `_next/static`, `_next/image`, `favicon.ico` and six image extensions — not `.well-known`. So Apple's CDN fetch of the AASA runs `supabase.auth.getUser()` (`middleware.ts:30`) and gets `Cache-Control: no-store` (`:34`). Harmless today, but it means **a middleware failure breaks Universal Links** in a way that produces no error signal on the client. Add `.well-known` to the matcher exclusion.

**Separately:** the OAuth return is *not* a Universal Link. It arrives on a custom URL scheme registered in `Info.plist` (`CFBundleURLTypes`) and handled by the `appUrlOpen` listener ([04-shared-code-architecture.md](../04-shared-code-architecture.md)). Both the custom scheme and the `https://play10q.com/auth/callback` form must be added to **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**. That is untracked config; record the exact values in [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md).

### 1.5 Project location

Sibling docs list `capacitor.config.ts`, `ios/` and `android/` without pinning a directory ([05-migration-plan.md](../05-migration-plan.md) Phase 5). The Capacitor CLI roots itself at `process.cwd()` and resolves `webDir` relative to the directory containing the config, with no `--config` flag — so the config file's directory *is* the app root, and all `npx cap` commands must run from there.

**This document assumes `apps/mobile/`:**

```
apps/mobile/
  package.json            @capacitor/core, cli, ios, android
  capacitor.config.ts     webDir: '../web/out'
  ios/                    committed
  android/                committed
  assets/                 icon + splash sources for @capacitor/assets
  ExportOptions.plist
```

If Phase 5 puts them at the repo root instead, substitute the repo root for `apps/mobile` everywhere below and `apps/web/out` for `../web/out`. Nothing else changes.

**Commit `ios/`.** Capacitor treats native projects as source assets, not build artifacts. But note what the shipped `ios/.gitignore` excludes: `App/build`, `App/Pods`, `App/output`, **`App/App/public`**, `DerivedData`, `xcuserdata`, `capacitor-cordova-ios-plugins`, `App/App/capacitor.config.json`, `App/App/config.xml`.

`App/App/public` is the web bundle. **It is deliberately not committed**, which means: *CI must run the web build and `cap sync` before archiving, or it will archive an app with no web app inside it.*

---

## 2. What a release stamps

[OBSERVABILITY.md](../OBSERVABILITY.md) defines five identifiers that every release writes into both PostHog and Sentry. On iOS they land here:

| Identifier | Build input | Also lands in | Notes |
|---|---|---|---|
| `app_version` | `NEXT_PUBLIC_APP_VERSION` | `MARKETING_VERSION` → `CFBundleShortVersionString` | User-visible. Must match the App Store version string exactly |
| `app_build` | `NEXT_PUBLIC_APP_BUILD` | `CURRENT_PROJECT_VERSION` → `CFBundleVersion` | **Monotonic, never reused.** A rejected upload still consumed its number |
| `client_platform` | `NEXT_PUBLIC_CLIENT_PLATFORM=ios` | Sentry tag, PostHog super property | Also selects the native platform implementations at `src/platform/index.ts` |
| `release_sha` | `NEXT_PUBLIC_RELEASE_SHA` | Sentry tag, PostHog super property | `git rev-parse --short HEAD` |
| `environment` | `NEXT_PUBLIC_ENVIRONMENT` | Sentry `environment`, PostHog super property | `production` \| `staging` — **[DECISION REQUIRED](#decision-register)** for review builds |

These are `NEXT_PUBLIC_*` values, inlined at build time. That is the correct behaviour for a store binary: the identifiers describe **the bundle the user is actually running**, which may be months old.

**Version/build discipline for iOS:**

- `CFBundleVersion` must strictly increase within a `CFBundleShortVersionString`. App Store Connect rejects a duplicate at upload.
- Because a rejected or abandoned upload burns its build number, **`app_build` is a counter, not a coordinate**. Never reuse one, never renumber.
- The pairing `(app_version, app_build)` is the primary key of a shipped binary and is what Sentry's `(release, dist)` must equal. See [§4](#4-sentry).

---

## 3. The build chain

Six steps, end to end. Run them in order; several will silently produce a wrong-but-plausible artifact if reordered.

```
version bump → next build (native config) → sentry inject+upload → archive artifacts
            → strip maps → cap sync ios → xcodebuild archive → export IPA → upload
```

### 3.0 Preconditions

```bash
cd /Users/rocky/Code/10q-app
git status --porcelain          # must be empty — a release is built from a clean tree
git rev-parse --short HEAD      # this becomes release_sha
npm ci
```

### 3.1 Version bump

Owned by [VERSIONING.md](VERSIONING.md). This document consumes the result:

```bash
export APP_VERSION=1.4.0          # CFBundleShortVersionString
export APP_BUILD=42               # CFBundleVersion — monotonic, never reused
export RELEASE_SHA=$(git rev-parse --short HEAD)
```

The release must be tagged and the tag must be immutable, because [§4](#4-sentry) needs to retrieve this exact bundle years later:

```bash
git tag -a "ios/v${APP_VERSION}+${APP_BUILD}" -m "iOS ${APP_VERSION} (${APP_BUILD})"
git push origin "ios/v${APP_VERSION}+${APP_BUILD}"
```

### 3.2 Build the static export

The native build differs from the web build in more than a flag. `output: 'export'`, `trailingSlash: true` and `images.unoptimized: true` change rendered output, and `middleware.ts`, `instrumentation.ts` and the Sentry server/edge configs are picked up **by file convention** — `next.config.ts` cannot exclude them. That is why this is a script, not a conditional:

```bash
NEXT_PUBLIC_CLIENT_PLATFORM=ios \
NEXT_PUBLIC_APP_VERSION="$APP_VERSION" \
NEXT_PUBLIC_APP_BUILD="$APP_BUILD" \
NEXT_PUBLIC_RELEASE_SHA="$RELEASE_SHA" \
NEXT_PUBLIC_ENVIRONMENT=production \
NEXT_PUBLIC_PUBLIC_URL=https://play10q.com \
NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
NEXT_PUBLIC_SENTRY_DSN="$SENTRY_DSN" \
NEXT_PUBLIC_POSTHOG_KEY="$POSTHOG_KEY" \
NEXT_PUBLIC_POSTHOG_HOST="$POSTHOG_HOST" \
BUILD_TARGET=native \
scripts/build-native.sh
```

Output: `apps/web/out/`.

Four things to check, all of which have bitten this repo or are documented as traps:

| Check | Command | Why |
|---|---|---|
| Every `NEXT_PUBLIC_*` was present | inspect the env block above | `ci.yml:36-44` omits the PostHog vars that `:74-88` supplies. A native build that inherits that drift ships with analytics compiled out and no `client_platform` |
| No `/_next/image` references | `! grep -rq "/_next/image" apps/web/out` | Next 16 does **not** error when `images.unoptimized` is missing under export. It silently emits URLs that 404 in the WebView |
| `index.html` exists at the webDir root | `test -f apps/web/out/index.html` | Capacitor refuses to sync otherwise |
| `cwd` was `apps/web` | inside the script | `next.config.ts:5` resolves the `@vercel/og` stub via `process.cwd()` |

### 3.3 Sentry source maps — before `cap sync`

Full rationale in [§4](#4-sentry). The mechanical requirement: **debug IDs must be injected into the bundles that actually ship**, so injection happens before the bundle is copied into the native project.

```bash
# 1. inject debug IDs into out/ (skip if the Sentry Next plugin already did it — see §4.2)
npx sentry-cli sourcemaps inject apps/web/out

# 2. upload, pinned to this exact binary
npx sentry-cli sourcemaps upload apps/web/out \
  --org "$SENTRY_ORG" --project "$SENTRY_PROJECT" \
  --release "10q@${APP_VERSION}" \
  --dist "${APP_BUILD}"
```

### 3.4 Archive the bundle and its maps

**Do this before stripping the maps.** See [§4.3](#43-where-archived-source-maps-live).

```bash
tar -czf "10q-ios-${APP_VERSION}+${APP_BUILD}-webbundle.tgz" \
  -C apps/web out \
  -C ../../apps/mobile capacitor.config.ts
```

### 3.5 Strip source maps, then sync

`.map` files inside the IPA bloat the binary and hand your source to anyone who unzips it. Delete them *after* upload and archival, *before* the sync that copies the bundle into the native project:

```bash
find apps/web/out -name '*.map' -delete
cd apps/mobile && npx cap sync ios
```

`cap sync` = `cap copy` (web bundle + Capacitor config into `ios/App/App/public`) + `cap update` (native dependency install and plugin refresh). Run it from the directory containing `capacitor.config.ts`.

Sanity check that the sync actually landed:

```bash
test -f apps/mobile/ios/App/App/public/index.html \
  && grep -c "sentry" apps/mobile/ios/App/App/public/index.html
```

### 3.6 Archive

Capacitor 8 creates new iOS projects with **Swift Package Manager** by default, so there is usually no `.xcworkspace`. Use whichever exists:

```bash
# SPM (Capacitor 8 default)
ARCHIVE=build/10q-${APP_VERSION}-${APP_BUILD}.xcarchive
xcodebuild \
  -project apps/mobile/ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  MARKETING_VERSION="$APP_VERSION" \
  CURRENT_PROJECT_VERSION="$APP_BUILD" \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8 \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  archive
```

For a CocoaPods project (`npx cap add ios --packagemanager CocoaPods`) substitute `-workspace apps/mobile/ios/App/App.xcworkspace`.

`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` on the command line only work if `Info.plist` uses the build-setting substitutions:

```bash
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" apps/mobile/ios/App/App/Info.plist
# expect: $(MARKETING_VERSION)
/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" apps/mobile/ios/App/App/Info.plist
# expect: $(CURRENT_PROJECT_VERSION)
```

If they are literals, change them to the substitutions once and commit — do not paper over it with a per-build `PlistBuddy -c "Set ..."`, because a stamping step that can be forgotten is a stamping step that will be.

**Also set once, in `Info.plist`:**

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

10Q uses only standard HTTPS/TLS ([STORE_READINESS.md](../STORE_READINESS.md)). Declaring it in the plist stops every upload from parking in `Waiting for Export Compliance` until a human answers the question in the console.

### 3.7 Export the IPA

`apps/mobile/ExportOptions.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>                        <string>app-store-connect</string>
  <key>teamID</key>                        <string>DECISION_REQUIRED_TEAM_ID</string>
  <key>uploadSymbols</key>                 <true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>destination</key>                   <string>export</string>
  <key>signingStyle</key>                  <string>automatic</string>
</dict>
</plist>
```

> **`manageAppVersionAndBuildNumber` must be `false`.** When `true` (the historical default), Xcode silently increments the build number during export. The IPA then ships a `CFBundleVersion` that no longer equals the `app_build` compiled into the JS bundle — so PostHog reports one build, App Store Connect shows another, and **the Sentry `dist` no longer matches the shipped binary**. Every stack trace from that release comes back unsymbolicated, and nothing in the pipeline tells you.

```bash
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist apps/mobile/ExportOptions.plist \
  -exportPath build/ipa \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8 \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"
```

Verify before uploading:

```bash
unzip -p build/ipa/App.ipa 'Payload/App.app/Info.plist' \
  | plutil -extract CFBundleVersion raw -    # must equal $APP_BUILD
unzip -l build/ipa/App.ipa | grep -c '\.map$'  # must be 0
unzip -l build/ipa/App.ipa | grep -c 'public/index.html'  # must be 1
```

### 3.8 Upload

```bash
xcrun altool --validate-app -f build/ipa/App.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

xcrun altool --upload-app -f build/ipa/App.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

Alternatives, all equivalent in outcome: `fastlane pilot upload`, the Transporter app, Xcode Organizer, or the App Store Connect REST API `build-uploads` resource (added in API 4.1 — `POST /v1/buildUploads` → create `BuildUploadFile` reservations → `PUT` the parts → commit). The REST path is the one to use if you want upload without a Mac-specific CLI in the loop; it is genuinely supported, contrary to the common belief that upload requires Xcode or altool.

> **Do not upload as "TestFlight Internal Only."** Xcode's Organizer and Xcode Cloud both offer this distribution option. A build flagged internal-only shows an "internal" indicator under its build number in App Store Connect and **can only ever go to internal tester groups** — it cannot be submitted for external testing or to App Review. The fix is to re-upload with a new build number, which burns a `dist`. Uploading via `altool` with the ExportOptions above does not set the flag.

Processing takes minutes to ~an hour. The build's status moves `Processing` → `Ready to Submit`.

---

## 4. Sentry

### 4.1 Why iOS is different from web

Web can afford to be casual about source maps: whatever is deployed is current, so the most recently uploaded map matches the running bundle. **Mobile cannot.** A crash report arriving today may come from a binary that was reviewed and shipped four months ago and has been sitting on a phone ever since. Users do not have to update, and many do not.

So symbolication must work for **every version ever shipped, indefinitely** — which means the mapping from a running bundle to its source maps has to be an exact, permanent, machine-checkable key. That key is `(release, dist)`:

```ts
release: `10q@${process.env.NEXT_PUBLIC_APP_VERSION}`,   // 10q@1.4.0
dist:    process.env.NEXT_PUBLIC_APP_BUILD,              // "42"
```

`release` alone is not enough. One `app_version` routinely produces several builds — a TestFlight build, a fix after beta feedback, a resubmission after rejection — each with different JS. They all say `1.4.0`. Only `dist` distinguishes them, and mixing them up produces line numbers that point at the wrong code, which is worse than no symbolication because it looks correct.

Current state to fix: `apps/web/instrumentation-client.ts:3-13` sets neither `release` nor `dist`, and `environment: process.env.NODE_ENV` — which yields `production` for everything. `next.config.ts:36-43` passes no release config to `withSentryConfig`. See [OBSERVABILITY.md](../OBSERVABILITY.md) for the full init block.

### 4.2 Debug IDs, not URL prefixes

Historically Sentry matched a stack frame to a source map by URL. **Do not rely on that here.** The JS in a Capacitor iOS app is loaded from `capacitor://localhost/_next/static/chunks/…` — a custom scheme that will never match a `~/_next/…` URL prefix reliably, and that differs from both the web origin and Android's `http://localhost`.

Debug IDs solve this: `sentry-cli sourcemaps inject` writes a unique id into each bundle and its map, and matching becomes path-independent. This is why [§3.3](#33-sentry-source-maps--before-cap-sync) runs **before** `cap sync` — the injected files must be the ones copied into `ios/App/App/public`.

Two ways to do it, pick one and only one:

**(a) Via the Sentry Next.js plugin** — injection and upload happen inside `next build`. Configure it explicitly for the native target in `next.config.ts`:

```ts
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  release: {
    name: `10q@${process.env.NEXT_PUBLIC_APP_VERSION}`,
    dist: process.env.NEXT_PUBLIC_APP_BUILD,
  },
  sourcemaps: { deleteSourcemapsAfterUpload: false },  // §3.4 needs them
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
});
```

**(b) Via `sentry-cli` explicitly**, as in [§3.3](#33-sentry-source-maps--before-cap-sync), with the plugin's upload disabled for the native target.

Prefer (b) if you want the release identity controlled by the release script rather than by plugin option names that move between major versions. Whichever you choose, **verify** — do not assume:

```bash
npx sentry-cli sourcemaps explain <EVENT_ID> --org "$SENTRY_ORG" --project "$SENTRY_PROJECT"
```

or in the UI: Settings → Projects → *project* → **Source Maps**, and confirm an artifact bundle exists for `10q@1.4.0` / dist `42`.

> **Existing defect to fix before adding a third build target.** `SENTRY_AUTH_TOKEN` is supplied to *both* the CI build job (`ci.yml:44`) and the deploy job (`ci.yml:84`), so each push to `main` uploads source maps twice — from two builds that are not byte-identical, because the CI build lacks the PostHog vars. For iOS this must never happen: **exactly one upload per `(release, dist)`**, from the build that produced the IPA.

### 4.3 Where archived source maps live

Sentry is the *consumer* of source maps, not the archive of record. Sentry artifact retention is a product policy that can change, and a Sentry project can be misconfigured, rotated or accidentally purged. If that happens and the bundle is gone, a shipped binary becomes permanently unsymbolicatable.

**The archive of record is a GitHub Release asset on the immutable tag `ios/v<version>+<build>`.**

```bash
gh release create "ios/v${APP_VERSION}+${APP_BUILD}" \
  "10q-ios-${APP_VERSION}+${APP_BUILD}-webbundle.tgz" \
  --title "iOS ${APP_VERSION} (${APP_BUILD})" \
  --notes "release_sha=${RELEASE_SHA} · client_platform=ios · environment=production"
```

Contents of the tarball, all required:

| File | Why |
|---|---|
| `out/**/*.js` | the exact shipped bundles, with debug IDs injected |
| `out/**/*.map` | the maps |
| `capacitor.config.ts` | webDir and plugin config at build time |
| build metadata (`release_sha`, `app_version`, `app_build`, `environment`) | in the release notes above |

Separately retain the **`.xcarchive`** (it contains the dSYMs) for native-crash symbolication. It is large; a private bucket or the CI artifact store with an explicit long retention is fine — just make it *findable* by `(app_version, app_build)`.

**Retention rule:** keep everything for as long as any binary at that version could still be installed. In practice that is *indefinitely*. The only safe pruning trigger is the minimum-supported-version gate from [VERSIONING.md](VERSIONING.md) having moved past that version **and** telemetry showing zero sessions on it.

> **Gap worth deciding now:** the repo has `@sentry/nextjs` only (`apps/web/package.json`) — a JavaScript SDK. It captures JS errors inside the WebView. It does **not** capture native crashes: a Capacitor bridge fault, a plugin crash, an OOM kill. Those go to App Store Connect → Analytics → Crashes and Xcode Organizer only. Adding `@sentry/capacitor` would unify them and would also handle dSYM upload. See [DECISION REQUIRED](#decision-register).

---

## 5. TestFlight

### 5.1 The two tracks

| | Internal testing | External testing |
|---|---|---|
| Who | App Store Connect users on your team | Anyone — testers who are not ASC users |
| Cap | **100 testers** per app | **10,000 testers** per app |
| Review | **None.** A build at `Ready to Submit` can go straight to internal testers | **TestFlight App Review required.** First build of a version gets a full review; later builds for the same version might not |
| Availability | Minutes after processing | After review passes |
| How testers are added | Individually, from Users and Access | Email, CSV import, or a public link |
| Prerequisite | — | **An internal group must exist first.** You cannot create an external group otherwise |

Both tracks: **30 devices per tester**, **100 shareable builds**, builds expire **90 days after upload**.

Rate limits that will bite an automated pipeline:

- **Six** TestFlight App Review submissions per 24 hours.
- **One build per version in review at a time.** The next submission waits for approval.

### 5.2 Managing testers

**Internal** — App Store Connect → *app* → **TestFlight** → **Internal Testing** → **+** beside Testers. Only people who already exist under **Users and Access** appear. Adding requires the Account Holder, Admin, App Manager, Developer or Marketing role. To add someone new: invite them as an ASC user first, then add them to the group.

**External** — TestFlight → **External Testing** → **+** → name the group → attach a build → add testers. Three mechanisms:

| Mechanism | Use it for | Trade-off |
|---|---|---|
| Email invite | Named friends-and-family testers | You see their name, email, sessions, crashes |
| CSV import | Bulk | Same visibility |
| Public link | Open beta | Testers are **anonymous** — name and email are never shown in App Store Connect. You still get install date, sessions and crashes. Optionally "Filter by Criteria" (device/OS ranges) and cap between 1 and 10,000 |

For 10Q's first external round, use email invites: the smoke test in [§6](#6-the-testflight-smoke-test) needs a named human on a named device, and anonymous public-link testers cannot be chased for a repro.

### 5.3 Expiry

A build stops being installable from TestFlight **90 days after upload**; status becomes `Expired`. You can also expire one early.

Two things this does *not* do:

- It does not block App Store submission. The 90-day window governs TestFlight availability only.
- It does not evict testers after release: "if you don't expire your build and submit it to the App Store, testers who received an invitation to test will still be able to test your build even after it goes live."

Operationally: **a TestFlight build is not a release candidate that can wait.** If a build is going to sit for more than a few weeks before submission, plan to rebuild rather than to reuse.

### 5.4 Getting a build onto an App Store version

There is no promotion action. On the version page, **Build** section → **+** → pick the build → **Done** → **Save**.

Two constraints that surprise people:

- One build per app version. You can swap it as often as you like **until you submit** the version to review.
- "If an earlier version of your app is Ready for Distribution, the list only includes builds you have uploaded since that version was released" — older builds silently vanish from the picker. If the build you want is not listed, that is why.

---

## 6. The TestFlight smoke test

**This is the only gate that tests the real artifact.** Everything in CI tests something else.

Be specific about the gap. `apps/web/playwright.config.ts` defines **one** project, `Desktop Chrome` (`:27-32`), with `webServer: 'npm run dev'` (`:35-40`) — a live Next dev server *with* `middleware.ts` running. The iOS artifact is a **static export**, in **WKWebView**, on a **`capacitor://localhost` origin**, with **no middleware at all**. Those differ in the runtime, the rendering engine, the origin, the storage semantics and the auth path. Playwright's four shallow assertions across three files ([02-current-state.md §6](../02-current-state.md)) do not touch any of it.

Run every row below on a **real device**, on the **exact build being submitted**, before it goes to App Review.

| # | Check | Why Playwright cannot cover it | Pass criterion |
|---|---|---|---|
| 1 | **OAuth cold sign-in** via `ASWebAuthenticationSession` | Playwright drives Chromium; the native sheet is an iOS system API. Google returns `disallowed_useragent` inside an embedded WebView, so this failure mode only exists on device | Google **and** Apple sign-in each complete in the system sheet and return an authenticated session |
| 2 | **Anonymous → named upgrade** (`linkIdentity`) | Redirect-only flow through the in-app browser; no Playwright equivalent | Same user id before and after. **Streak, history and league membership all survive** |
| 3 | **Deep-link return into the app** | The OAuth callback arrives as an `appUrlOpen` event, not a navigation. `auth/callback/page.tsx` does its work in a `useEffect` and never mounts on native | `exchangeCodeForSession` runs, `?next=` is honoured, and the user lands on the intended screen |
| 4 | **Universal Link, cold start** | Requires the entitlement + AASA + a real install. Nothing in CI exercises Apple's CDN | Tapping `https://play10q.com/invite/<code>` from Messages opens the **app** (not Safari) at the invite screen, from a fully terminated state |
| 5 | **Outbound share link correctness** | `window.location.origin` is `capacitor://localhost` on device — a URL meaningless to the recipient. Silently breaks the growth loop | The shared invite URL starts `https://play10q.com` |
| 6 | **Push permission + delivery** | APNs does not exist in a browser test | Prompt appears at the primed moment (after a first completed quiz, not on launch); a daily-drop push arrives; tapping it routes correctly from **cold, background and foreground** |
| 7 | **Background / foreground mid-quiz** | No browser-test equivalent of an OS suspend. The rAF countdown halts while backgrounded; on resume it snaps to 0 and the server records a 0-point timeout | Background during Q5 for 30s, return: the client reconciles with the server and the displayed deadline matches the server's |
| 8 | **App kill mid-quiz, relaunch** | `sessionStorage` does not survive a WebView process kill — on mobile that is the normal interruption, not an edge case | Progress is intact; the resume path does **not** hand back a fresh 12s timer ([03-blocking-fixes.md C3](../03-blocking-fixes.md)) |
| 9 | **Offline resume** | Requires real airplane-mode transitions | Answer offline → the answer queues durably → reconnect → it drains and the server accepts it |
| 10 | **Native share sheet** | `@capacitor/share` is a native API | The iOS share sheet opens with the emoji-grid text; `share_clicked` **and** `share_sheet_opened` both fire |
| 11 | **Haptics** | Not observable in any headless environment | A distinguishable tap on answer lock-in, correct and wrong |
| 12 | **Session durability** | The failure is silent and only occurs on the custom-scheme origin | Three cold starts **and a reinstall-then-restore** do not mint a new anonymous user. A storage read failure must never be treated as "no session, create one" |
| 13 | **Inter-question navigation** | Under `output: 'export'` Next issues `fetch(url, {method:'HEAD'})` before filling its route cache; on iOS that goes through `WKURLSchemeHandler`, not an HTTP server. `python3 -m http.server` handles HEAD correctly and cannot detect the failure | `/play/q/1/ → /play/q/2/` is a client transition: `GameProvider` not remounted, no white flash |
| 14 | **Avatars render** | Validates `images.unoptimized` in the shipped bundle | OAuth provider avatars display; no `/_next/image` request is attempted |
| 15 | **Safe areas** | Requires a notched device in portrait | No collision at `ArcadeBackground`, `Toast`, `BottomDock`, the invite CTA, or either `AuthButton` |
| 16 | **Telemetry round-trip** | Confirms §2 and §4 actually worked | Sentry shows a **symbolicated** JS error tagged `client_platform: ios`, `release: 10q@<version>`, `dist: <build>`. PostHog shows events with `client_platform: ios` and the right `app_build` |
| 17 | **Pre-drop state** | Time-dependent product behaviour | Open the app **before 11:30 UTC**: a countdown appears, not an error and not an empty screen |

Row 16 is the one most likely to be skipped and the most expensive to skip: if it fails, every crash from this release is unreadable, and you will not find out until you need it.

---

## 7. Submission to App Store review

### 7.1 Sequence

1. **Prepare.** App Store Connect → *app* → **+ Version or Platform** → iOS → enter the version string (must equal `CFBundleShortVersionString`). Fill the metadata in [§7.2](#72-app-privacy--privacy-nutrition-labels)/[§7.3](#73-metadata-checklist). Attach the build ([§5.4](#54-getting-a-build-onto-an-app-store-version)). **Save.**
2. **Choose a release option** — this decides what happens *after* approval:

   | Option | Result |
   |---|---|
   | Manually release this version | Lands in `Pending Developer Release`. **Recommended for the first several releases** — approval and publication become separate decisions |
   | Automatically release this version | Goes public as soon as review passes, possibly at 03:00 your time |
   | Automatically release after review, no earlier than *(date/time)* | Scheduled |

3. **Submit.** **Add for Review** → status `Ready for Review` → **Submit for Review** → `Waiting for Review` → `In Review`.
4. **Wait.** ~90% of submissions are reviewed in under 24 hours.
5. **Release.** See [§8](#8-phased-release).

Concurrency limits: **one app version per platform in review at a time**, and at most **two submissions per platform** (one containing an app version, one containing items only). Items from different platforms cannot share a submission.

### 7.2 App Privacy / privacy nutrition labels

Entered by a human under **App Privacy**, but the *answers* are an engineering artifact, not a marketing one — and Apple's disclosure obligation explicitly covers third-party SDK behaviour. Derive them from what PostHog and Sentry actually collect ([OBSERVABILITY.md](../OBSERVABILITY.md)), not from what you intended them to collect.

Two settings dominate the answers and are currently inherited defaults:

- **PostHog `autocapture` is ON** and never overridden. It ships DOM click/change/submit events and captures element text — which broadens the declaration well beyond the 16 typed events.
- **Session recording is not disabled in code**, so whether it records is decided by PostHog remote config, not by the repo. That is not an acceptable state for a store declaration.

**Decide both explicitly before the first submission and write the decision into [OBSERVABILITY.md](../OBSERVABILITY.md).** An inaccurate privacy declaration is an enforcement matter, and it is checked against observed SDK network behaviour, not against your description of it.

**ATT is not triggered today.** App Tracking Transparency applies when data tracks a person across *other companies'* apps and sites for advertising or measurement, or is shared with a data broker. 10Q runs first-party product analytics with no ad SDK, no attribution SDK and no broker sharing. Re-check the moment any of those is added — that, not PostHog's presence, is what changes the answer.

**Accessibility Nutrition Labels** now exist under **Manage app accessibility** (VoiceOver, Voice Control, Larger Text, Dark Interface, Differentiate Without Color Alone, Sufficient Contrast, Reduced Motion, Captions, Audio Descriptions). They are currently **optional** with no published mandatory date, but Apple has signalled intent to require them. Do not claim support you have not verified — the accessibility floor in [05-migration-plan.md](../05-migration-plan.md) Phase 5 (`aria-live` on answer correctness, `role="dialog"` + focus trap on the five modals) is not yet built.

### 7.3 Metadata checklist

| Item | Required? | Source / note |
|---|---|---|
| App name, subtitle | Yes | [DECISION REQUIRED](#decision-register) — the store display name is not chosen |
| Promotional text | No | Editable without a new version — useful for "today's quiz drops at 11:30 UTC" |
| Description, keywords | Yes | |
| **Support URL** | **Yes** | Must be live and reachable before submission. Does not exist today ([STORE_READINESS.md](../STORE_READINESS.md)) |
| **Privacy policy URL** | **Yes** | Must be live. Does not exist today ([03-blocking-fixes.md B4](../03-blocking-fixes.md)) |
| Marketing URL | No | `https://play10q.com` |
| Copyright | Yes | |
| Primary/secondary category | Yes | [DECISION REQUIRED](#decision-register) |
| **Age rating questionnaire** | **Yes** | Updated questionnaire mandatory since 2026-01-31; unanswered **blocks version updates**. Answers must account for UGC (handles + league names) |
| Screenshots | Yes | Every required device size. The repo has one brand asset today: `apps/web/public/brand/10q-logo.png` |
| App icon | Yes | Generate via `@capacitor/assets`; commit the generated `Assets.xcassets` |
| Export compliance | Yes | Pre-answered by `ITSAppUsesNonExemptEncryption` in `Info.plist` ([§3.6](#36-archive)) |
| **EU trader status** | **Yes for EU availability** | Console, human-only. Unverified ⇒ removed from the EU App Store |
| App Review notes | Effectively yes | See [§7.5](#75-reviewer-notes--the-anonymous-first-problem) |
| Demo account | See [§7.5](#75-reviewer-notes--the-anonymous-first-problem) | |

### 7.4 Account-deletion disclosure

**Guideline 5.1.1(v), verbatim: "If your app supports account creation, you must also offer account deletion within the app."** One sentence, unconditional.

Three things follow that are easy to get wrong:

1. **"Within the app" rules out a support-email or website-only path.** A link out to a web form does not satisfy it.
2. **Anonymous-first does not exempt 10Q.** The app creates accounts (`signInAnonymously`, then `linkIdentity` to Google/Apple) and persists data against them. The guideline attaches to account creation, not to whether a password was typed.
3. **Google separately requires a public web deletion-request URL** reachable *without reinstalling the app* — a different requirement, not a substitute. Build both.

**Current status: 🔴 no delete-account path exists anywhere in the repo** — no Edge Function, no UI, and `/settings` has exactly one feature ([03-blocking-fixes.md B1](../03-blocking-fixes.md)). This is a predictable rejection. It must land before submission.

When it does land, put the **exact in-app navigation path** in App Review notes (e.g. "Profile → Settings → Delete Account → confirm"). Reviewers check it; a reviewer who cannot find it rejects rather than hunts. If App Store Connect requests an account-deletion URL alongside the account-creation question, supply the public deletion-request page — but the thing Apple actually enforces is the in-app path.

Also settle the product question before building: a naive cascade **silently deletes other members' leagues**. Options are transfer, block-until-transferred, or soft-delete. Pick one deliberately.

### 7.5 Reviewer notes — the anonymous-first problem

App Store Connect asks whether sign-in is required and, if so, for demo credentials. 10Q's answer is unusual and needs explaining, or a reviewer will report they could not create an account.

**What the notes must say:**

1. **No account is needed for the core loop.** Every visitor gets an anonymous session on open; just play. State this first and plainly.
2. **The quiz drops at 11:30 UTC.** Before that, the app shows a countdown, not a quiz (`GameProvider.tsx:82`). **This is a real rejection risk** — a reviewer opening the app at 09:00 UTC sees no game. Say so explicitly, give the exact UTC time, and consider whether review builds should point somewhere with a quiz always available.
3. **Leagues and invites require sign-in.** Give the navigation path and what the reviewer should expect.
4. **Where account deletion lives** (once it exists) — exact path.
5. **Where the report and block controls live** (once they exist) — Apple 1.2 requires them and reviewers look.

**The demo-credential problem — [DECISION REQUIRED](#decision-register).** The sign-in UI exposes exactly two providers: `'google' | 'apple'` (`apps/web/src/lib/auth/oauth.ts:20`). Email/password functions exist at `apps/web/src/lib/auth.ts:6-27` but **have zero UI callers** — they are among the dead auth exports slated for deletion in [05-migration-plan.md](../05-migration-plan.md) Phase 3.

So there is currently **no credential you can hand a reviewer that works through the app's UI.** Handing over a real Google or Apple account is impractical (2FA on someone else's device) and a poor idea besides. Three options, in order of preference:

| Option | Cost | Risk |
|---|---|---|
| Keep a hidden email/password path reachable only by a documented gesture or a build-flagged screen, seeded with a demo account | Small — the functions already exist | A hidden auth path is a security surface; must be reviewed under [trust-boundary-and-security](../../../.agent/skills/trust-boundary-and-security/SKILL.md) |
| Provide a dedicated Apple ID for review with 2FA disabled and hand over the credentials | None in code | Apple sometimes rejects OAuth-only demo setups as unusable; account hygiene is poor |
| Make every reviewable surface reachable anonymously (leagues included) | Product change | Largest scope; changes the product, not the release process |

Decide this **before** the first submission, not during a rejection round-trip. Seed the demo account with a handle, at least one league, and a live invite code so the reviewer can actually exercise the flows.

### 7.6 When review fails

- **Fix and resubmit.** Normally correct and normally fastest.
- **Reply in Resolution Center** if the rejection rests on a misunderstanding. Answer every request for information before escalating.
- **Appeal to the App Review Board** if you believe the app complies. Apple asks for specific compliance reasons, **one appeal per failed submission**, and that you respond to outstanding information requests first. 30-minute App Review consultations over Webex are also available.
- **Expedited review** — web form at `https://developer.apple.com/contact/app-store/?topic=expedite`. Human-only; not in App Store Connect and not in the API. Qualifying circumstances are Apple's words: "fixing a critical bug in your app or releasing your app to coincide with an event you're directly associated with." For a bug include exact repro steps against the current shipped version; for an event include the event, its date and your association with it.

  **Do not reach for this by default.** Around 90% of submissions clear review in under 24 hours — usually faster than the expedite round-trip. Grants are on a limited basis and not guaranteed, and overuse is widely reported to reduce future success (that last part is third-party guidance, not Apple-published).

**The likeliest rejection for this app is Guideline 4.2 / 4.2.2** — "repackaged website", "web clippings". [ADR-001](../01-architecture-decision.md) and [STORE_READINESS.md](../STORE_READINESS.md) assess this as manageable, not existential: a legitimate daily game has "lasting entertainment value," which the guideline explicitly credits. The mitigations the guideline text itself points at are native platform integration and app-like UI beyond what the website offers — push, haptics, share sheet, offline availability, deep links. **Ship those because they make the game better, not to argue with a reviewer.** No individual API "solves" 4.2 and Apple publishes no threshold.

---

## 8. Phased release

### 8.1 The schedule

Apple's fixed 7-day schedule, not configurable:

| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Share of eligible users | 1% | 2% | 5% | 10% | 20% | 50% | 100% |

Who is included: "a random sample of users with automatic updates on eligible devices... without any notification of their participation." It applies to iOS and macOS devices **with automatic updates enabled**.

### 8.2 What it actually gates — read this before relying on it

> **Phased release is not a traffic gate.** Apple: "apps and app updates in phased release can be manually downloaded from the App Store by anyone at any time."

It throttles the **silent auto-update push** and nothing else. Any user who opens the App Store and taps Update, and every brand-new installer, gets the new build on day 1.

**Consequence for 10Q:** do not use phased release as a compatibility ramp for a backend change. Day 1 does not mean 1% of clients are on the new version — it means at most 1% got there *without choosing to*. The architectural rule stands unchanged: **clients and backend must tolerate version skew**; no API change may assume clients update atomically ([RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md), [04-shared-code-architecture.md](../04-shared-code-architecture.md)).

What phased release *is* good for: limiting the blast radius of a crash-level regression during the window in which you are watching the dashboards.

### 8.3 Availability

**Updates only. Never a first release.** Apple: "When you release a version update of your app, you can choose to release the new version to the App Store in stages."

So **10Q's first App Store release goes to 100% with no percentage safety valve and no rollback.** Plan accordingly: the first release's safety mechanisms are TestFlight coverage, the server-side minimum-supported-version gate, and PostHog feature flags — not the store.

Enable it when submitting a version update, while the app is in any of: `Prepare for Submission`, `Waiting for Review`, `In Review`, `Waiting for Export Compliance`, `Pending Developer Release`, `Developer Rejected`, `Rejected`, `Metadata Rejected`. It composes with the manual and scheduled release options.

While active, the version page reads `Ready for Distribution` with **Phased Release** appended. On completion, everyone with the Admin or App Manager role gets a notification.

### 8.4 Pause

Version page → **Phased Release for Automatic Updates** → **Pause Phased Release** → **Save**.

- Up to **30 days** of pause, **no limit on the number of pauses**.
- The 30 days is a **cumulative budget**: pause 10 days, resume, and 20 days remain.
- Resuming picks up on the day it left off — it does not restart.

API equivalent: `PATCH` the `appStoreVersionPhasedReleases` resource; `phasedReleaseState` moves between `ACTIVE` and `PAUSED`.

### 8.5 Release to everyone immediately

Once the version has `Ready for Distribution`, the **Release to All Users** button appears at the top right of the version page. All users with automatic updates on then get the latest version their device supports.

API equivalent: modify the `appStoreVersionPhasedReleases` resource — Apple documents that endpoint literally as "Pause or resume a phased release, or immediately release an app."

Use it when the release is healthy and you want the tail closed, or when a fix must reach everyone fast.

### 8.6 The irreversible stop condition

> **Removing the app from sale permanently forfeits phasing for that version.** Apple: "If you remove your app from sale — including when your Apple Developer Program membership lapses — phased release will stop and won't be available for that version again. When your app is reinstated, it becomes available to all users immediately, regardless of the percentage reached before removal."

So "pull it from the store" as an incident response is worse than it looks: you cannot resume the controlled rollout afterwards. To regain one you must make the version unavailable and submit a **new** version update with phasing enabled.

**Order of escalation for a bad iOS release:**

1. **Pause the phased release** — cheap, reversible, buys time.
2. **Server-side kill switch** — a PostHog feature flag disabling the broken path. This is the only lever that reaches users who already updated ([ROLLOUTS.md](ROLLOUTS.md)).
3. **Minimum-supported-version gate** — force-upgrade prompt for the bad build ([VERSIONING.md](VERSIONING.md)). Requires the `X-Client-Version` header work from [05-migration-plan.md](../05-migration-plan.md) Phase 2.
4. **Forward fix + expedited review.** There is no rollback on iOS. The fix is always a higher build number.
5. **Remove from sale** — last resort only, and understand it forfeits phasing for that version.

---

## 9. Automation boundary

### 9.1 What the App Store Connect API can do

Current API version: **4.4.1**. Auth: a JWT signed with the `.p8` key from [§1.3](#13-signing).

| Capability | Resource | Note |
|---|---|---|
| Upload a build | `build-uploads` | Added in **4.1**. `POST /v1/buildUploads` → `BuildUploadFile` reservations → `PUT` parts → commit. Contradicts the common belief that upload requires Xcode/altool/Transporter |
| Manage TestFlight | `betaGroups`, `betaTesters`, `betaTesterInvitations`, `betaRecruitmentCriteria`, `buildBetaDetails`, `betaBuildLocalizations`, `betaAppReviewDetail` | Fully automatable |
| Submit for TestFlight App Review | `betaAppReviewSubmissions` | `BetaReviewState`: `WAITING_FOR_REVIEW`, `IN_REVIEW`, `REJECTED`, `APPROVED` |
| Pull tester crashes/screenshots | `beta-feedback-crash-submissions`, `beta-feedback-screenshot-submissions` | Added in 4.0 |
| Metadata + localizations | `apps`, `app-metadata`, `appStoreVersions`, `appStoreVersionLocalizations`, custom product pages, app events | |
| Screenshots / previews / review attachments | asset reservation flow | Reserve → upload parts → `PATCH` with `uploaded: true` + MD5 `sourceFileChecksum` → poll to `COMPLETE`. **Reservations expire — finish within a week** |
| Submit for App Review | `reviewSubmissions` | **BREAKING CHANGE:** `POST /v1/appStoreVersionSubmissions` was **removed in API 4.0**. Current flow: `POST /v1/reviewSubmissions` → `POST /v1/reviewSubmissionItems` (attach the `appStoreVersion`) → `PATCH /v1/reviewSubmissions/{id}` with `submitted: true`. Also exposes `canceled`. States: `READY_FOR_REVIEW`, `WAITING_FOR_REVIEW`, `IN_REVIEW`, `UNRESOLVED_ISSUES`, `CANCELING`, `COMPLETING`, `COMPLETE`. Since 4.1, `platform` is no longer required |
| Phased release | `appStoreVersionPhasedReleases` | Create (enable), modify (pause / resume / release to all), delete (cancel a not-yet-started phase). Attributes: `currentDayNumber`, `phasedReleaseState`, `startDate`, `totalPauseDuration`. States: `INACTIVE`, `ACTIVE`, `PAUSED`, `COMPLETE` |
| Manual release | `appStoreVersionReleaseRequests` | Automates the **Release This Version** button for `Pending Developer Release` |
| Event notifications | webhooks | Added in 4.0 (app version state, TestFlight feedback); 4.1 added build-upload and build-beta-detail events. **Prefer these to polling** for review-state transitions |
| Provisioning | `bundleIds`, `certificates`, `profiles`, `devices` | Automatable; certificate creation needs a CSR and private-key handling |

**If you find automation written against `appStoreVersionSubmissions`, it is broken.** That is the single most likely stale pattern in any example you encounter.

### 9.2 What needs a human

| Task | Why |
|---|---|
| Developer Program enrollment and renewal | Identity verification |
| Accepting the Developer Program License Agreement | Console only |
| Banking, tax and signing agreements | No API resources exist |
| Creating the app record | Not reliably documented via API — use the console |
| **Expedited review request** | Web form on developer.apple.com, outside App Store Connect entirely |
| **App Review Board appeal** | Web form |
| EU trader status verification | Console compliance section |
| Age rating questionnaire | Treat the console as authoritative; verify before relying on an API path for the post-2026 questionnaire |
| App Privacy answers | Judgement call about SDK behaviour; a human should own the accuracy claim |

### 9.3 fastlane

`fastlane` wraps the same API and is the pragmatic choice for a small team:

- **`pilot`** — TestFlight builds, groups, testers, beta review submission.
- **`deliver`** — metadata, screenshots, submission for review.
- **`match`** — the shared certificate/profile repository from [§1.3](#13-signing).
- **`gym`** — wraps the `xcodebuild archive` + `-exportArchive` pair from [§3.6](#36-archive)–[§3.7](#37-export-the-ipa).

Use it if you want less bespoke shell. Do not use it as a reason to skip understanding the underlying steps — when signing or the export options are wrong, fastlane's error surface is `xcodebuild`'s.

### 9.4 A realistic CI shape

`ci.yml` today is one workflow on `ubuntu-latest`, with a `deploy` job gated on push-to-main that runs `npm run deploy` in `apps/web`. iOS cannot live there — `xcodebuild` needs macOS.

Recommended split, so that a routine web deploy can never accidentally ship a binary:

| Job | Runner | Trigger | Does |
|---|---|---|---|
| `ci` | `ubuntu-latest` | every PR | existing lint / typecheck / test / build / e2e, **plus a native export build** so a change that breaks `output: 'export'` fails the PR |
| `deploy-web` | `ubuntu-latest` | push to `main` | unchanged |
| `ios-testflight` | `macos-latest` (Xcode 26) | **manual `workflow_dispatch`** with `app_version` / `app_build` inputs, or a `ios/v*` tag | §3.1–3.8, then attach to an internal TestFlight group |
| `ios-submit` | `macos-latest` or `ubuntu-latest` | manual only | attach the build to the version, `POST /v1/reviewSubmissions`, `PATCH … submitted: true` |

**Keep `ios-submit` manual.** Submission consumes review capacity (one version in review per platform, six TestFlight review submissions per 24h) and interacts with human-only metadata state. It is not a step that should fire on a merge.

---

## 10. Deferred: OTA / live updates

**Out of scope for V1** ([ADR-001](../01-architecture-decision.md)). V1 is: web → normal deploy, iOS → TestFlight/App Store, Android → Play tracks. Recorded here only so a future reader does not re-derive the analysis.

Capacitor supports over-the-air web-asset updates (Appflow Live Updates, or self-hosted equivalents). It would let a JS fix reach iOS users without a review cycle — the single biggest operational win available on this channel, and the reason it will keep being proposed.

**The rules that govern it, current as of the June 8, 2026 guidelines:**

**Guideline 2.5.2**, verbatim: *"Apps should be self-contained in their bundles, and may not read or write data outside the designated container area, nor may they download, install, or execute code which introduces or changes features or functionality of the app, including other apps."*

The load-bearing clause is **"introduces or changes features or functionality."** Shipping revised HTML/CSS/JS that renders the same product the reviewer approved is not what 2.5.2 targets; shipping a new feature, a new screen, or different functionality through that channel is. **Practical rule: OTA may fix and refine what was reviewed, never add what was not.**

**A correction worth carrying:** nearly every article on this subject cites Apple Developer Program License Agreement **§3.3.2** and its carve-out for "scripts and code downloaded and run by Apple's built-in WebKit framework or JavascriptCore." **That guidance is stale.** In the current agreement the clause is renumbered **§3.3.1(B) "Executable Code"** and the WebKit/JavascriptCore language has been **removed entirely** — the strings "WebKit", "JavascriptCore" and "built-in" do not appear in the document. The current text permits downloading *interpreted* code only where it:

- (a) does not change the app's primary purpose by providing features or functionality inconsistent with its intended and advertised purpose — judged against the app **as submitted**;
- (b) does not bypass signing, the sandbox, or other OS security features; and
- (c) does not create a store or storefront for other applications.

The conditions are **conjunctive**, and the permission is now **framework-agnostic** — it no longer depends on the code running inside WebKit. Downloading native executable code remains flatly prohibited.

**Two adjacent guidelines that get missed:**

- **4.2.3(ii):** "If your app needs to download additional resources in order to function on initial launch, disclose the size of the download and prompt users before doing so." Applies if the shipped bundle becomes a thin shell that pulls web assets on first launch. **4.2.3(i)** additionally requires the app to work without installing another app.
- **4.7** ("Mini apps, mini games, streaming games, chatbots, plug-ins, and game emulators") expressly permits HTML5/JavaScript software not embedded in the binary, with its own obligations. It targets third-party or catalog-style content, **not** a first-party app updating its own assets — do not cite it as cover.

**Costs, if it is ever revisited:** a hosting/service dependency, a second distribution channel with its own failure modes, a rollback story that must itself be correct, and a permanent compliance judgement call on every OTA payload about whether it "adds" or merely "fixes." Also note it does nothing for native code — a Capacitor plugin change still needs a store release.

---

## Decision register

Every row is a value this document needs and cannot invent. **Do not substitute a placeholder into a real command.**

| # | Decision | Blocks | Notes |
|---|---|---|---|
| **D1** | **Bundle identifier** (e.g. `com.<org>.tenq`) | Everything: App ID registration, AASA `appIDs`, provisioning, the App Store Connect record | Effectively permanent — changing it means a new app listing with no reviews and no installed base. Must be chosen deliberately, not by whatever `npx cap init` prompts for |
| **D2** | **Apple Developer Team ID** | `ExportOptions.plist`, AASA `appIDs`, signing | Assigned by Apple at enrollment. Human retrieves it from the Membership page |
| **D3** | Apple Developer account type (individual vs organization) | Enrollment, the App Store seller name | Organization needs a D-U-N-S number and has longer lead time |
| **D4** | App Store display name, subtitle, categories, SKU | Listing metadata | |
| **D5** | Capacitor project location (`apps/mobile/` vs repo root) | Every command path in [§3](#3-the-build-chain) | This doc assumes `apps/mobile/`. Pin it when Phase 5 lands |
| **D6** | **Reviewer demo-credential mechanism** | Submission | No credential-based sign-in reachable through the UI exists today — providers are `'google' \| 'apple'` only (`apps/web/src/lib/auth/oauth.ts:20`); the email/password functions at `apps/web/src/lib/auth.ts:6-27` have zero callers. See [§7.5](#75-reviewer-notes--the-anonymous-first-problem) |
| **D7** | Environment for TestFlight/review builds (`production` vs `staging`) | `NEXT_PUBLIC_ENVIRONMENT`; reviewer experience | **No non-production environment exists** ([02-current-state.md §6](../02-current-state.md)). Interacts with the 11:30 UTC drop: a staging project with a quiz always available removes a real rejection risk |
| **D8** | Signing strategy: Xcode automatic + ASC API key vs `fastlane match` | CI design | Automatic is recommended for one developer; match once more than one machine builds |
| **D9** | Native crash reporting: add `@sentry/capacitor`, or accept App Store Connect / Xcode Organizer only | Crash visibility | Today only `@sentry/nextjs` is present — JS errors only. See [§4.3](#43-where-archived-source-maps-live) |
| **D10** | PostHog `autocapture` and session recording for native builds | App Privacy answers | Both currently inherited defaults; session recording is decided by remote config, not by the repo ([§7.2](#72-app-privacy--privacy-nutrition-labels)) |
| **D11** | Default release option (manual vs automatic) | [§7.1](#71-sequence) | Recommend **manual** until the release process has been exercised several times |
| **D12** | Source-map / `.xcarchive` archive retention location and policy | [§4.3](#43-where-archived-source-maps-live) | This doc proposes GitHub Release assets on the `ios/v*` tag; confirm or replace |

---

## Pre-flight checklist

Run through this before every upload. Nothing here is optional.

**Build**
- [ ] Clean tree; `ios/v<version>+<build>` tag pushed
- [ ] Xcode 26+, iOS 26 SDK, Node 22+
- [ ] `app_build` strictly greater than every previously uploaded build for this `app_version`
- [ ] All five identifiers present in the build env, including PostHog
- [ ] `grep -r "/_next/image" apps/web/out` returns nothing
- [ ] `manageAppVersionAndBuildNumber` is `false` in `ExportOptions.plist`
- [ ] `CFBundleVersion` in the IPA equals `$APP_BUILD`
- [ ] Zero `.map` files inside the IPA

**Sentry**
- [ ] Source maps uploaded for `10q@<version>` / dist `<build>` — verified in the Sentry UI, not assumed
- [ ] Exactly one upload for this `(release, dist)`
- [ ] Bundle + maps archived to the immutable tag before the maps were stripped
- [ ] `.xcarchive` (dSYMs) retained and findable by `(app_version, app_build)`

**Native**
- [ ] AASA returns 200 with `Content-Type: application/json` at `https://play10q.com/.well-known/apple-app-site-association`
- [ ] AASA `appIDs` matches `<TEAM_ID>.<BUNDLE_ID>` exactly, and covers both the legacy and query-param invite routes
- [ ] Associated Domains capability enabled on the App ID and the profile regenerated
- [ ] Native redirect URLs registered in Supabase → Authentication → URL Configuration
- [ ] The build is **not** flagged TestFlight Internal Only

**Verification**
- [ ] All 17 rows of the [TestFlight smoke test](#6-the-testflight-smoke-test) pass on a real device, on this exact build
- [ ] Sentry shows a symbolicated JS error tagged `client_platform: ios` with the right `release`/`dist`
- [ ] PostHog shows events with `client_platform: ios` and the right `app_build`

**Submission only**
- [ ] Privacy policy, support URL and deletion-request page all live and reachable
- [ ] In-app account deletion exists and its exact path is in the review notes
- [ ] Report / block / filter mechanisms exist and their paths are in the review notes
- [ ] Age rating questionnaire answered, with UGC accounted for
- [ ] App Privacy answers match observed SDK behaviour
- [ ] Review notes cover anonymous-first play, the 11:30 UTC drop, deletion, and moderation controls
- [ ] Demo account seeded with a handle, a league and a live invite code
- [ ] Release option chosen deliberately; phased release enabled if this is an update

---

## Related

- [ANDROID.md](ANDROID.md) — the Google Play counterpart. Different gates, different rollback semantics, and a hard 12-testers-for-14-days prerequisite that has no Apple equivalent
- [WEB.md](WEB.md) — Cloudflare Workers channel
- [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) — why three channels, and the version-skew contract
- [VERSIONING.md](VERSIONING.md) — `app_version` / `app_build` source of truth, minimum-supported-version gate
- [ROLLOUTS.md](ROLLOUTS.md) — promotion gates, feature flags, kill switches
- [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) — one-time account, signing and listing setup
- [../STORE_READINESS.md](../STORE_READINESS.md) — compliance requirements register
- [../OBSERVABILITY.md](../OBSERVABILITY.md) — the five identifiers, PostHog and Sentry configuration
- [../03-blocking-fixes.md](../03-blocking-fixes.md) — §B must land before submission
- [../01-architecture-decision.md](../01-architecture-decision.md) — why Capacitor, and the App Store review posture
