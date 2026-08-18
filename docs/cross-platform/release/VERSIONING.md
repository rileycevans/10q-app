# Versioning — The Identifier Contract

Every other release document depends on this one. `app_version` and `app_build` are the identifiers that appear in Sentry, PostHog, the App Store, Google Play, git tags, and the request header the backend gates on. If they are derived inconsistently, none of the downstream tooling can answer *"which build is this crash from?"* or *"is it safe to raise the minimum version?"*

**None of this exists today.** Zero git tags, no version file, no CHANGELOG, no release workflow. All three `package.json` files say `"version": "0.1.0"` (`package.json:3`, `apps/web/package.json:3`, `packages/contracts/package.json:3`) and have never moved. Nothing stamps a build id anywhere the client, Sentry or PostHog can read.

> **Architectural premise:** one codebase does not mean one deployment channel. Web, iOS and Android are three independently controllable release channels that do **not** go public simultaneously. Every rule below exists to make version skew survivable rather than surprising.

---

## 1. The contract in one page

| Field | Type | Scope | Source | Changes when |
|---|---|---|---|---|
| `app_version` | semver `MAJOR.MINOR.PATCH` | **product-wide**, all three platforms share one line | `version.json` | a human edits it in a PR |
| `app_build` | monotonic integer | **native artifacts only** | `version.json` | a native artifact is uploaded to a store |
| `release_sha` | 7-char git short SHA | per commit | git | every commit |
| `client_platform` | `web` \| `ios` \| `android` | per build target | build script | never at runtime |
| `environment` | `production` \| `staging` \| `development` | per build config | build script | never at runtime |

Two of these need care:

**`app_version` is the product version, not a per-deploy counter.** Web ships many builds of `1.4.0` before iOS and Android ever reach it. That is the normal state, not drift.

**`app_build` is the *native* artifact counter.** Web is continuously deployed on every push to `main` (`.github/workflows/ci.yml:56-59`); making it consume build numbers would mean a bot commit per deploy, which would retrigger CI. So:

> The **field** `app_build` is present on all three platforms. The **integer counter** is native-only. On web, `app_build` carries the release SHA, which *is* web's unique artifact id.

This keeps every consumer branch-free — Sentry's `dist`, PostHog's super property and the request header all read one variable — while guaranteeing the value uniquely identifies the artifact on each platform. It is the one place where the shape of the identifier differs by platform, and it is deliberate.

---

## 2. The source of truth

**One file, at the repo root: `version.json`.**

```json
{
  "app_version": "1.0.0",
  "app_build": 1
}
```

That is the entire file. Nothing else in the repo declares a product version.

### Why a standalone file and not `package.json`

- **It must be readable without npm.** A Gradle build, an `.xcconfig` generator and a shell script all need it. Parsing `package.json` from Gradle works but implies the npm workspace root is the versioned thing, which it is not.
- **`npm version` would fight us.** It auto-creates a lightweight git tag named `v1.4.0`, which is neither of the tag schemes in §6, and it cannot represent `app_build` at all.
- **There are three `package.json` files.** Any scheme that versions one of them invites the other two to drift.

### Rules for `version.json`

1. It is edited by **exactly one** mechanism: `scripts/release/version.mjs bump …`, committed in a PR. Never hand-edited, never edited by CI.
2. The three `package.json` `"version"` fields stay at `0.1.0` forever. They are private, unpublished npm metadata and are **not** the product version.
3. `scripts/release/version.mjs check` runs in CI and fails the build if any generated artifact (§4.4, §4.5) disagrees with `version.json`.

### DECISION REQUIRED — starting `app_version`

The live web product has no version number today. Recommendation: seed `version.json` with **`1.0.0` / build `1`** at the moment this lands, and let web move it forward normally.

Consequence to accept up front: by the time the first iOS build is submitted, `app_version` will be something like `1.3.0`, so **the first App Store version will not be `1.0.0`**. That is fine — Apple imposes no such convention — and it is strictly better than forking the version line to make the store listing look tidy.

---

## 3. The platform mapping

| Concept | `version.json` | iOS | Android | Sentry | PostHog | `X-Client-Version` |
|---|---|---|---|---|---|---|
| User-facing version | `app_version` = `1.4.0` | `CFBundleShortVersionString` (via `MARKETING_VERSION`) | `versionName` | `release` = `10q@1.4.0` | `app_version` | the `1.4.0` segment |
| Artifact identity | `app_build` = `42` | `CFBundleVersion` (via `CURRENT_PROJECT_VERSION`) | `versionCode` | `dist` = `42` | `app_build` | the `+42` segment |
| Web artifact identity | *(n/a)* | — | — | `dist` = `a1b2c3d` | `app_build` = `a1b2c3d` | `+a1b2c3d` |

### Platform constraints you cannot design around

| Field | Constraint |
|---|---|
| `CFBundleShortVersionString` | Up to three period-separated integers. Shown in the App Store. Must increase across public releases. |
| `CFBundleVersion` | Up to three period-separated integers. Must be **unique and increasing within a given `CFBundleShortVersionString`**. A build uploaded to App Store Connect permanently consumes its value, whether or not it is ever released. |
| `versionCode` | Positive integer, max **2,100,000,000**. Must strictly increase. Google rejects an upload reusing a value used before. Invisible to users. |
| `versionName` | Free-form string. Google enforces no format and **no ordering** — it plays no role in update eligibility. |

Because `versionCode` is what Play uses to decide update eligibility, and because a tester on a closed track with a high `versionCode` will not be pushed backward when production later ships a lower one, **keep `app_build` monotonic across the whole app, never per-track.**

### Sentry `release` + `dist`

`release` alone is not enough for mobile: the same `app_version` will have several builds, each with its own bundle and sourcemaps. `release` + `dist` is the pair Sentry uses to resolve them. This matters far more on native than on web — a crash arriving today can come from a binary reviewed four months ago, whereas the deployed web bundle is always the latest.

See [../OBSERVABILITY.md](../OBSERVABILITY.md) for the full init blocks. One refinement to the snippet there: derive `dist` in `src/lib/version.ts` (§4.6) rather than reading `NEXT_PUBLIC_APP_BUILD` at each call site, so the web/native difference lives in one line.

---

## 4. Propagation — the actual mechanism

`NEXT_PUBLIC_*` is **inlined by the bundler at build time**. There is no runtime lookup, no `.env` read on device, and no way to change these values in a shipped store binary. Every step below therefore happens *before* `next build`.

```
version.json                          ← the only human-edited source
  │
  └─ scripts/release/version.mjs      ← the only reader
       │
       ├─ `env`  → NEXT_PUBLIC_APP_VERSION
       │           NEXT_PUBLIC_APP_BUILD
       │           NEXT_PUBLIC_CLIENT_PLATFORM
       │           NEXT_PUBLIC_RELEASE_SHA
       │           NEXT_PUBLIC_ENVIRONMENT
       │             │
       │             ├─ web:    ci.yml `ci` job + `deploy` job → next build → Cloudflare Worker
       │             └─ native: scripts/build-native.sh → next build (output:'export') → npx cap sync
       │                          │
       │                          └─ apps/web/src/lib/version.ts   (inlined constants)
       │                               ├─ posthog.register({...})            super properties
       │                               ├─ Sentry.init({ release, dist, tags })
       │                               └─ X-Client-Version request header
       │
       └─ `apply-native` → <cap>/ios/App/Version.xcconfig   → Info.plist → App Store Connect
                           <cap>/android/version.properties → build.gradle → Play Console
```

### 4.1 `scripts/release/version.mjs`

`scripts/release/` already exists as a set of deliberately-failing stubs (`preflight`, `verify`, `web`, `ios-build`, `ios-submit`, `android-build`, `android-submit` — see `scripts/release/README.md`). Those are the **channel operations**, implemented in [../05-migration-plan.md](../05-migration-plan.md) Phase 9.

`version.mjs` is different and lands earlier. It performs no release action and has no public impact — it is a pure derivation helper that every other script, both CI jobs and both native builds read. **It is a Phase 2 prerequisite**, and nothing downstream in this document works until it exists.

| Subcommand | Behaviour |
|---|---|
| `env` | Prints `KEY=value` lines for the five identifiers. Reads `CLIENT_PLATFORM` and `APP_ENVIRONMENT` from the ambient env, defaulting to `web` / `production`. |
| `print` | Prints `version.json` plus derived values as JSON. For humans and for other scripts. |
| `bump major\|minor\|patch` | Rewrites `app_version` in `version.json`. Does **not** touch `app_build`. |
| `build-bump` | Increments `app_build` by 1 and runs `apply-native`. |
| `apply-native` | Regenerates `Version.xcconfig` and `version.properties` from `version.json`. Idempotent. |
| `check` | Exits non-zero if the generated native files disagree with `version.json`, or if a `git describe`-visible release tag disagrees with it. **Runs in CI.** |

Reference implementation of the load-bearing part:

```js
#!/usr/bin/env node
// scripts/release/version.mjs
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const v = JSON.parse(readFileSync(resolve(ROOT, 'version.json'), 'utf8'));

const sha      = (process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD').toString()).trim();
const shortSha = sha.slice(0, 7);
const platform = process.env.CLIENT_PLATFORM  ?? 'web';        // web | ios | android
const env      = process.env.APP_ENVIRONMENT  ?? 'production'; // production | staging | development

// The one platform-shaped difference: on web the artifact id is the SHA.
const buildId = platform === 'web' ? shortSha : String(v.app_build);

const vars = {
  NEXT_PUBLIC_APP_VERSION:     v.app_version,
  NEXT_PUBLIC_APP_BUILD:       buildId,
  NEXT_PUBLIC_CLIENT_PLATFORM: platform,
  NEXT_PUBLIC_RELEASE_SHA:     shortSha,
  NEXT_PUBLIC_ENVIRONMENT:     env,
};

if (process.argv[2] === 'env') {
  for (const [k, val] of Object.entries(vars)) console.log(`${k}=${val}`);
}
```

**CI footgun:** `actions/checkout@v4` defaults to `fetch-depth: 1` and fetches no tags (`.github/workflows/ci.yml:15-16`). `git rev-parse HEAD` is fine at depth 1; `git describe` is not. Any job running `version.mjs check` against tags needs `fetch-depth: 0`.

### 4.2 Web build (Cloudflare Worker)

`.github/workflows/ci.yml` has one workflow with two jobs. The `ci` job builds at `:36-44`; the `deploy` job builds *and ships* at `:75-88` via `npm run deploy` (`apps/web/package.json:17` → `opennextjs-cloudflare build && opennextjs-cloudflare deploy`).

Add the same step to **both** jobs, immediately before the build step:

```yaml
      - name: Stamp version
        run: node scripts/release/version.mjs env >> "$GITHUB_ENV"
        env:
          CLIENT_PLATFORM: web
          APP_ENVIRONMENT: production
```

`>> $GITHUB_ENV` makes the values available to every later step in that job, so no `env:` block on the build step needs to change.

> **Fix the pre-existing drift while you are here.** `NEXT_PUBLIC_POSTHOG_KEY` / `HOST` are supplied to the deploy job (`:85-86`) but **not** to the `ci` job (`:38-44`). Because `NEXT_PUBLIC_*` is inlined, **CI verifies a different artifact than production ships.** `SENTRY_AUTH_TOKEN` is present in both (`:44` and `:84`), so each commit can upload two sourcemap sets for the same Sentry release from two non-identical builds. Adding version stamping on top of that drift bakes it into the identifiers. Make both jobs' env blocks identical.

Also add all five vars to `apps/web/.env.example`, which currently lists only Supabase, Sentry and PostHog keys.

### 4.3 Native build

`scripts/build-native.sh` (specified in [../04-shared-code-architecture.md](../04-shared-code-architecture.md)) must export the identifiers before `next build`:

```bash
set -a; eval "$(CLIENT_PLATFORM="$PLATFORM" APP_ENVIRONMENT="$APP_ENV" \
  node ../../scripts/release/version.mjs env)"; set +a
```

Order matters: `version.mjs apply-native` (§4.4, §4.5) writes the native project files, and `npx cap sync` does **not** touch versions — it copies the web bundle and `capacitor.config` only. Running `cap sync` will never fix a stale `Version.xcconfig`.

### 4.4 iOS

No `ios/` directory exists yet. When `npx cap add ios` creates it:

1. Create `ios/App/Version.xcconfig` — **generated by `version.mjs apply-native`, committed to git**:

   ```
   // GENERATED by scripts/release/version.mjs — do not edit.
   MARKETING_VERSION = 1.4.0
   CURRENT_PROJECT_VERSION = 42
   ```

2. **HUMAN STEP, one time, in Xcode:** open `ios/App/App.xcodeproj` → select the project → **Info** → **Configurations** → set `Version.xcconfig` as the configuration file for **both** Debug and Release. Commit the resulting `project.pbxproj` change.

3. **Verify** `ios/App/App/Info.plist` reads:

   ```xml
   <key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
   <key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
   ```

   If the generated template hardcodes `1.0` / `1`, replace the literals with these build-setting references. This is the step that most often gets skipped, and its failure mode is silent: every upload carries build `1` and App Store Connect rejects the second one.

Fallback if the xcconfig route is unavailable: `xcrun agvtool new-marketing-version 1.4.0` and `xcrun agvtool new-version -all 42`, run from `ios/App`. It edits `project.pbxproj` directly, which is a noisier diff and easier to get wrong in CI.

**Toolchain requirement (hard, enforced at upload):** since 28 April 2026, uploads to App Store Connect must be built with **Xcode 26 or later** against an iOS 26 SDK. Uploads that miss this are rejected before review. Capacitor 8 independently requires Xcode 26.0+.

### 4.5 Android

No `android/` directory exists yet. When `npx cap add android` creates it:

1. Create `android/version.properties` — **generated, committed**:

   ```properties
   # GENERATED by scripts/release/version.mjs — do not edit.
   appVersion=1.4.0
   appBuild=42
   ```

2. In `android/app/build.gradle`, read it in `defaultConfig`. Define both values in Gradle, never in `AndroidManifest.xml`, to avoid manifest-merge conflicts:

   ```gradle
   def versionProps = new Properties()
   file("$rootDir/version.properties").withInputStream { versionProps.load(it) }

   android {
       defaultConfig {
           applicationId "«DECISION REQUIRED — Android applicationId»"
           versionCode versionProps['appBuild'].toInteger()
           versionName versionProps['appVersion']
       }
   }
   ```

   `$rootDir` in a Capacitor Android project is the `android/` directory, so `$rootDir/version.properties` resolves to the file from step 1.

Generated-and-committed (rather than read straight from `version.json`) is deliberate: a developer opening Android Studio or Xcode directly gets correct versions without running any npm script, the values are visible in `git diff`, and `version.mjs check` in CI catches the one failure mode this introduces — someone editing the generated file by hand.

### 4.6 Runtime access — `apps/web/src/lib/version.ts`

Create this module. It is the only place in client code that touches `process.env.NEXT_PUBLIC_*` for identifiers.

```ts
// apps/web/src/lib/version.ts
export const APP_VERSION     = process.env.NEXT_PUBLIC_APP_VERSION     ?? '0.0.0';
export const APP_BUILD       = process.env.NEXT_PUBLIC_APP_BUILD       ?? '0';
export const CLIENT_PLATFORM = process.env.NEXT_PUBLIC_CLIENT_PLATFORM ?? 'web';
export const RELEASE_SHA     = process.env.NEXT_PUBLIC_RELEASE_SHA     ?? 'unknown';
export const ENVIRONMENT     = process.env.NEXT_PUBLIC_ENVIRONMENT     ?? 'production';

/** Wire format for the X-Client-Version header. See VERSIONING.md §7. */
export const CLIENT_VERSION_HEADER = `${CLIENT_PLATFORM}/${APP_VERSION}+${APP_BUILD}`;

/** Sentry dist: the native build number, or the release SHA on web. */
export const SENTRY_DIST = CLIENT_PLATFORM === 'web' ? RELEASE_SHA : APP_BUILD;
```

> **Inlining footgun.** Next replaces only *statically analysable literal* `process.env.NEXT_PUBLIC_FOO` expressions. `const { NEXT_PUBLIC_APP_VERSION } = process.env` and `process.env[key]` are **not** inlined and evaluate to `undefined` in the client bundle. Write the full literal property access every time, exactly as above.

### 4.7 Consumers

| Consumer | File | Change |
|---|---|---|
| PostHog super properties | `apps/web/src/lib/posthog.ts:17-20` | `posthog.register({...})` after `posthog.init(...)`. All 16 events already route through one `capture()` helper at `apps/web/src/lib/analytics.ts:14-21`, so no event call site changes. |
| Sentry | `apps/web/instrumentation-client.ts:3-13` | `release: \`10q@${APP_VERSION}\``, `dist: SENTRY_DIST`, `environment: ENVIRONMENT`, `tags.client_platform`. Today `environment` is `process.env.NODE_ENV` (`:6`), which can only ever say `production`. |
| Request header | `apps/web/src/lib/api/edge-functions.ts:41-43` | Add `'X-Client-Version': CLIENT_VERSION_HEADER` to the `headers` object. Single choke point — every one of the 22 Edge Function calls goes through `callEdgeFunction`. |

---

## 5. Rules

### When each number moves

| Bump | Trigger |
|---|---|
| **MAJOR** | A change that invalidates an installed client: an Edge Function contract change old clients cannot tolerate, or a product redesign that makes the old UI wrong. In practice this is also the only bump that should ever be paired with raising the minimum-supported version (§8). Expect this to be rare. |
| **MINOR** | A user-visible feature, a new screen, a new Edge Function, a new analytics event. Backward compatible. |
| **PATCH** | Bug fix, copy change, styling, dependency bump. No new capability. |

### Invariants

1. **`app_version` never resets and never goes backward.** There is one version line for all three platforms; platforms sit at different points on it, never on different lines.
2. **`app_build` never resets and never decreases.** Not per platform, not per version, not per track, not ever. Play rejects a reused `versionCode` outright; Apple rejects a reused `CFBundleVersion` within the same `CFBundleShortVersionString`.
3. **A rejected build still consumes its number.** App review rejection, TestFlight review rejection, a build you pull yourself — the number is spent. Fix, `build-bump`, upload as the next number. Never re-upload under the old one.
4. **Gaps in `app_build` are expected and fine.** Neither store requires contiguity. iOS may go `42 → 45` because Android consumed `43` and `44`.
5. **iOS and Android share the counter.** One `app_build` identifies one source revision across both native platforms. If both platforms ship from the same commit, both upload as `+42`. If only one ships, the other simply skips that number.
6. **Web does not consume build numbers.** Web is deployed on every push to `main`; its artifact id is `release_sha`.
7. **Web's `app_version` moves first.** There is no build review on web, so a feature reaches web at `1.4.0` days-to-weeks before the stores do. At any instant it is normal to see web on `1.4.0`, App Store on `1.3.1`, Play on `1.3.1`. Any query, dashboard or gate that assumes the three are equal is wrong.
8. **Never gate on `app_build`.** It is an artifact id, not an ordering you can express a policy against across platforms. Policy decisions use `app_version` (§8).

---

## 6. Git tagging

There are **zero tags in this repo today** (`git tag | wc -l` → `0`). Adopt the scheme below from the first release.

| Tag | Created when | Marks |
|---|---|---|
| `web-v1.4.0` | the commit where `app_version` first reached `1.4.0` in production | the version boundary on web. Routine same-version deploys are **not** tagged — they are identified by SHA. |
| `ios-v1.4.0+42` | an `.ipa` is **uploaded to App Store Connect** | a consumed `CFBundleVersion`. Exists even if the build is rejected or never released. |
| `android-v1.4.0+43` | an `.aab` is **uploaded to Play Console** | a consumed `versionCode`. Same rule. |
| `backend-v1.4.0+3` | Supabase migrations + functions are deployed | *(deferred)* Supabase is deployed by hand today and is not in CI. Adopt this when it enters CI — see [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md). |

Notes:

- **`+` is a legal git ref character.** Verified: `git check-ref-format refs/tags/ios-v1.4.0+42` exits 0. (`~ ^ : ? * [ \` and whitespace are the forbidden ones.)
- **Always annotated, never lightweight:** `git tag -a ios-v1.4.0+42 -m "iOS 1.4.0 build 42 → App Store Connect"`. Annotated tags carry a tagger, a date and a message, and `git describe` prefers them.
- **Tag at upload, not at release.** The tag records *what was built*, because that is when the build number is irreversibly consumed. What actually reached the public is recorded separately as a **GitHub Release** created on the tag that shipped. Tags = build history; Releases = shipped history.
- **Platform-scoped `describe`:** `git describe --tags --match 'ios-v*'` — an unfiltered `git describe` will happily return a web tag for an iOS build.
- **Push tags explicitly** (`git push origin ios-v1.4.0+42`); `git push` does not carry them by default.

---

## 7. The `X-Client-Version` header

### Wire format

```
X-Client-Version: <platform>/<major>.<minor>.<patch>+<build_id>
```

```
web/1.4.0+a1b2c3d
ios/1.4.0+42
android/1.4.0+43
```

`<platform>` is `web` | `ios` | `android`. `<build_id>` is the integer on native and the short SHA on web; the server treats it as an opaque string used only for logging and correlation. **All policy decisions read the semver segment only.**

One header, not three: every custom header must be enumerated in the CORS allow-list, and each one is another string to keep in sync.

### Client side

Set once in `apps/web/src/lib/api/edge-functions.ts:41-43`:

```ts
const headers: HeadersInit = {
  'Content-Type': 'application/json',
  'X-Client-Version': CLIENT_VERSION_HEADER,   // from @/lib/version
};
```

Every Edge Function call in the app goes through `callEdgeFunction`, which builds this object and passes it to `fetch` at `:168-172`. There is no second call path.

### CORS — this will break everything if you skip it

`supabase/functions/_shared/cors.ts:12-13` currently allows exactly four headers:

```ts
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
```

There is no wildcard. **Adding `X-Client-Version` without editing this line makes every browser request fail CORS preflight** — on web *and* on native, since Capacitor's WebView origin (`capacitor://localhost`) is also cross-origin to `*.supabase.co`. Add `x-client-version` to that list and deploy the functions **before** shipping any client that sends the header.

Related: `ALLOWED_ORIGIN` (`cors.ts:8`) falls back to `*` but is documented to be set to `https://play10q.com` in production. Setting it to a single origin will break the native clients, whose `Origin` is `capacitor://localhost` or `https://localhost`. That fix belongs with the native work — see [../03-blocking-fixes.md](../03-blocking-fixes.md) — but it lands in the same file, so do them together.

### Server side — log it everywhere, gate it almost nowhere

Every function should log the parsed client version using the existing structured logger (`supabase/functions/_shared/utils.ts:9`):

```ts
logStructured(requestId, "client_version", { platform, version, build });
```

That gives you a second, independent answer to *"who is still on old clients?"* from Supabase logs, without depending on PostHog ingestion. Logging is free and unconditional. **Gating is neither** — see §8.

---

## 8. The backend contract version and the minimum-supported-version gate

Store binaries stay installed indefinitely against a continuously-deployed backend. Two mechanisms manage that, and they are different tools for different jobs.

| Mechanism | Lives in | Purpose | Blast radius |
|---|---|---|---|
| **Per-function contract declaration** | code, next to the handler | one endpoint's payload changed; old clients must be told to update *for that endpoint* | one function |
| **Global minimum-supported version** | Edge Function secrets (config, not code) | a security or correctness problem makes running old clients unacceptable at all | every gated endpoint, every user |

The effective floor for a request is `max(global floor, that function's declared minimum)`.

### 8.1 Add the error code — in both places

```
CLIENT_UPDATE_REQUIRED
```

returned with HTTP **426 Upgrade Required**, and it must be added to **both** registries:

- `supabase/functions/_shared/response.ts:8-24` (the Deno copy)
- `packages/contracts/src/errors.ts:7-38` (the TypeScript copy consumed by web)

These are hand-maintained duplicates. Adding a code to only one of them is exactly bug **C5** in [../03-blocking-fixes.md](../03-blocking-fixes.md), where `ErrorCodes.INVALID_ANSWER` is referenced in an Edge Function, defined in neither registry, and ships as `{ code: undefined }` — invisible to alerting. Do not repeat it for the one code whose entire job is to be actionable.

The client must map it at `apps/web/src/lib/error-handling.ts:13-26` and render a blocking upgrade screen with a store link.

### 8.2 `supabase/functions/_shared/client-version.ts`

```ts
import { errorResponse, ErrorCodes } from "./response.ts";

export type ClientPlatform = "web" | "ios" | "android";
const PATTERN = /^(web|ios|android)\/(\d+\.\d+\.\d+)\+([A-Za-z0-9._-]+)$/;

export function parseClientVersion(req: Request) {
  const m = req.headers.get("x-client-version")?.match(PATTERN);
  return m ? { platform: m[1] as ClientPlatform, version: m[2], build: m[3] } : null;
}

const cmp = (a: string, b: string) => {
  const [A, B] = [a, b].map(s => s.split(".").map(Number));
  return A[0] - B[0] || A[1] - B[1] || A[2] - B[2];
};

/** Configured floor. Edge Function secrets → read at cold start, no code deploy. */
function configuredFloor(platform: string): string {
  return {
    web:     Deno.env.get("MIN_CLIENT_WEB"),
    ios:     Deno.env.get("MIN_CLIENT_IOS"),
    android: Deno.env.get("MIN_CLIENT_ANDROID"),
  }[platform] ?? "0.0.0";
}

/** Returns a 426 Response to short-circuit on, or null to continue. */
export function requireMinimumClient(
  req: Request,
  requestId: string,
  functionMin: Partial<Record<ClientPlatform, string>> = {},
): Response | null {
  const client = parseClientVersion(req);
  const platform = client?.platform ?? "unknown";
  const global = configuredFloor(platform);
  const fn = (client && functionMin[client.platform]) ?? "0.0.0";
  const floor = cmp(global, fn) >= 0 ? global : fn;

  if (floor === "0.0.0") return null;                     // gate disabled — the default
  if (!client || cmp(client.version, floor) < 0) {
    return errorResponse(
      ErrorCodes.CLIENT_UPDATE_REQUIRED,
      "This version of 10Q is no longer supported. Please update to keep playing.",
      requestId,
      426,
      { minimum_version: floor, platform },
    );
  }
  return null;
}
```

**Absent or unparseable header is treated as below any non-zero floor.** A client that does not send the header predates the header, so it predates everything. This is the intended semantics, and it is the first thing to verify against real data before raising a floor above `0.0.0` (§8.5).

### 8.3 Configuration and rollout of the floor

The floor lives in Edge Function secrets, **not** in code:

```bash
supabase secrets set MIN_CLIENT_IOS=1.3.0 MIN_CLIENT_ANDROID=1.3.0 MIN_CLIENT_WEB=1.4.0
supabase secrets list                                  # verify
supabase secrets set MIN_CLIENT_IOS=0.0.0              # instant revert
```

Why secrets rather than a constant in the code:

- **Raising the floor is the dangerous operation, so lowering it must be instant.** A secret change takes effect on the next function cold start with no deploy of 22 functions and no CI run.
- Supabase is deployed by hand today — a code-resident floor would require a manual 22-function redeploy to undo a mistake, during the incident the mistake caused.

Two consequences to accept:

- **Secrets are project-wide.** There is exactly one Supabase project ([../02-current-state.md](../02-current-state.md)), so there is exactly one floor for all environments. When staging exists, move the floor into a `public.client_release_gate` table read once per cold start with a short TTL cache — that also gives per-environment values and an audit trail.
- **Set the floor per platform, not globally.** Web's floor can be raised within hours: `middleware.ts` sets `Cache-Control: no-store` on HTML, so a reload gets the current bundle. iOS and Android floors must lag by weeks.

### 8.4 Which endpoints may be gated

**This is 10Q-specific and it is the most important rule in this section.** 10Q gives each player one attempt per day, on a 12-second-per-question server-authoritative clock. A gate that fires mid-attempt does not inconvenience a user — it destroys their single daily play.

| Endpoint | Gate? | Why |
|---|---|---|
| `get-current-quiz` | ✅ | Read-only entry point. A blocked client sees the upgrade screen and loses nothing. |
| `start-attempt` | ✅ **preferred gate point** | Blocks *before* the daily attempt is consumed. If you gate exactly one thing, gate this. |
| `get-global-leaderboard`, `get-league-*`, `get-my-leagues`, `get-profile-by-handle` | ✅ | Read-only. Degraded UX only. |
| `create-league`, `join-league`, `add-league-member`, `update-handle` | ✅ | Discretionary writes, always retryable after updating. |
| `start-question-timer` | ❌ **never** | The clock is running. |
| `submit-answer` | ❌ **never** | Mid-attempt. Blocking burns the attempt with no score. |
| `finalize-attempt` | ❌ **never** | The score is already earned; refusing to record it is data loss. |
| `resume-attempt` | ❌ **never** | Resume is the *common* path on mobile, not the rare one. |
| account deletion *(when it exists — [../03-blocking-fixes.md](../03-blocking-fixes.md) B1)* | ❌ **never** | Apple 5.1.1(v) and Google both require deletion to work. A gate that blocks it is a compliance failure, not a UX problem. |

Rule of thumb: **gate at the door, never in the middle of the room.** An in-flight attempt must always be able to complete on whatever client started it.

### 8.5 Procedure for raising the floor

1. **Ship the new client to all three channels.** Web deploy, App Store release, Play production rollout — all complete, not merely submitted.
2. **Wait.** Minimum **14 days** after the last channel reached general availability. Rationale in §8.6.
3. **Measure, do not estimate.** In PostHog, over the last 7 days of active users, break down by `client_platform` × `app_version`. Raise the floor only when **< 0.5%** of active users on that platform are below the candidate value. Cross-check against the `client_version` entries in Supabase Edge Function logs (§7) — PostHog will under-count anyone who blocks analytics.
4. **Confirm header coverage.** Zero requests arriving with no `X-Client-Version` at all. Those clients are blocked by *any* non-zero floor.
5. **Raise one platform at a time**, starting with web.
6. **Watch for 30 minutes.** Alert on the `CLIENT_UPDATE_REQUIRED` rate. If it exceeds the modelled figure by any meaningful margin, revert the secret immediately — the model was wrong, and every minute costs users their daily play.
7. **Never raise the floor to the version you just shipped.** Leave at least one MINOR of headroom (`1.3.0`, not `1.4.0`, in a world where `1.4.0` is current).

**Emergency exception.** A live exploit — the `delete-attempt` leaderboard bypass in [../03-blocking-fixes.md](../03-blocking-fixes.md) A1 is the archetype — justifies raising the floor immediately and accepting the breakage. Make that an explicit, logged decision with a named owner, not a reflex, and prefer fixing it server-side first: **the server is the only component you can change instantly on all three platforms.** A backend fix reaches every installed binary at once; a client-version gate reaches none of them any faster than the stores allow.

### 8.6 The failure mode: raising the minimum too early bricks installed apps

This is the one irreversible-feeling mistake in this document. The gate is a switch that says *"stop working until you update."* If the update cannot arrive, the app is simply broken, and the user's remedy is to delete it.

Why "just update" is not available to the user:

- **iOS review latency.** ~90% of submissions are reviewed in under 24 hours, but the tail is real and expedited review is discretionary, not guaranteed. You cannot promise a same-day fix.
- **Auto-update is not universal or immediate.** Phased release throttles only the *silent automatic* update push (1/2/5/10/20/50/100% over 7 days). It is not a traffic gate — anyone can manually download the new version on day 1 — but the corollary is worse for you: users who never open the App Store and have auto-update off may not update for weeks.
- **Android staged rollout offers the update to a fraction of users.** Halting a bad release does not downgrade anyone: users who already received it keep it. And the previous version only becomes the fallback if it is still policy-clean.
- **Some users can never update.** A device below your `minSdk` or minimum iOS version, or a device with no free storage, has no path to the new build. For them the gate is permanent.
- **First releases have no safety valve at all.** Apple's phased release is updates-only, and Google's staged rollout is updates-only — you also cannot halt a first release, because there is no previous version to fall back to. Your first store release goes to 100% of the targeted audience, immediately.
- **The blocked user may not even see why.** If the shipped client does not recognise `CLIENT_UPDATE_REQUIRED`, `getUserFriendlyErrorMessage` falls through to a generic failure (`apps/web/src/lib/error-handling.ts:42-43`) and the app looks broken rather than out-of-date.

That last point produces the ordering rule that makes the whole mechanism safe:

> **Build and ship the gate long before you ever use it.** Land `X-Client-Version`, the 426 handling and the upgrade screen with the floor pinned at `0.0.0`, in [../05-migration-plan.md](../05-migration-plan.md) **Phase 2**, before the first store binary exists. A client that cannot explain the block must never be blocked.

**Corollary for the CI/CD design:** because the floor is the only lever that works when mobile cannot roll back, it must never be the *first* lever you reach for. Order of preference for any incident: (1) fix it in the backend, (2) kill the feature with a PostHog feature flag, (3) roll the web Worker back, (4) halt the Play rollout / pause the iOS phased release, (5) raise the minimum-version floor. See [ROLLOUTS.md](ROLLOUTS.md).

### 8.7 Per-function contract declaration

For the ordinary case — one endpoint's payload shape changed — declare it at the top of the function rather than touching the global floor:

```ts
// supabase/functions/submit-answer/index.ts
//
// Contract v2 (since app_version 1.5.0):
//   accepts { selected_answer_id: string | null, timed_out?: boolean }
// Contract v1 (still supported):
//   requires a non-null selected_answer_id; clients send answers[0] on timeout.
//   See docs/cross-platform/03-blocking-fixes.md C2.
const CONTRACT = { version: 2, min_client: {} as Partial<Record<ClientPlatform, string>> };
```

Rules:

1. **`min_client` starts empty and stays empty until the replacement client has shipped and been adopted.** An empty `min_client` means "v1 clients still work" — which they must, because a v1 iOS binary will exist for months.
2. **Additive changes need no version bump at all.** New optional request fields and new response fields are invisible to old clients. Prefer them; they are the reason most contract changes never need a gate.
3. **A field rename or a semantic change is a v→v+1 and needs a dual-read window** long enough for the slowest channel to catch up. The server must accept both shapes for the whole window.
4. **Only populate `min_client` when the old behaviour is actively harmful** — wrong scores, a security hole — not merely inelegant.
5. Optionally echo `X-Contract-Version: 2` on responses from `_shared/response.ts`, so a client can log which backend contract it reached. Useful for diagnosing skew; costs one header.

`scripts/release/preflight` step 6 — *"no Edge Function change that breaks a client version still in the field"* — is the automated form of this check. Until it is implemented it is a manual review step, and it is the single most important thing to look at before deploying Supabase, because Supabase is deployed by hand and reaches all three platforms instantly.

---

## 9. Worked example — "streak freeze" through all three platforms

Starting state:

```
version.json          { "app_version": "1.3.2", "app_build": 41 }
web (production)      1.3.2   ← whatever is on main
App Store             1.3.1+38
Play production       1.3.1+39
```

Note the starting skew: iOS and Android are a patch behind web, and their build numbers differ because each consumed the shared counter at a different time. This is the normal steady state.

| Day | Action | `version.json` | Result |
|---|---|---|---|
| 0 | PR: streak-freeze feature + `version.mjs bump minor`. Review, merge to `main`. | `1.4.0` / `41` | CI `ci` job builds with `NEXT_PUBLIC_APP_VERSION=1.4.0`; `deploy` job ships the Worker. Tag `web-v1.4.0`. Web users have the feature within minutes. PostHog now shows `app_version=1.4.0, client_platform=web`. |
| 1 | Watch web. Sentry `release: 10q@1.4.0`, `dist: <sha>`. Clean. | — | Web is the canary for native. Every hour web runs `1.4.0` unbroken is evidence for the store submissions. |
| 2 | `version.mjs build-bump` → regenerates `Version.xcconfig` + `version.properties`. Commit `release: native 1.4.0+42`. | `1.4.0` / **`42`** | One commit changes both native projects' versions. `version.mjs check` passes. |
| 2 | `scripts/build-native.sh ios` → archive → upload to App Store Connect. Tag `ios-v1.4.0+42`. Distribute to the internal TestFlight group (up to 100 App Store Connect users, **no review required**). | — | `CFBundleShortVersionString=1.4.0`, `CFBundleVersion=42`. Sentry `release: 10q@1.4.0`, `dist: 42`. Sourcemaps uploaded and archived against that pair. |
| 2 | `scripts/build-native.sh android` → AAB → upload to Play internal test track. Tag `android-v1.4.0+42`. | — | `versionName=1.4.0`, `versionCode=42`. Same commit, same number, both platforms. |
| 3 | Submit iOS to App Review. Android internal → closed test (**this one goes through review**, typically up to 7 days). | — | Two independent review clocks now running. |
| 4 | **iOS rejected** — 5.1.1(v), account deletion not reachable. Build 42 is dead; **the number is spent.** | — | Do not re-upload as 42. Apple rejects a duplicate `CFBundleVersion` within `1.4.0`. |
| 5 | Fix, `version.mjs build-bump` → `43`, commit, rebuild, upload. Tag `ios-v1.4.0+43`. | `1.4.0` / **`43`** | Android skips 43 entirely — it does not need a rebuild. Gaps are fine. |
| 6 | Android closed test green → promote to production, staged rollout 5%. | — | `versionCode 42` in production. Increase manually: 5 → 20 → 50 → 100. Play never auto-advances. |
| 8 | iOS approved. Release with phased release enabled. | — | 1%/2%/5%/10%/20%/50%/100% over 7 days — for *automatic* updates only. Anyone tapping Update gets it on day 1. |
| 15 | All three channels at `1.4.0`; Play at 100%; iOS phased release complete. Create GitHub Releases on `ios-v1.4.0+43` and `android-v1.4.0+42`. | — | Tags record every upload (42 and 43 for iOS); Releases record what shipped (43). |
| 29 | **Only now** consider `MIN_CLIENT_IOS=1.3.0` / `MIN_CLIENT_ANDROID=1.3.0` — 14 days after GA, and only if < 0.5% of 7-day-active users are below it. Not `1.4.0`. | — | Web could have been raised to `1.3.0` around day 2. |

Final state:

```
version.json          { "app_version": "1.4.0", "app_build": 43 }
web (production)      1.4.0 + <sha>       tag web-v1.4.0
App Store             1.4.0+43            tags ios-v1.4.0+42 (rejected), ios-v1.4.0+43 (shipped)
Play production       1.4.0+42            tag android-v1.4.0+42
```

Three platforms, one version line, one build counter, one commit per version change, and every artifact traceable from a Sentry crash back to a git tag.

---

## 10. DECISION REQUIRED

Placeholders that must be resolved by a human before the corresponding step can run. Do not invent values.

| # | Decision | Blocks | Notes |
|---|---|---|---|
| 1 | **iOS bundle identifier** | `npx cap init`, App Store Connect record, `Version.xcconfig` wiring | Not chosen. Domain is `play10q.com`, so `com.play10q.app` is a natural candidate — needs Riley's confirmation, and it is effectively permanent. |
| 2 | **Android `applicationId`** | `android/app/build.gradle` `defaultConfig` | Same. Permanent — changing it means publishing a new app. |
| 3 | **Apple Team ID** | signing, `Version.xcconfig` consumers, App Store Connect API keys | Requires an enrolled Apple Developer Program account. See [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md). |
| 4 | **App Store numeric app id + Play package name** | the "Update" button on the `CLIENT_UPDATE_REQUIRED` screen (§8.1) | Without these the upgrade screen cannot deep-link to the store, which makes a gated user's only remedy "find it yourself". Do not enable any floor above `0.0.0` before these exist. |
| 5 | **Capacitor project root** | the relative paths in `version.mjs apply-native` | No Capacitor project exists yet. Recommended: a new `apps/mobile/` workspace holding `capacitor.config.ts`, `ios/`, `android/`, with `webDir: '../web/out'` — the Capacitor CLI roots at `process.cwd()` and resolves `webDir` relative to the config file. If this changes, one relative path in `version.mjs` changes and nothing else does. |
| 6 | **Starting `app_version`** | seeding `version.json` | Recommended `1.0.0` / build `1` (§2). Accept that the first App Store version will not be `1.0.0`. |

---

## 11. Implementation order

Everything here is [../05-migration-plan.md](../05-migration-plan.md) **Phase 2**. It blocks the observability work, the release machinery and the first store submission.

- [ ] Create `version.json` at the repo root (§2) — decision #6
- [ ] Create `scripts/release/version.mjs` with `env`, `print`, `bump`, `build-bump`, `apply-native`, `check` (§4.1)
- [ ] Add the stamping step to **both** CI jobs and make their env blocks identical (§4.2)
- [ ] Add the five `NEXT_PUBLIC_*` vars to `apps/web/.env.example`
- [ ] Create `apps/web/src/lib/version.ts` (§4.6)
- [ ] Wire PostHog super properties, Sentry `release`/`dist`/`environment`/`client_platform` (§4.7, [../OBSERVABILITY.md](../OBSERVABILITY.md))
- [ ] Add `x-client-version` to `supabase/functions/_shared/cors.ts:12-13` and deploy the functions **first** (§7)
- [ ] Send `X-Client-Version` from `apps/web/src/lib/api/edge-functions.ts:41-43` (§7)
- [ ] Add `CLIENT_UPDATE_REQUIRED` to **both** error registries (§8.1)
- [ ] Create `supabase/functions/_shared/client-version.ts`; log the client version in every function (§7, §8.2)
- [ ] Call `requireMinimumClient` in the gate-safe functions only (§8.4), with all `MIN_CLIENT_*` secrets set to `0.0.0`
- [ ] Build the upgrade screen and map the error at `apps/web/src/lib/error-handling.ts:13-26` — decision #4
- [ ] Add `version.mjs check` to CI
- [ ] *(after `npx cap add`)* `Version.xcconfig` + Xcode configuration wiring (human step, §4.4); `version.properties` + `build.gradle` (§4.5)
- [ ] Tag the first release of each channel (§6)

---

## Related

- [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) — how the three channels are built and shipped
- [ROLLOUTS.md](ROLLOUTS.md) — promotion gates, phased release, staged rollout, rollback ordering
- [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) — one-time account, signing and store-listing setup
- [../OBSERVABILITY.md](../OBSERVABILITY.md) — where the five identifiers are consumed
- [../01-architecture-decision.md](../01-architecture-decision.md) — why there is a version tail at all
- [../03-blocking-fixes.md](../03-blocking-fixes.md) — C5 (the error-code registry trap), A1 (the exploit that would justify an emergency floor)
- [../04-shared-code-architecture.md](../04-shared-code-architecture.md) — `scripts/build-native.sh`, the platform seam
- [../05-migration-plan.md](../05-migration-plan.md) — Phase 2 exit criteria
