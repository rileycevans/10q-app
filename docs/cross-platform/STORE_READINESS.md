# Store Readiness

Where 10Q stands against Apple App Store Review Guidelines and Google Play policy, as of the [audit](02-current-state.md).

This doc is the **requirements register**: what each store requires, our current status, and where the work lives. The one-time setup runbook — accounts, signing, certificates, listings — is [release/FIRST_STORE_RELEASE.md](release/FIRST_STORE_RELEASE.md).

**Legend:** 🔴 blocker, not started · 🟠 blocker, partial · 🟢 satisfied · ⚪ N/A today

---

## Hard blockers

| Requirement | Status | Where |
|---|---|---|
| **Account deletion** — Apple 5.1.1(v): available from inside the app. Google: in-app path **plus** a web-accessible deletion request URL | 🔴 **Zero delete-account path exists.** No Edge Function, no UI. `/settings` has one feature (handle customization) and no danger zone | [03-blocking-fixes.md B1](03-blocking-fixes.md) · Phase 8 |
| **UGC moderation** — Apple 1.2: filter, report, block, published contact | 🔴 **Zero of four.** UGC surface is handles + league names | [03-blocking-fixes.md B2](03-blocking-fixes.md) · Phase 8 |
| **Privacy policy** — both stores, publicly reachable | 🔴 Does not exist | Phase 8 |
| **App Privacy answers** (Apple) / **Data Safety** (Google) — both explicitly cover third-party SDK behavior | 🔴 Not prepared. Driven by what PostHog and Sentry actually collect | [OBSERVABILITY.md](OBSERVABILITY.md) · Phase 8 |
| **Leaderboard integrity** — not a store rule, but a store binary makes the exploit trivially discoverable | 🔴 `delete-attempt` lets any user wipe and replay with the answer key in hand, for a perfect 100 daily | [03-blocking-fixes.md A1](03-blocking-fixes.md) · Phase 1 |

**None of these are Capacitor-specific.** Every one would be required for an Expo build too.

---

## Satisfied or not applicable

| Requirement | Status | Note |
|---|---|---|
| **Sign in with Apple** — Apple 4.8 | 🟢 Implemented alongside Google | Remaining work is presentational: reviewers expect the native `AuthenticationServices` sheet, not a web redirect. Needs `signInWithIdToken`, currently unused |
| **In-app purchase** — Apple 3.1.1 | ⚪ No monetization surface of any kind exists | Revisit if a paid tier lands — web checkout in a WebView is exactly what Apple rejects |
| **ATT** — App Tracking Transparency | ⚪ Not triggered today | ATT applies when data tracks a person across *other companies'* apps/sites for advertising or measurement, or is shared with a data broker. 10Q runs first-party product analytics, no ad SDK, no attribution SDK, no broker sharing. **Re-check the moment any of those change** |
| **Age rating** | 🟠 Not submitted, but straightforward | UGC presence affects the answers — do not fill this in before Phase 8 |
| **Encryption / export compliance** | 🟠 Standard HTTPS only | Routine declaration |

---

## Guideline 4.2 — minimum functionality

**Assessment: manageable risk, not existential.** Treat it that way in planning.

The guideline asks for features, content and UI that elevate an app beyond a repackaged website — but the same guideline explicitly credits "lasting entertainment value" and adequate utility. A legitimate daily game has a far stronger story than a marketing-site wrapper.

The framing that matters: **we are shipping the native distribution of an actual daily game, and the native build uses the device where that improves the game.** Not "we added APIs to convince Apple this isn't a website."

What genuinely earns its place, all on product merit:

| Feature | Why it belongs | Phase |
|---|---|---|
| Daily-drop push at 11:30 UTC | A daily game lives on the nudge. Reliable iOS delivery needs APNs, which needs a real binary | 7 |
| Streak-at-risk push | The single highest-value retention feature; impossible to deliver well on web | 7 |
| Haptics on answer lock-in | One of the two most native-feeling moments in the game | 6 |
| Native share sheet | The share flow currently just says "COPIED!" | 6 |
| Offline availability of today's questions | `start-attempt` already returns all ten in one payload | 6 |
| Deep links / Universal Links | The invite loop is the growth surface | 6 |

**Do not bolt on features purely for review.** No individual API "solves" 4.2, Apple publishes no threshold, and the total experience is what is assessed.

---

## Google Play — do not assume it is a free pass

Play's **Spam and Minimum Functionality** policy has its own rule against apps that merely provide a web view of a website. Google does officially support Trusted Web Activities, so web technology is not disqualifying — but plan for a real mobile experience on both platforms.

The practical consequence is that the Phase 5 UX pass is not optional polish. An app that fails to handle the Android hardware back button — which today [traps the user inside the quiz](02-current-state.md) — reads as exactly the kind of thin wrapper both policies target.

Play-specific items beyond the shared list: the Data Safety declaration, the content rating questionnaire, target API level compliance, and the **separately required web page for deletion requests** (distinct from the in-app path).

---

## Privacy exposure worth fixing before review

Not store blockers on their own, but they are the kind of thing that surfaces badly in a privacy review and they are cheap to fix:

- **`get-profile-by-handle` requires no auth** and returns a full behavioural profile — streaks, all-time best/worst, accuracy, last 10 results, per-category performance — for any handle.
- **`players` is world-readable in full**, including `linked_auth_user_id`, which correlates player rows to auth identities. Combined with the above, every handle can be enumerated and profiled.
- **Auto-generated handles leak identity**: `Player${userId.slice(0,8)}` puts the first 8 hex chars of the auth UUID on the public leaderboard. `generateXboxStyleHandle` already exists with zero callers — wire it up.
- **`get-league-by-invite` is unauthenticated**, so any 6-character code is enumerable and returns the league name and creator handle.

See [03-blocking-fixes.md A4, A7](03-blocking-fixes.md).

---

## Reviewer notes — plan for this early

10Q is **anonymous-first**: every visitor gets an anonymous session before any sign-in prompt. That is unusual enough that reviewer notes should state it explicitly, or a reviewer may report they could not create an account.

The notes need to cover:
- Play the daily quiz with no account — just open the app.
- The daily quiz drops at **11:30 UTC**. If a reviewer opens the app before that, they see a countdown, not a quiz. **This is a real rejection risk** — say so in the notes and consider whether review builds should point at a staging environment with a quiz always available.
- How to reach leagues and the invite flow, which need a signed-in account.
- Where account deletion lives (once Phase 8 lands).
- How to reach the report and block controls.

---

## Pre-submission checklist

Everything below must be true before the first submission to either store.

**Code complete**
- [ ] Account deletion, in-app and web request page
- [ ] Report, block, and content filtering on handles and league names
- [ ] `leave-league` exists; membership is consensual
- [ ] `delete-attempt` fixed or removed
- [ ] `publish-quiz` authenticated or removed
- [ ] Q1 timer clamp server-side
- [ ] `players` column grants narrowed
- [ ] Android hardware back handled per-route
- [ ] Safe-area and viewport correct on notched devices

**Content and legal**
- [ ] Privacy policy live on `play10q.com`
- [ ] Deletion request page live
- [ ] Support URL live
- [ ] App Privacy answers prepared from actual SDK behavior
- [ ] Data Safety declaration prepared
- [ ] Age rating questionnaire answered with UGC accounted for

**Assets** — the repo currently has only `apps/web/public/brand/10q-logo.png` plus App Router `favicon.ico` / `icon.png` / `apple-touch-icon.png`
- [ ] Icon set and splash generated via `@capacitor/assets`
- [ ] Screenshots at every required device size
- [ ] Play feature graphic

**Verification**
- [ ] TestFlight build installs and passes the smoke suite on a real device
- [ ] Play internal-track build does the same
- [ ] Reviewer notes written, including the 11:30 UTC drop
- [ ] Sentry receives a symbolicated error from each platform build
- [ ] PostHog receives events tagged with the correct `client_platform`
