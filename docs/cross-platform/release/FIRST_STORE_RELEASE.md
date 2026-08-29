# First Store Release — One-Time Setup Runbook

Everything in this file happens **exactly once**, and a large fraction of it cannot be done by an agent at all. Read it as two interleaved tracks: repo work an agent can execute, and account/legal/console work that needs a human with an Apple ID, a payment method, 2FA, and a legal identity.

**This is not the release procedure.** Once the first build of each platform is live, this document is dead and the recurring flow takes over: [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md), [IOS.md](IOS.md), [ANDROID.md](ANDROID.md), [WEB.md](WEB.md), [ROLLOUTS.md](ROLLOUTS.md), [ROLLBACKS.md](ROLLBACKS.md).

**Prerequisites you should already have read:** [../01-architecture-decision.md](../01-architecture-decision.md) (why Capacitor), [../02-current-state.md](../02-current-state.md) (the audit), [../03-blocking-fixes.md](../03-blocking-fixes.md) (what must be fixed first), [../STORE_READINESS.md](../STORE_READINESS.md) (the requirements register this runbook executes against).

---

## How to use this document

Every item has an ID, an owner, what it blocks, and a verification you can actually run.

| Marker | Meaning |
|---|---|
| 👤 **Human** | Needs an authenticated human session, 2FA, a payment method, a legal identity, or custody of a secret. An agent cannot do it and must hand off. |
| 🤖 **Agent** | Repo work: files, commands, generated config. Do it. |
| 👤→🤖 | A human produces a value (Team ID, SHA-256 fingerprint, API key); the agent then wires it into the repo. |
| 🤖→👤 | The agent drafts the exact text/JSON/answers; the human pastes and clicks the irreversible button. |
| 🚧 **DECISION REQUIRED** | A value nobody has chosen yet. **Never invent one.** Stop and ask. |

### Three rules for the executing agent

1. **Never invent a value marked 🚧.** A guessed bundle identifier that reaches a store is permanent — see [DEC-01](#dec-01--bundle-identifier--application-id).
2. **Never commit signing material.** Keystores, `.p8` keys, `.p12` certificates, provisioning profiles, service-account JSON. The root `.gitignore` does **not** currently cover any of these patterns (verified: `/Users/rocky/Code/10q-app/.gitignore` has no `*.jks`, `*.keystore`, `*.p8`, `*.p12`, `*.mobileprovision`). Adding those patterns is part of [GPL-04](#33-keystore-generation-and-custody).
3. **Never press a public-impact button.** Uploading to TestFlight internal is not public. Submitting for review, publishing a Play track, releasing to the App Store — those are. Draft, then hand off. This mirrors safety rule 1 in `.claude/skills/release/SKILL.md`.

---

## Section 0 — DECISIONS REQUIRED FIRST (blocking)

**Nothing else in this document can start until these are decided.** They are not reversible in any cheap sense: a bundle identifier is permanent once a build is uploaded, a Play account type determines whether you spend an extra three weeks before you can ship, and an Apple enrollment type puts either a person's or a company's legal name on the public store listing.

Record the answers in the table at the end of this section, commit it, and treat that table as the single source of truth for every console form in this runbook.

| ID | Decision | Who decides | Constraints that make this hard to change | Blocks |
|---|---|---|---|---|
| DEC-01 | **Bundle identifier / applicationId** | 👤 Riley | Permanent after first upload to either store. Changing it means a new app record, new URL, zero installs, zero reviews | Everything native |
| DEC-02 | **App display name** | 👤 Riley | Apple app name ≤30 chars, must be unique across the App Store; Play title ≤30 chars | App records, assets, listings |
| DEC-03 | **Apple Developer account: individual or organization** | 👤 Riley | Organization needs a D-U-N-S number and a legal entity (slow). Individual publishes Riley's legal name as the seller. Transfer later is possible but painful | Apple enrollment (long lead) |
| DEC-04 | **Play Console account: personal or organization** | 👤 Riley | **Highest-leverage decision in this document.** A personal account created after 2023-11-13 must run a closed test with ≥12 testers opted in for ≥14 *consecutive* days before it may even apply for production. Organization accounts are exempt | Android critical path (≈3 extra weeks) |
| DEC-05 | **Support URL** | 👤 Riley | Required by Apple. Also satisfies the fourth Apple 1.2 mechanism ("published contact information") — see [../03-blocking-fixes.md B2](../03-blocking-fixes.md) | Apple listing, UGC compliance |
| DEC-06 | **Marketing URL** | 👤 Riley | Optional on Apple. `https://play10q.com` is the obvious answer unless a separate landing page is wanted | Apple listing (soft) |
| DEC-07 | **Privacy policy URL** | 👤 Riley | Hard requirement on both stores, unconditionally — Google requires it even for apps that collect nothing. Page must exist and load before submission | Both listings, Data Safety, App Privacy |
| DEC-08 | **Account-deletion request URL** (Google) | 👤 Riley | Must work **without reinstalling the app**, prominently feature account deletion, and reference the app or developer name. Distinct from the in-app path | Play Data Safety form |
| DEC-09 | **Age rating answers** | 👤 Riley (agent drafts) | Must reflect what actually ships. 10Q has UGC (handles + league names). Apple's questionnaire changed 2026-01-31; an unanswered questionnaire blocks version updates | Both submissions |
| DEC-10 | **Primary category** | 👤 Riley | Apple: Games → subcategory (Trivia is the obvious one). Play: Games → Trivia. Changeable later, but it drives the whole listing | Both listings |
| DEC-11 | **Play target audience / age bands** | 👤 Riley | Selecting any band under 13 pulls in Google Play Families policy and materially expands the compliance surface | Play content declarations |
| DEC-12 | **What a reviewer sees before 11:30 UTC** | 👤 Riley + eng | The daily quiz drops at 11:30 UTC. A reviewer who opens the app at 09:00 UTC sees a countdown, not a game. **This is a live rejection risk.** Options in [§Reviewer notes](#section-6--reviewer-notes-and-demo-access) | Both submissions |
| DEC-13 | **Owned-leagues rule on account deletion** | 👤 Riley | Product decision, not a store one, but it blocks building the deletion path. A naive cascade silently deletes other members' leagues — [../03-blocking-fixes.md B1](../03-blocking-fixes.md) | GATE-01 |

### Detail on the two that bite hardest

#### DEC-01 — Bundle identifier / application ID

Capacitor takes one `appId` at `npx cap init` and uses it as **both** the iOS bundle identifier and the Android `applicationId`. Reverse-DNS, no underscores, no hyphens in the last component on Android.

Constraints to respect when choosing:

- It is the primary key of the app on both stores. Apple will not let you re-register it under a different team; Google will not let you reuse a package name that has ever been published.
- Google's Play Console Requirements (effective 2026-09-30) require package names to be registered in Play Console. Register early rather than discovering a collision late.
- It appears verbatim in the Universal Links AASA file (`<TEAM_ID>.<BUNDLE_ID>`) and in `assetlinks.json` (`package_name`).

Do **not** pick one on Riley's behalf. Record it as `<DEC-01>` throughout until it is decided.

#### DEC-04 — Play account type: the Android critical path

If the Play Console account is **personal** and was created after 2023-11-13:

1. You must run a **closed** test (not internal, not internal app sharing).
2. **12 testers minimum**, each **opted in continuously for 14 consecutive days**. A tester who opts out and back in resets *that tester's* clock.
3. Only then may you "Apply for production" and answer a written questionnaire (how testers were recruited, target audience and value proposition, what changed from feedback, why it is production-ready). Human review, "usually seven days or less."

That is a **≥21-day serial chain that starts only once you have a reviewable AAB and 12 real humans**. It is the single longest pole in this entire runbook.

If the account is an **organization** account (or a personal account created on or before 2023-11-13), none of this applies. Note that organization accounts require a D-U-N-S number consistent with the Dun & Bradstreet profile, and that certain app categories (financial, health, VPN, government) *must* use an organization account — 10Q is none of those, so this is a genuine choice.

**→ Decide DEC-04 first. It determines whether the Android launch date is +1 week or +4 weeks.**

### Decision record — fill this in and commit

```
DEC-01  bundle id / applicationId  : <DECISION REQUIRED>
DEC-02  app display name           : <DECISION REQUIRED>   (≤30 chars both stores)
DEC-03  Apple account type         : <DECISION REQUIRED>   individual | organization
DEC-03a Apple Team ID              : <fill after APL-01>
DEC-04  Play account type          : personal, created 2026-08-19 -> GPL-15 APPLIES
                                     (closed test, 12 testers, 14 consecutive days,
                                      then a human-reviewed written application)
DEC-05  support URL                : <DECISION REQUIRED>
DEC-06  marketing URL              : <DECISION REQUIRED>   (optional)
DEC-07  privacy policy URL         : https://play10q.com/privacy  (live)
DEC-08  deletion request URL       : <DECISION REQUIRED>
DEC-09  age rating answers         : <DECISION REQUIRED>   see §5
DEC-10  primary category           : <DECISION REQUIRED>
DEC-11  Play target age bands      : <DECISION REQUIRED>
DEC-12  reviewer pre-11:30 plan    : <DECISION REQUIRED>
DEC-13  owned-leagues rule         : transfer to longest-standing member;
                                     delete only if the owner is the last member.
                                     Implemented in delete-account and leave-league.
```

---

## Section 1 — Hard gates: code-complete before first submission

These are **not** store-console tasks. They are product code that must be merged and deployed before the first submission to either store. Each is a predictable rejection or a live exploit that a store binary makes trivially discoverable — an IPA and an AAB are both zip files.

Full detail and fix guidance is in [../03-blocking-fixes.md](../03-blocking-fixes.md). This table is the gate; that document is the work.

| ID | Gate | Source | Who | Why it blocks the first submission | Verify |
|---|---|---|---|---|---|
| GATE-01 | **Account deletion, in-app** | [B1](../03-blocking-fixes.md) | 🤖 | Apple 5.1.1(v): *"If your app supports account creation, you must also offer account deletion within the app."* One sentence, unconditional. "Within the app" rules out email-only or website-only. Google separately requires an in-app path **plus** DEC-08's web URL | A signed-in user can delete their account from `/settings` and the auth user + `players` row are gone. Currently `/settings` has exactly one feature (handle change) |
| GATE-02 | **UGC moderation — all four mechanisms** | [B2](../03-blocking-fixes.md) | 🤖 | Apple 1.2 requires *all four*: a filter that stops objectionable material **from being posted**, a report mechanism with timely response, the ability to block abusive users, and published contact info. 10Q currently has **zero of four** against a UGC surface of handles + league names | Filter fires in `update-handle` and `create-league`; a report endpoint + table exists; a block/hide relation exists; DEC-05's support page is live |
| GATE-03 | **`delete-attempt` exploit closed** | [A1](../03-blocking-fixes.md) 🔴 | 🤖 | Any signed-in user can wipe an attempt, replay with the answer key in hand, and score 100 daily. The only guard today is a client-side `if (!isAdmin)` at `apps/web/src/app/page.tsx:128` — which survives exactly as long as nobody reads the bundle | Function deleted, or a server-side admin check exists mirroring `create-quiz/index.ts:52-61` |
| GATE-04 | **`publish-quiz` authenticated or deleted** | [A2](../03-blocking-fixes.md) 🟠 | 🤖 | Unauthenticated service-role write. The whole function fleet runs `verify_jwt = false`, so a missing in-function check **fails open**. Also vestigial — the cron moved to the in-DB `publish_scheduled_quiz()` | `grep -n getAuthenticatedUser supabase/functions/publish-quiz/index.ts` returns a hit, or the directory is gone |
| GATE-05 | **Privacy policy live** | [B4](../03-blocking-fixes.md) | 👤 + 🤖 | Hard requirement on both stores. Google requires the URL even from apps that collect nothing. Must accurately describe PostHog and Sentry behaviour — see [§5](#section-5--app-privacy-apple-and-data-safety-google) | `curl -sI <DEC-07>` returns 200 and the page names the data practices in §5 |

**Not gates, deliberately:** custom Terms of Service (Apple supplies a Standard EULA), in-app purchase compliance (no monetization surface exists), Sign in with Apple (already implemented — [B5](../03-blocking-fixes.md)).

**Adjacent but strongly advised before submission**, from the same document: [B3](../03-blocking-fixes.md) (leagues are non-consensual and non-exitable — this *is* the concrete form Apple's "block abusive users" requirement takes here), and [C1](../03-blocking-fixes.md) (the DB trigger forces a 16s question expiry against 12s code; any native client that trusts `question_expires_at` inherits it).

Quick self-check the agent can run cold:

```bash
cd /Users/rocky/Code/10q-app
# GATE-01: does any deletion path exist yet?
grep -rniE 'delete.?account|deleteUser|admin\.deleteUser' apps/web/src supabase/functions | head
# GATE-03 / GATE-04: do the two exposed functions still exist?
ls -d supabase/functions/delete-attempt supabase/functions/publish-quiz 2>/dev/null
# GATE-02: any moderation surface at all?
grep -rniE 'report|block|moderat' supabase/functions --include=index.ts -l | head
```

An empty result on the first command and a hit on the second means **you are not ready to submit anything to anyone.**

---

## Section 2 — Apple

### 2.1 Checklist

| ID | Item | Who | Blocks | Verify |
|---|---|---|---|---|
| APL-01 | Enroll in the Apple Developer Program ($99/yr) | 👤 | Everything Apple | developer.apple.com shows an active membership; **Team ID captured into DEC-03a** |
| APL-02 | Accept the current Program License Agreement | 👤 | Uploads, submission | App Store Connect → Business shows no pending agreement banner |
| APL-03 | Complete EU DSA trader status | 👤 | EU availability | App Store Connect → Business → Trader status verified. Since 2025-02-17 unverified apps are **removed from the App Store in the EU**. Declaring trader publishes contact details — a real consideration if DEC-03 is *individual* |
| APL-04 | Register the App ID (explicit bundle id) with capabilities | 👤 | App record, signing, entitlements | Certificates, Identifiers & Profiles → Identifiers lists `<DEC-01>` with **Associated Domains** and **Sign In with Apple** enabled (Push later, Phase 7) |
| APL-05 | Create the App Store Connect app record | 👤 | Builds, metadata, TestFlight | App exists with `<DEC-02>`, `<DEC-01>`, a permanent SKU, primary language |
| APL-06 | Create an App Store Connect API key | 👤→🤖 | All later automation | A `.p8` exists **outside the repo**, plus Key ID and Issuer ID recorded out of band |
| APL-07 | Toolchain: Xcode 26+ with an iOS 26+ SDK | 🤖 | Any upload at all | `xcodebuild -version` — **this machine reports Xcode 27.0, which satisfies it.** Since 2026-04-28 non-conforming uploads are rejected *at upload*, before review |
| APL-08 | Signing certificates + provisioning profiles | 👤 | Archiving a build | Xcode → Signing & Capabilities shows a resolved team and profile with no red text |
| APL-09 | Associated Domains entitlement in the iOS project | 🤖 | Universal Links | `ios/App/App/App.entitlements` contains `applinks:play10q.com` |
| APL-10 | Serve `apple-app-site-association` from play10q.com | 🤖 | Universal Links | See [§2.3](#23-associated-domains-and-the-aasa-file) — three curl checks |
| APL-11 | Answer App Privacy | 🤖→👤 | Submission | App Store Connect → App Privacy has no "action needed". Answers derived in [§5](#section-5--app-privacy-apple-and-data-safety-google) |
| APL-12 | Answer the (new) age rating questionnaire | 🤖→👤 | Submission **and all future updates** | Rating shown on the version page. Unanswered questionnaires have blocked updates since 2026-01-31 |
| APL-13 | Export compliance declaration | 🤖 | Every upload | Add `ITSAppUsesNonExemptEncryption = false` to `Info.plist` (10Q is standard HTTPS only) so App Store Connect stops asking per submission |
| APL-14 | Screenshots + listing metadata | 🤖→👤 | Submission | [§4](#section-4--assets) |
| APL-15 | App Review Information: notes + demo account | 🤖→👤 | Submission | [§6](#section-6--reviewer-notes-and-demo-access) |
| APL-16 | Create the **internal** TestFlight group | 👤 | External testing (hard prerequisite) | Group exists with ≤100 App Store Connect users |
| APL-17 | First TestFlight build to internal testers | 🤖 build, 👤 upload | Device smoke test | Build reaches "Ready to Submit"; installs on a real iPhone |
| APL-18 | External TestFlight group (optional) | 👤 | Wider beta | Requires TestFlight App Review of the first build |
| APL-19 | Attach build to version and submit | 🤖 prepare, 👤 submit | Launch | Version status → In Review |

### 2.2 The Apple details that actually cost time

**Enrollment lead time (APL-01).** Individual enrollment often completes within a day or two; organization enrollment requires a D-U-N-S number and a verifiable legal entity and can take considerably longer. **Start this on day one.** It blocks everything Apple and nothing in the repo, which makes it the ideal thing to kick off before any code is ready.

**Signing (APL-08).** For the first release, use Xcode **automatic** signing with the team from APL-01. Do not build a manual-profile CI signing setup before you have ever successfully archived once by hand — you will be debugging two things at the same time. Convert to API-key-based CI signing afterwards, in [IOS.md](IOS.md).

Handoff shape for the agent: *"I need you to open `apps/mobile/ios/App/App.xcworkspace` in Xcode, select the App target → Signing & Capabilities, check Automatically manage signing, and pick team `<DEC-03a>`. Tell me if it resolves cleanly or shows an error."*

**TestFlight mechanics worth knowing before you plan around them:**

- Internal testers (≤100) are App Store Connect users on your team. **Internal distribution requires no review** — a build at "Ready to Submit" can already go to internal testers.
- External testers (≤10,000) **do** require TestFlight App Review. The first build of a version gets a full review; later builds of the same version might not. Rate limits: six submissions per 24h, one build of each version in review at a time.
- **You must create an internal group before you can create an external group.** This surprises people.
- Builds expire **90 days** after upload. Expiry governs TestFlight only — it does not block App Store submission, and testers who already installed keep access after the app goes live.
- 🚨 **A build uploaded as "TestFlight Internal Only" can never be submitted externally or to customers.** It is marked internal under the build number. If your release build carries that flag you must re-upload. Check this on the very first upload rather than discovering it at submission.

**There is no "promote from TestFlight."** TestFlight and App Store submission are two consumers of the same uploaded build. On the version page: Build section → **+** → select the build → Done → Save → **Add for Review** → **Submit for Review**. Only one build may be associated with a version at a time (changeable until you submit), and once an earlier version is Ready for Distribution the picker only lists builds uploaded since that release.

**Phased release does not apply to a first release.** It is updates-only. Your first App Store release goes to everyone. Plan for that; the phased-rollout machinery is [ROLLOUTS.md](ROLLOUTS.md)'s problem, not this document's.

**Submission concurrency.** One app version per platform may be in review at a time; at most two submissions per platform (one containing a version, one items-only).

**Expedited review is not a plan.** Apple reports ~90% of submissions reviewed in under 24 hours — usually faster than the expedite request round-trip. It exists (a web form at `developer.apple.com/contact/app-store/?topic=expedite`, not in App Store Connect and not in the API) for genuinely extenuating circumstances. Do not build a launch schedule that needs it.

### 2.3 Associated Domains and the AASA file

**Entitlement (APL-09).** After `npx cap add ios`, add to `apps/mobile/ios/App/App/App.entitlements`:

```xml
<key>com.apple.developer.associated-domains</key>
<array>
  <string>applinks:play10q.com</string>
  <string>applinks:www.play10q.com</string>
</array>
```

Both hostnames are routed to the Worker (`apps/web/wrangler.jsonc:11-14`), so both need to resolve or the one that redirects will silently not match.

**The file (APL-10).** Place it at `apps/web/public/.well-known/apple-app-site-association` — **no file extension**. Next.js copies `public/` into the build output, and OpenNext copies that into `.open-next/assets`, which Cloudflare's asset server serves.

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<DEC-03a>.<DEC-01>"],
        "components": [
          { "/": "/invite/*",  "comment": "League invite links" },
          { "/": "/invite",  "?": { "code": "?*" }, "comment": "Post-Phase-3 query-param invite shape" },
          { "/": "/u/*",       "comment": "Public profiles" },
          { "/": "/results*",  "comment": "Shared results" }
        ]
      }
    ]
  }
}
```

⚠️ **Match the final URL shape, not today's.** [../05-migration-plan.md](../05-migration-plan.md) Phase 3 converts `/invite/[code]`, `/u/[handle]` and `/leagues/[id]` to query-param routes with permanent Cloudflare redirects for the old shapes, because unbounded dynamic segments cannot be statically exported. Both shapes must appear in `components` or the invite loop — the growth surface — breaks on the first deep link.

**Two gotchas specific to this repo:**

1. **Content type.** Apple requires the AASA to be served as `application/json`. The file has no extension, so Cloudflare may infer the wrong type. Verify, and if it is wrong add `apps/web/public/_headers`:

   ```
   /.well-known/apple-app-site-association
     Content-Type: application/json
   ```

2. **Middleware.** `apps/web/src/middleware.ts:39-42` matches everything except `_next/static`, `_next/image`, `favicon.ico` and a handful of image extensions. `/.well-known/*` is **not** excluded. Cloudflare's default behaviour is to serve a matching static asset directly without invoking the Worker, so middleware should never see this request — but **verify it rather than assume it**, because a `Cache-Control: no-store` or an auth-refresh round trip on the AASA path is exactly the kind of thing that makes Universal Links flaky in a way that is miserable to debug.

**Verification — all three must pass:**

```bash
# 1. Direct fetch: 200, application/json, and NO redirect
curl -sS -D- -o /dev/null https://play10q.com/.well-known/apple-app-site-association
curl -sS -D- -o /dev/null https://www.play10q.com/.well-known/apple-app-site-association

# 2. Valid JSON with the right appID
curl -sS https://play10q.com/.well-known/apple-app-site-association | python3 -m json.tool

# 3. Apple's CDN has picked it up (this is what devices actually read)
curl -sS https://app-site-association.cdn-apple.com/a/v1/play10q.com | python3 -m json.tool
```

Apple's CDN caches. Publish the file **before** you need the links to work, not the same afternoon.

---

## Section 3 — Google Play

### 3.1 Checklist

| ID | Item | Who | Blocks | Verify |
|---|---|---|---|---|
| GPL-01 | Create the Play Console developer account ($25 one-time) — **type per DEC-04** | 👤 | Everything Android | Play Console loads; account shows verified |
| GPL-02 | Complete developer identity verification | 👤 | Publishing | Play Console → Account details shows verified. Organizations need a D-U-N-S consistent with their D&B profile |
| GPL-03 | Create the app record and register the package name | 👤 | Uploads | App appears in Play Console with `<DEC-01>`. Play Console Requirements (effective 2026-09-30) require registered package names, with global removal as the penalty for unregistered apps |
| GPL-04 | Generate the upload keystore and put it in custody | 👤 | Every signed build | [§3.3](#33-keystore-generation-and-custody) |
| GPL-05 | Play App Signing enrollment | 👤 | AAB delivery | Automatic for new apps. Play Console → Test and release → Setup → App signing shows an app signing certificate |
| GPL-06 | **First AAB upload, by hand** | 🤖 build, 👤 upload | The Play Developer API, fastlane, assetlinks.json | A build appears in App bundle explorer. The API cannot create an app, cannot fill legal consents, and explicitly requires at least one Console upload first |
| GPL-07 | Serve `assetlinks.json` from play10q.com | 🤖 | App Links | [§3.4](#34-assetlinksjson-and-the-fingerprint-trap) |
| GPL-08 | Data Safety form (incl. the DEC-08 deletion URL) | 🤖→👤 | Publishing to any reviewed track | App content → Data safety complete. Answers in [§5](#section-5--app-privacy-apple-and-data-safety-google) |
| GPL-09 | Content rating (IARC) questionnaire | 🤖→👤 | Publishing | Ratings issued and shown on the listing |
| GPL-10 | Target audience & content declarations | 👤 | Publishing | Per DEC-11. Selecting any under-13 band pulls in Families policy |
| GPL-11 | Store listing: title, descriptions, graphics | 🤖→👤 | Publishing | [§4](#section-4--assets) |
| GPL-12 | The deletion request web page | 🤖 | GPL-08 passing review | `curl -sI <DEC-08>` returns 200; page prominently offers account deletion and names the app or developer |
| GPL-13 | Target API level 36 (Android 16) | 🤖 | Any submission after 2026-08-31 | `grep targetSdk apps/mobile/android/app/build.gradle` — see [§3.2](#32-the-two-dates-that-matter-right-now) |
| GPL-14 | Internal test track build installs | 🤖 build, 👤 publish | Everything downstream | Testers get it "within minutes" |
| GPL-15 | **Closed test: 12 testers × 14 consecutive days** (personal accounts only) | 👤 | Production access | Play Console Dashboard shows the requirement satisfied |
| GPL-16 | Apply for production + questionnaire | 👤 | Production release | Approval, "usually seven days or less" |
| GPL-17 | Service account for the Play Developer API | 👤→🤖 | Later automation | JSON key exists outside the repo; service account invited into Play Console with permissions |
| GPL-18 | First production release | 👤 | Launch | **100%, no staged rollout, no halt** — see [§3.5](#35-the-first-production-release-has-no-safety-valve) |

### 3.2 The two dates that matter right now

Today is **2026-08-18**. Two Google deadlines are inside the plausible launch window:

| Date | Requirement | Effect if missed |
|---|---|---|
| **2026-08-31** (13 days) | New apps **and app updates** must target Android 16 (API 36) or higher | You cannot submit *anything*, including updates |
| **2026-09-30** (43 days) | Play Console Requirements: app registered in Play Console, package name registered, developer verification | Unregistered apps face "global removal from Google Play" |

Set `targetSdk 36` in `apps/mobile/android/app/build.gradle` from the very first Capacitor generation rather than accepting whatever the template ships. Verify with:

```bash
grep -nE 'compileSdk|targetSdk|minSdk' apps/mobile/android/app/build.gradle apps/mobile/android/variables.gradle
```

A separate, lower bar applies to *existing* apps staying discoverable (API 35), which is not your situation. Extensions to 2026-11-01 can be requested via Play Console.

### 3.3 Keystore generation and custody

👤 **Human, and only a human.** This is a secret with no recovery path if mishandled and no legitimate reason to pass through an agent's context.

```bash
keytool -genkeypair -v \
  -keystore 10q-upload.jks \
  -alias 10q-upload \
  -keyalg RSA -keysize 4096 \
  -validity 10000 \
  -storetype PKCS12
```

Requirements and rules:

- Play requires the upload key to be **at least 2048-bit RSA**. 4096 costs nothing.
- Validity must extend past 2033-10-22. `-validity 10000` (~27 years) clears it comfortably.
- **Store the `.jks` and both passwords in a password manager**, not in the repo, not in Dropbox-next-to-the-repo, not in a chat message.
- Before generating anything, add to `/Users/rocky/Code/10q-app/.gitignore` (🤖 the agent can do this part):

  ```gitignore
  # Signing material — never commit
  *.jks
  *.keystore
  *.p8
  *.p12
  *.mobileprovision
  keystore.properties
  google-play-service-account*.json
  ```

  The root `.gitignore` covers none of these today.

**Upload key vs app signing key — the distinction that causes the most Android pain:**

| | Upload key | App signing key |
|---|---|---|
| Who holds it | You | Google (Cloud KMS) |
| What it does | Signs the AAB you upload; Play verifies your identity from it | Google re-signs the generated APKs before delivery to devices |
| Lifetime | Rotatable | Constant for the app's life |
| If lost | **Recoverable** — request a reset in Play Console with a PEM cert for a new upload key | You never had it; Google keeps a disaster-recovery backup but will not give you a copy |
| Fingerprint used in `assetlinks.json` | ❌ **No** | ✅ **Yes** |

New apps are now enrolled by default in quantum-ready hybrid signing with Google-generated keys. Play App Signing is effectively mandatory: AAB is required for all apps created after August 2021, and building APKs from an AAB is exactly what Play App Signing does.

Capture the upload key fingerprint for your own records:

```bash
keytool -list -v -keystore 10q-upload.jks -alias 10q-upload
```

### 3.4 `assetlinks.json` and the fingerprint trap

**Serial dependency:** you cannot write this file until after GPL-06, because the SHA-256 you need is the **app signing key's**, and that key only exists once Play App Signing is enrolled — which happens on first upload.

Get it from **Play Console → Test and release → Setup → App signing → App signing key certificate → SHA-256 certificate fingerprint.**

🚨 **Using the upload key's fingerprint here is the single most common cause of a deep link opening in a browser instead of the app.** Both fingerprints are on the same Console page. Copy the one under *App signing key certificate*, not *Upload key certificate*.

File at `apps/web/public/.well-known/assetlinks.json` (this one **does** have a `.json` extension):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "<DEC-01>",
      "sha256_cert_fingerprints": ["<APP SIGNING key SHA-256 from Play Console>"]
    }
  }
]
```

Verification:

```bash
curl -sS https://play10q.com/.well-known/assetlinks.json | python3 -m json.tool

# Google's own verifier — this is what the device consults
curl -sS "https://digitalassetlinks.googleapis.com/v1/statements:list?\
source.web.site=https://play10q.com&\
relation=delegate_permission/common.handle_all_urls" | python3 -m json.tool
```

On device, `adb shell pm get-app-links <DEC-01>` should report `verified` for `play10q.com`.

### 3.5 The first production release has no safety valve

Three facts that compose badly and are worth internalising before launch day:

1. **Staged rollout is updates-only.** *"Staged rollouts can only be used for app updates, not when publishing an app for the first time."* Your first production release goes to 100% of targeted countries.
2. **You cannot halt a first release**, because there is no previous version to fall back to. (For *later* releases you can halt even a fully rolled-out version, and the previous version takes its place for new installs — but that is not available to you on day one.)
3. **Halting never downgrades anyone.** Users who already received a version keep it. The real fix for a bad build is always shipping a higher `versionCode`, not halting.

Practical consequence: the Android launch has no percentage gate, so **the internal and closed test tracks are the only real risk reduction you get.** Use them properly rather than treating them as a formality.

Also worth knowing before automation exists:

- **Outstanding releases block new ones:** *"You cannot create a new release when you have outstanding releases."* A stuck partial rollout or an undiscarded draft will block the next release on that track.
- **Managed publishing** decouples review completion from going live — approvals accumulate under "Changes ready to publish" and you press the button. It does **not** hold: increasing an existing staged rollout to 100%, release-notes edits, tester-list changes, unpublishing, or price changes. It also does not shorten review.
- **Review times:** internal track lands in minutes and *might* skip standard review (not a guarantee — a previously rejected submission forces review even on internal). Closed, open and production go through standard review, "up to seven days or longer in exceptional cases," and new accounts routinely see multi-day reviews.
- **Play Console runs automated pre-review checks** on every change, finishing within 15 minutes. Passing them does not mean passing formal review.

---

## Section 4 — Assets

### 4.1 The starting position is thinner than it looks

The repo has, in total:

| File | Size | Usable as an app icon source? |
|---|---|---|
| `apps/web/public/brand/10q-logo.png` | **683 × 355** | ❌ **No.** It is a wordmark, not a square, and it is below the 1024 px minimum |
| `apps/web/src/app/icon.png` | 32 × 32 | ❌ No |
| `apps/web/src/app/apple-touch-icon.png` | 180 × 180 | ❌ No |
| `apps/web/src/app/favicon.ico` | — | ❌ No |

🚧 **ASSET DECISION REQUIRED — there is no usable icon source in this repo.** `@capacitor/assets` needs a **square source of at least 1024 × 1024**, and splash sources of at least **2732 × 2732**. Upscaling a 683 × 355 wordmark produces a soft, letterboxed icon that will read as amateur next to every other game on the shelf, and Apple rejects icons with transparency or rounded corners baked in.

This is design work for a human. The agent's job is to say so and stop, not to improvise with ImageMagick. (`apps/web/scripts/make-logo-transparent.mjs` and `refine-logo-ink.mjs` exist for the web wordmark and are not a substitute.)

What is actually needed:

| Source file | Minimum size | Notes |
|---|---|---|
| `assets/icon-only.png` | 1024 × 1024 | Opaque, square, no rounded corners, no alpha |
| `assets/icon-foreground.png` | 1024 × 1024 | Android adaptive icon foreground; keep art inside the safe circle |
| `assets/icon-background.png` | 1024 × 1024 | Android adaptive icon background (often a flat brand colour) |
| `assets/splash.png` | 2732 × 2732 | Centre the mark; the edges get cropped on every aspect ratio |
| `assets/splash-dark.png` | 2732 × 2732 | 10Q's palette is dark-first; do not skip this |

### 4.2 Generating icons and splash screens

🤖 Agent, **after** `npx cap add ios` and `npx cap add android` — the tool writes directly into the native projects (`ios/App/App/Assets.xcassets`, `android/app/src/main/res/mipmap-*` and `res/drawable-*`), so those projects must already exist.

```bash
cd /Users/rocky/Code/10q-app/apps/mobile
npm i -D @capacitor/assets

npx @capacitor/assets generate \
  --iconBackgroundColor      '#<brand>' \
  --iconBackgroundColorDark  '#<brand-dark>' \
  --splashBackgroundColor    '#<brand>' \
  --splashBackgroundColorDark '#<brand-dark>'
```

Defaults you rarely need to override: `--iosProject ios/App`, `--androidProject android`, `--assetPath` (checks `assets/` then `resources/`).

**Commit the generated output.** Capacitor treats native projects as source assets, and the generated icon sets are not reproducible from `capacitor.config.ts`. Note that Capacitor's own generated `.gitignore` files already exclude the copied web bundle (`ios/App/App/App/public`, `android/app/src/main/assets/public`) — that is deliberate; CI must run the web build and `cap sync` before archiving.

**Android 12+ caveat:** the platform shows a smaller icon on a coloured background rather than a full-screen splash image. `@capacitor/assets` (latest 3.0.5, last release March 2024, still what the official docs point to) does not always get this right. Budget for manual touch-up in `android/app/src/main/res/values/styles.xml` and check it on a real Android 12+ device.

`npx cap sync` is not required to pick up generated icons — they land in the native projects, not `webDir`. Running it anyway is harmless.

### 4.3 Store screenshots

🤖 Agent captures, 👤 human approves and uploads.

**Do not use Playwright.** The existing Playwright config has exactly one project, Desktop Chrome, with no webkit and no mobile viewport (see [../02-current-state.md](../02-current-state.md)). Desktop Chrome screenshots at store dimensions will look wrong in ways reviewers notice. Capture from the real simulators/emulators running the real build:

```bash
# iOS — list what is actually installed, do not hardcode a device name
xcrun simctl list devices available
xcrun simctl boot "<device from the list>"
xcrun simctl io booted screenshot ~/Desktop/10q-ios-01.png

# Android
adb devices
adb exec-out screencap -p > ~/Desktop/10q-android-01.png
```

**Sizes: read them off the console at upload time.** Both stores reject wrong dimensions at upload, and both have changed their required set within the last two years. Current expectation, to be confirmed in the console rather than trusted from this file:

| Store | What to prepare |
|---|---|
| App Store | 6.9" iPhone display, portrait. Add 13" iPad **only if** the app record declares iPad support — if it does not, do not build iPad screenshots |
| Play | Phone screenshots (2–8), plus the **feature graphic at 1024 × 500** — required for every app, easy to forget until the console blocks you |

Suggested shot list, which doubles as a review narrative for the Guideline 4.2 / Play Minimum Functionality story — show the game, not the marketing:

1. A live question with the timer running
2. The results breakdown
3. The global leaderboard
4. A league scoreboard
5. The streak surface

**Ordering gotcha for Play automation later:** `fastlane supply` sorts screenshots by alphanumeric filename and *replaces* rather than appends. Zero-pad from the start (`01-`, `02-`) so the order does not scramble when you hit ten.

### 4.4 Ship hygiene before the first upload

🤖 Two routes currently exist in `apps/web/src/app` that should not be in a store binary:

- `/sentry-test` — a debug page whose route handler exists only to throw (`src/app/sentry-test/server/route.ts`).
- `/admin`, `/admin/quiz/new`, `/admin/tags` — the quiz-authoring surface. `create-quiz` is admin-gated server-side, so this is not a security hole, but shipping a visible admin console in a consumer binary invites questions under Apple's beta/demo rules and is dead weight in the bundle.

Decide explicitly whether the native build excludes them (a build-target exclusion in the `scripts/build-native.sh` work from [../05-migration-plan.md](../05-migration-plan.md) Phase 3) and record the decision.

---

## Section 5 — App Privacy (Apple) and Data Safety (Google)

Both declarations explicitly cover third-party SDK behaviour. Google is blunt about it: *"This includes user data transmitted off device from your app by libraries and/or SDKs used in your app, irrespective of whether data is transmitted to you or a third-party server."* Google also checks declarations against observed network behaviour, and inaccuracy is an enforcement matter — inaccurate Data Safety is one of the most common causes of post-launch suspension.

So: derive these from the code, not from a template.

### 5.1 What 10Q actually collects today

| Data | Collected? | Evidence in repo | Linked to identity | Purpose |
|---|---|---|---|---|
| **Email address** | ✅ **Yes** | `apps/web/src/components/AuthButton.tsx:54-56` passes `{ email: session.user.email }` into `posthog.identify()` | Yes | App functionality (auth) + Analytics |
| **User ID** | ✅ Yes | Supabase auth user id used as PostHog `distinct_id`, same call site | Yes | Analytics |
| **Product interaction** | ✅ Yes | 16 typed events, all through one helper at `apps/web/src/lib/analytics.ts:14-21` | Yes when signed in; anonymous sessions get no person profile | Analytics |
| **Other usage data** | ✅ Yes | `autocapture` is **ON** (never overridden in `apps/web/src/lib/posthog.ts:17-20`) — ships `$autocapture` DOM events including element text and `$current_url` | Same | Analytics |
| **Gameplay stats as person properties** | ✅ Yes | `last_quiz_score`, `last_quiz_at`, `current_streak`, `longest_streak` (`play/finalize/page.tsx:91`), `last_correct_count`, `last_total_time_ms` (`results/page.tsx:202`) | Yes | Analytics |
| **Crash data / diagnostics** | ✅ Yes | Sentry, `apps/web/instrumentation-client.ts`. `enableLogs: true`, wired to `apps/web/src/lib/logger.ts` | **No** — there is no `Sentry.setUser()` call anywhere in the repo | App functionality |
| **IP address** | ✅ Yes (implicitly) | Both SDKs receive it at ingest. PostHog performs GeoIP enrichment server-side | Depends on project settings | Analytics / security |
| **Coarse location** | ⚠️ **Verify** | Derived from IP by PostHog's GeoIP enrichment, if enabled on the project | — | Analytics |
| **Payment / financial / contacts / photos / precise location / health** | ❌ No | No such surface exists | — | — |

⚠️ **Three things to fix or confirm before answering the forms:**

1. **URLs carry identifiers.** `$current_url` and autocapture ship the full path. 10Q's routes include `/u/[handle]`, `/invite/[code]` and `/leagues/[id]`. Those values land in PostHog. Declare it, or strip it.
2. **`sendDefaultPii` is not set** in any Sentry init — it defaults to off, so Sentry should not be attaching headers, cookies or user IP. **Verify against a real event in the Sentry UI** before declaring it, rather than trusting the default.
3. **Session recording is not disabled in code**, so whether it records is decided by PostHog *remote config*. A remote-config flip would silently invalidate your declaration. **Set it explicitly** before the first submission. Same for `autocapture` in the native build — see the checklist in [../OBSERVABILITY.md](../OBSERVABILITY.md).

### 5.2 Apple App Privacy (APL-11)

App Store Connect → App Privacy. Map the table above onto Apple's categories:

| Apple category | Answer | Linked | Used for tracking |
|---|---|---|---|
| Contact Info → Email Address | Collected | Yes | **No** |
| Identifiers → User ID | Collected | Yes | **No** |
| Identifiers → Device ID | Collected (PostHog anonymous distinct id) | Yes when signed in | **No** |
| Usage Data → Product Interaction | Collected | Yes | **No** |
| Usage Data → Other Usage Data | Collected (autocapture) | Yes | **No** |
| Diagnostics → Crash Data / Performance Data | Collected | No | **No** |
| Location → Coarse Location | ⚠️ verify GeoIP | — | **No** |

Every row's "used for tracking" answer is **No** — see [§7](#section-7--att-app-tracking-transparency).

### 5.3 Google Data Safety (GPL-08)

Same underlying facts, different form. Points specific to Google:

- **The form is mandatory even at zero collection**, and a privacy policy URL is required unconditionally.
- Declare **encryption in transit** (true — everything is HTTPS to Supabase and to the SDK endpoints).
- Declare the **data-deletion mechanism**. The DEC-08 URL goes into the *Data deletion* questions **inside the Data safety form** — this is why a stale or 404 deletion URL surfaces as a confusing "Invalid account / data deletion link on your Data safety form" rejection rather than as a deletion problem.
- Purposes to select from: app functionality, analytics, developer communications, advertising/marketing, fraud prevention & security, personalization, account management. 10Q uses **app functionality** and **analytics** only.
- Mark each data type required vs optional.
- Partial retention is allowed for security/fraud/regulatory reasons, but you *must* describe retention in the privacy policy (DEC-07) if you do it — relevant to whatever DEC-13 decides about owned leagues.

The declaration can be automated later via the `applications.dataSafety` API (it accepts a CSV matching Google's Data safety spec). **Do the first one in the Console** — you need the downloadable template anyway, and the API path is not worth debugging during a launch.

---

## Section 6 — Reviewer notes and demo access

10Q is **anonymous-first**: every visitor gets an anonymous Supabase session before any sign-in prompt. That is unusual enough that a reviewer may report "I could not create an account" and reject on that basis. Say it explicitly.

Google separately requires, for anything behind a login, that you *"provide active demo accounts and sign-in details"* plus whatever resources reviewers need. 10Q's core loop needs no account, but the league and profile surfaces do — supply an account anyway.

### 6.1 The 11:30 UTC problem — DEC-12

**The daily quiz drops at 11:30 UTC. Before that, the app shows a countdown.** A reviewer in Cupertino opening the app at 09:00 PT sees no game at all.

This is the highest-probability rejection cause in the whole submission, and it needs a decision, not a sentence in the notes:

| Option | Cost | Notes |
|---|---|---|
| Point review builds at a staging environment with an always-available quiz | Needs staging, which **does not exist** — no separate Cloudflare, Supabase, Sentry or PostHog environment ([../02-current-state.md](../02-current-state.md)). This is Phase 2 work | Cleanest, most expensive |
| Ensure a quiz is scheduled and published across the whole review window | Operational care; review can take days | Cheap, fragile |
| Make the countdown screen offer a playable sample quiz | Product change; also improves first-run for real users | Best long-term, real work |
| Explain it in the notes and hope | Free | **Not sufficient on its own** |

Pick one deliberately. Whatever you pick, the notes still explain the drop.

### 6.2 Draft reviewer notes

🤖 Agent drafts, 👤 human pastes into App Store Connect → App Review Information → Notes, and the equivalent Play Console field. Fill the bracketed values from the decision record.

```
HOW TO PLAY WITHOUT AN ACCOUNT
10Q is anonymous-first. Open the app and tap PLAY — no sign-up, no email, no
account creation is required to play the full daily quiz, see your score, or
view the global leaderboard. If you are looking for a registration screen,
there isn't one by design.

DAILY QUIZ TIMING — PLEASE READ
A new 10-question quiz is released every day at 11:30 UTC. Before that time the
app shows a countdown instead of a quiz. If you open the app before 11:30 UTC
you will not see gameplay. [DEC-12 ANSWER: e.g. "This build points at a review
environment where a quiz is always available" / "A quiz is scheduled for every
day of the review window".]

ONE ATTEMPT PER DAY
Each player gets one attempt per day, and each question is on a 12-second
server-authoritative timer. Once a question's timer expires it cannot be
retried. This is the core game design, not a defect.

REACHING THE SOCIAL / LEAGUE SURFACES (account required)
Sign in with Apple, or use the demo account below, then:
  Leagues     — bottom navigation → LEAGUES
  Create      — LEAGUES → CREATE LEAGUE
  Join        — LEAGUES → JOIN, enter invite code [DEMO_INVITE_CODE]
  Profile     — bottom navigation → PROFILE
Signing in preserves anonymous progress — the anonymous account is upgraded in
place rather than replaced.

DEMO ACCOUNT
  Email:    [DEMO_EMAIL]
  Password: [DEMO_PASSWORD]
  This account is a member of a demo league with existing scores so the league
  scoreboard is populated.

ACCOUNT DELETION
  PROFILE → SETTINGS → DELETE ACCOUNT. Deletion is immediate and removes the
  account and its associated data.
  Users who have uninstalled can also request deletion at [DEC-08].

REPORTING AND BLOCKING
  User-generated content in 10Q is limited to player handles and league names.
  Report a handle:      profile view → ⋯ → REPORT
  Report a league name: league view → ⋯ → REPORT
  Block a player:       profile view → ⋯ → BLOCK
  Leave a league:       league view → LEAVE LEAGUE
  Contact:              [DEC-05]

DEEP LINKS
  Invite links have the form https://play10q.com/invite/<code> and open the app
  directly via Universal Links / App Links.
```

⚠️ Every claim in those last two blocks must be **true at submission time**. They describe GATE-01 and GATE-02. Do not paste aspirational notes — a reviewer who follows a described path that does not exist rejects harder than one who was never told about it.

---

## Section 7 — ATT (App Tracking Transparency)

The accurate read, because the folk wisdom here is wrong in both directions.

**What ATT actually requires.** Apple requires the ATT prompt when data is used to **track** a person — meaning linking user or device data collected in your app with data collected from **other companies'** apps, websites or offline properties for **targeted advertising or advertising measurement**, or when data is **shared with a data broker**.

**What does not trigger it.** First-party product analytics that stay inside your own product and are not used for cross-company advertising or measurement, and are not sold or shared onward. The presence of an analytics SDK is not itself the trigger — what the data is *used for* is.

**What 10Q does today:**

| Fact | Evidence |
|---|---|
| PostHog is first-party product analytics | `apps/web/src/lib/posthog.ts:17-20`, 16 typed events in `apps/web/src/lib/analytics.ts` |
| `autocapture` is ON | Never overridden — broadens *what* is collected, not *who it is shared with* |
| **No advertising SDK** of any kind | `apps/web/package.json` — no ad network, no AdMob, no ad mediation |
| **No attribution / MMP SDK** | No AppsFlyer, Adjust, Branch, Kochava, Singular |
| **No data-broker sharing** | No such integration exists |
| **No third-party ad identifier** | No IDFA access, no `AppTrackingTransparency` framework linked |

**Therefore, today:**

- 🚫 **Do not present an ATT prompt.**
- 🚫 **Do not add `NSUserTrackingUsageDescription` to `Info.plist`** and do not link `AppTrackingTransparency`. Shipping the key without a corresponding prompt, or prompting when you do not track, is itself a review problem.
- ✅ Answer **"No"** to *"used for tracking"* on every row of the App Privacy questionnaire ([§5.2](#52-apple-app-privacy-apl-11)).
- ✅ On Google's Data Safety form, select **analytics** and **app functionality** as purposes, and **not** advertising/marketing.

**Re-check the moment any of these becomes true** — this answer is a fact about the current build, not a permanent property of the app:

- Any advertising SDK or ad network is added.
- Any attribution / MMP / deep-link-attribution SDK is added (Branch and similar link-attribution products count).
- Analytics data starts being shared with, or joined against, another company's data.
- A partnership causes user data to reach a data broker.
- Any third-party device advertising identifier is read.

Put the recheck in the release preflight rather than relying on someone remembering. This mirrors the position recorded in [../STORE_READINESS.md](../STORE_READINESS.md) and [../OBSERVABILITY.md](../OBSERVABILITY.md); if you change the answer, change it in all three.

---

## Section 8 — Sequencing

### 8.1 What is serial, what is parallel

**Three chains run in parallel and only converge at submission:**

```
CHAIN A — ACCOUNTS (start day 1, blocks nothing in the repo)
  APL-01 enrollment ──► APL-02 agreements ──► APL-04 App ID ──► APL-05 app record
  GPL-01 account ─────► GPL-02 verification ─────────────────► GPL-03 app record

CHAIN B — PRODUCT CODE (the actual engineering)
  Phases 0–8 of ../05-migration-plan.md
  GATE-01..05 land inside Phase 8

CHAIN C — ASSETS & CONTENT (needs a designer and a writer, not an engineer)
  1024² icon source ──► @capacitor/assets ──► screenshots (needs a running build)
  privacy policy ──► deletion page ──► support page ──► listing copy
```

**Then the serial tails, which is where schedules actually break:**

```
iOS:      signed build ──► TestFlight internal (no review, minutes)
                       ──► [optional] external ──► TestFlight App Review
                       ──► attach to version ──► Add for Review ──► Submit
                       ──► review (~90% <24h) ──► release (100%, no phasing)

Android:  signed AAB ──► GPL-06 FIRST MANUAL UPLOAD
                     ──► app signing key exists ──► GPL-07 assetlinks.json ✱
                     ──► internal track (minutes)
                     ──► closed track (review: up to 7 days)
                     ──► GPL-15  12 testers × 14 CONSECUTIVE DAYS ✱✱
                     ──► GPL-16 apply for production (review ≤7 days)
                     ──► production at 100%, no staged rollout, no halt
```

✱ **`assetlinks.json` cannot be written before the first upload.** The fingerprint does not exist yet. Every Android deep-link plan that assumes otherwise slips.

✱✱ **The 12×14 gate only applies if DEC-04 is a personal account.** It is the difference between a 1-week and a 4-week Android tail.

### 8.2 Realistic timeline

Expressed relative to a target public launch, **T**. Assumes DEC-04 = personal account (the pessimistic case); subtract about three weeks if it is an organization account.

| When | Track | Items | Notes |
|---|---|---|---|
| **T-8 wk** | Decisions | DEC-01 … DEC-13 | Blocks literally everything. Half a day of conversation |
| **T-8 wk** | Accounts | APL-01, GPL-01 | **Start immediately.** Enrollment and identity verification have real lead time and block nothing in the repo |
| **T-8 wk** | Assets | Commission the 1024² icon and splash sources | Longest lead item on Chain C; it is human design work |
| **T-7 wk** | Accounts | APL-02, APL-03, APL-04, APL-05, GPL-02, GPL-03 | Once enrollment clears |
| **T-7 wk** | Content | Privacy policy, deletion page, support page drafted | Needs DEC-05/07/08 |
| **T-7 → T-4 wk** | Code | GATE-01 … GATE-05 (Phase 8), plus Phases 3–6 | The bulk of the engineering |
| **T-5 wk** | Repo | Capacitor project, `@capacitor/assets`, AASA file, entitlements | Needs DEC-01 and DEC-03a |
| **T-4 wk** | iOS | APL-07/08 first archive; APL-16/17 TestFlight internal | First real device install |
| **T-4 wk** | Android | GPL-04 keystore, **GPL-06 first manual upload** | Unblocks everything Android |
| **T-4 wk** | Android | GPL-07 `assetlinks.json` with the app signing fingerprint | Serial after GPL-06 |
| **T-4 wk** | Android | GPL-14 internal track, then push to the closed track | Closed track goes through review — allow up to 7 days |
| **T-3.5 wk** | Android | 🚨 **Recruit and opt in 12 closed testers** | The 14-day clock starts **only when they are actually opted in**. Nothing else advances it |
| **T-3 wk** | Both | Screenshots + feature graphic from real builds | Needs installable builds |
| **T-3 wk** | Both | APL-11/12, GPL-08/09/10 declarations | Needs the final SDK behaviour decided (§5) |
| **T-2 wk** | Android | 14-day clock completes → GPL-16 apply for production | Human review, ≤7 days typical |
| **T-1.5 wk** | iOS | APL-15 reviewer notes + demo account; APL-19 submit | ~90% reviewed in <24h |
| **T-1 wk** | Android | Production access granted; GPL-18 prepared | Held via managed publishing if you want a coordinated date |
| **T** | Launch | Release iOS; publish Android production | 🚨 **Three independent channels. They do not have to go live together, and probably should not** |

### 8.3 The four things that actually break this schedule

1. **DEC-04 not decided early.** A personal Play account adds ~3 weeks of pure waiting that no amount of engineering effort compresses.
2. **Nobody starts recruiting testers.** Twelve humans who install and *stay opted in* for 14 consecutive days is a social problem, not a technical one, and it always takes longer than expected. If one drops out on day 10, that tester's clock restarts.
3. **`assetlinks.json` planned as a "day-before" task.** It is serial after the first Play upload and after Play App Signing enrollment, and the fingerprint trap eats an afternoon the first time.
4. **Icon source assumed to exist.** It does not. See [§4.1](#41-the-starting-position-is-thinner-than-it-looks).

### 8.4 Launch does not mean "all three at once"

The architectural rule from [../01-architecture-decision.md](../01-architecture-decision.md) and `.claude/skills/release/SKILL.md` applies from the very first release: **one codebase does not mean one deployment channel.** Web, iOS and Android are three independently controllable channels. Clients and backend must tolerate version skew from day one — the store binary you ship at T is still installed and talking to your backend in six months.

Suggested first-launch order, giving each channel its own blast radius:

1. **Web** — already continuously deployed; the reference implementation.
2. **iOS** — smaller install base initially, fast review, fast forward-fix.
3. **Android** — last, because the first production release has no staged rollout and no halt.

---

## Section 9 — What only a human can do

Consolidated handoff list. When the agent reaches one of these, it should **stop, state exactly what it needs, and wait**.

| Item | Why an agent cannot | What the agent needs back |
|---|---|---|
| Apple Developer Program enrollment (APL-01) | Payment, legal identity, 2FA | **Team ID** → DEC-03a |
| Accepting agreements (APL-02) | Legal acceptance by an authorised person | Confirmation that no banner remains |
| EU DSA trader status (APL-03) | Legal declaration with published contact details | Confirmation of verification |
| App ID registration (APL-04) | Authenticated developer portal session | Confirmation that Associated Domains + Sign In with Apple are enabled |
| App Store Connect record (APL-05) | Authenticated session; the name is claimed globally | The exact name that was accepted |
| App Store Connect API key (APL-06) | `.p8` downloadable exactly once | **Key ID + Issuer ID + file path**, out of band. Never the file contents |
| Signing certificates (APL-08) | Keychain access, private key custody | "Signing resolves cleanly" / the exact error text |
| Play Console account (GPL-01/02) | $25 payment, government ID, possibly D-U-N-S | Confirmation of verification |
| Play app record (GPL-03) | Authenticated session | The registered package name matches DEC-01 |
| **Keystore generation (GPL-04)** | A secret that must not enter an agent's context | The **upload key SHA-256** only. Never the file, never a password |
| First AAB upload (GPL-06) | The API cannot do the first upload or fill legal consents | The **app signing key SHA-256** → GPL-07 |
| Play service account (GPL-17) | Google Cloud + Play Console permissions | File path out of band; confirmation of the granted permissions |
| Recruiting 12 testers (GPL-15) | Real humans | Opt-in date per tester, so the 14-day clock is trackable |
| **Any submit / publish / release button** | Public impact, irreversible | Explicit confirmation naming platform and version, per safety rule 1 |

---

## Section 10 — Deliberately out of scope for V1

**Capacitor OTA / live updates (Appflow and equivalents).** Not in V1. V1 is: web → normal Cloudflare deploy, iOS → TestFlight/App Store, Android → Play tracks. Every JS change ships through a store review.

Recorded here only so nobody re-derives it under launch pressure, and because the commonly-cited justification for OTA is now **stale**:

- **Guideline 2.5.2** prohibits downloading code that *"introduces or changes features or functionality of the app."* The operative test is *changes features*, not *is JavaScript*. Refining what a reviewer already approved is not what it targets; shipping a new screen through the OTA channel is.
- Nearly every OTA article cites Apple Developer Program License Agreement §3.3.2 and its carve-out for code run by "Apple's built-in WebKit framework or JavascriptCore." **That clause is gone.** In the current agreement it is renumbered §3.3.1(B) and the WebKit/JavascriptCore language has been removed entirely — the permission is now framework-agnostic and conditional: interpreted code may be downloaded only if it (a) does not change the app's primary purpose or add functionality inconsistent with what was submitted and advertised, (b) does not bypass signing, sandbox or OS security, and (c) does not create a store or storefront for other apps. Conjunctive, and (a) is judged against the app as submitted.
- **Guideline 4.2.3(ii)** is the second constraint people miss: if the app downloads resources to function on first launch, you must disclose the download size and prompt first.

Costs if it is ever adopted: a hosting/service bill, a second distribution channel to reason about during incidents, a bundle-versus-binary version skew problem *on top of* the existing store skew, and a standing judgement call on every change about whether it "adds functionality." **Revisit only with a specific problem that store review demonstrably cannot solve** — and note that the store-review turnaround Apple reports (~90% under 24 hours) is a large part of why the problem is smaller than it used to be.

---

## Section 11 — Done means

The first store release is complete when all of these are true. After that, **this document is finished forever** and [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) takes over.

**Decisions**
- [ ] DEC-01 … DEC-13 answered and committed in the decision record

**Gates (code)**
- [ ] GATE-01 account deletion, in-app, working
- [ ] GATE-02 all four Apple 1.2 mechanisms present
- [ ] GATE-03 `delete-attempt` exploit closed
- [ ] GATE-04 `publish-quiz` authenticated or deleted
- [ ] GATE-05 privacy policy live and accurate about PostHog and Sentry

**Apple**
- [ ] Membership active; agreements accepted; EU trader status verified
- [ ] App record exists; App Privacy and age rating answered
- [ ] AASA served from both hostnames with `application/json`, visible on Apple's CDN
- [ ] TestFlight internal build installs on a real iPhone and passes the smoke suite
- [ ] Reviewer notes accurate; demo account works
- [ ] Version approved and released

**Google**
- [ ] Account verified; app record created; package name registered
- [ ] Upload keystore generated and in custody; `.gitignore` updated
- [ ] Play App Signing enrolled; first AAB uploaded
- [ ] `assetlinks.json` verifies against the **app signing** key
- [ ] Data Safety and content rating complete; deletion URL live and reachable
- [ ] `targetSdk` 36
- [ ] Closed test satisfied (12 × 14 days, if applicable); production access granted
- [ ] Production release live

**Cross-cutting**
- [ ] Sentry receives a **symbolicated** error from both the iOS and Android builds
- [ ] PostHog receives events carrying the correct `client_platform` — see [../OBSERVABILITY.md](../OBSERVABILITY.md)
- [ ] The five identifiers (`release_sha`, `client_platform`, `app_version`, `app_build`, `environment`) are present in both tools for all three channels
- [ ] Signing material is documented by location, and none of it is in the repo:
      `git log --all --diff-filter=A --name-only | grep -E '\.(jks|keystore|p8|p12|mobileprovision)$'` returns nothing
