# ADR-001 — Cross-Platform Client Architecture

**Status:** Accepted (pending precondition 0A, see below)
**Date:** 2026-08-18
**Decision:** Ship iOS and Android with **Capacitor**, wrapping a statically-exported build of the existing Next.js frontend. Keep one React codebase, one backend, three platform outputs.

---

## Context

10Q is a live daily-trivia web product at `play10q.com`. We want first-class iOS and Android apps. The question is whether to wrap the existing web frontend (Capacitor) or rewrite the client in React Native (Expo).

The economic framing is straightforward: rewriting a functioning product so the mobile client can be React Native is hard to justify when the core interaction is question / answer / timer / streak / leaderboard. That is a very favorable workload for a WebView-based architecture. The native surface we actually need is thin: notifications, haptics, share sheet, deep links.

But that argument only holds if the existing Next.js app can actually become the local web bundle Capacitor expects. Capacitor's production architecture copies compiled static assets into native projects and serves them from the device filesystem; pointing the WebView at a remote `server.url` is documented as a live-reload feature, **not** a production pattern. Next.js can produce static exports, but anything requiring a Node runtime cannot come along.

**So the load-bearing question was: does `apps/web` depend on the Next.js server?**

We audited it rather than assuming. The answer is in [02-current-state.md](02-current-state.md).

---

## The gate finding

**`apps/web` has essentially no server-rendering dependency.** Verified independently by four agents:

| Server dependency | Status |
|---|---|
| Server Actions (`"use server"`) | **Zero**, repo-wide |
| Server Components doing dynamic work | **Zero**. 22 of 23 `page.tsx`/`layout.tsx` are `"use client"`; the exception is `src/app/layout.tsx`, which is fully static |
| `next/headers` / `cookies()` | One file, `src/lib/supabase/server.ts` — **zero importers**, dead code |
| API route handlers | One, `src/app/sentry-test/server/route.ts` — a debug endpoint that only throws |
| SSR data fetching / ISR / `revalidate` | **Zero** |
| `generateMetadata` (dynamic) | **Zero** |
| Realtime / WebSockets | **Zero** — no `.channel()`, no table in the replication publication |
| `middleware.ts` | Exists, but only refreshes a Supabase session nothing server-side consumes, and sets `Cache-Control: no-store` |

All 22 backend operations already live in Supabase Edge Functions, reached over plain `fetch`. The trust boundary is server-side and transport-agnostic. The app is already a SPA wearing a Next.js coat.

**This is the single fact that decides the architecture.** Had it gone the other way — heavy Server Components, Server Actions, middleware-based auth — "wrap the existing app" would have been a much larger job than a rewrite, and this ADR would say Expo.

---

## Decision

Go **Capacitor**. Keep `apps/web` as the canonical frontend for all three platforms.

### Why not Expo / React Native

Not because Expo condemns us to two frontends forever — it does not. Expo Router can target web, iOS and Android from one codebase, and we could eventually retire the Next.js presentation layer entirely.

The reason is narrower and stronger: **today it would mean rewriting a working frontend and executing a migration, and the thing we would throw away is the most carefully-reasoned code in the repo.** That includes ~6,900 lines of view code, the entire design-token system, and the quiz state machine — `GameProvider.tsx` plus the optimistic-navigation and wall-clock-deadline logic in `play/q/[index]/page.tsx`, which encodes real hard-won behavior about latency and server-authoritative timing.

Revisit this decision if — and only if — **mobile UX outgrows what the Capacitor architecture can comfortably deliver.** Concrete triggers: sustained 60fps gesture-driven interaction, heavy native animation, camera/AR, real-time multiplayer with tight latency budgets, or WebView performance problems on low-end Android that survive optimization. "We wish we had written it in React Native" is not a trigger.

### Why not a PWA / Trusted Web Activity instead

Considered and rejected as the primary path. There is no PWA layer today at all — no manifest, no service worker, no icon set. So "just make it an installable PWA" is not a cheaper half-done alternative; it is comparable new work to the Capacitor shell, and it gives up reliable iOS push (which requires an installed PWA on iOS, with materially worse delivery) and the native share sheet and haptics that make the game feel good. Capacitor gets us the same web bundle plus a real APNs/FCM path.

---

## Honest scope correction

**This is not "wrap the existing site."** The correct framing is:

> **Port the routing layer and the auth entry/exit points, add a mobile app shell, then wrap.**

The web frontend is architecturally ready. Three specific layers are not:

1. **Routing.** Four dynamic routes have no `generateStaticParams`, and three of them (`/leagues/[id]`, `/u/[handle]`, `/invite/[code]`) take unbounded runtime values that cannot be enumerated at build time. Under `output: 'export'` these must become query-param routes. `/play/q/[index]` is bounded 1–10 and is enumerable.
2. **Auth.** The session lives in `document.cookie` via `@supabase/ssr`, which is not durable on Capacitor's custom-scheme origin. OAuth is a top-level browser redirect, which Google blocks in embedded WebViews. And the anonymous→named upgrade uses `linkIdentity`, which is redirect-only.
3. **App shell.** No `viewport-fit=cover`, no safe-area handling, `100vh` in 46 places, Android hardware back is unhandled and actively traps the user inside the quiz.

None of these is architectural. All are bounded, well-understood work. See [04-migration-plan.md](05-migration-plan.md) for sequencing.

---

## Precondition 0A — prove it before building anything native

**No substantive migration implementation begins until this passes.** It is precondition **0A** in
[05-migration-plan.md](05-migration-plan.md), and it sits behind the **0E gate** alongside three others —
two security preconditions (`delete-attempt`, `publish-quiz`) and one more architectural probe
(Capacitor-origin CORS). **Do not create `ios/`, `android/`, or add any `@capacitor/*` dependency until
0E clears.**

One prototype, no product changes, throwaway branch:

1. Set `output: 'export'`, `trailingSlash: true`, `images.unoptimized: true`.
2. Temporarily stub the four dynamic routes (do **not** delete them to make the build go green — a green build produced by deleting the routes under test proves nothing; this happened during our audit and produced a false positive).
3. Wrap the export in a bare Capacitor shell. Run on a real iOS device and an Android emulator.
4. **Measure the one thing nothing else can tell us:** under `output: 'export'`, Next's router issues a real `fetch(url, { method: 'HEAD' })` against every route before filling its route cache — on every `<Link>` prefetch and every `router.prefetch()`. In Capacitor those HEADs go through the iOS `WKURLSchemeHandler` / Android `WebViewAssetLoader`, not an HTTP server. If either fails to return 2xx for HEAD, `rejectRouteCacheEntry` fires and the router degrades to a full document navigation — which **unmounts `GameProvider` and destroys in-flight quiz state between `/play/q/N` and `/play/q/N+1`.**

   Confirm `/play/q/1/ → /play/q/2/` is a client transition with `GameProvider` intact and no white flash. A `python3 -m http.server` test cannot detect this, because it handles HEAD correctly.

**If 0A fails on the HEAD probe** and cannot be fixed with a Capacitor server plugin, the fallback is to hoist game state above the router (module scope + Capacitor Preferences) so an MPA navigation is survivable. That is a real cost and should be re-weighed against Expo before proceeding.

Also worth running as a cheap, high-information probe: add a `webkit` + Mobile Safari project to the existing Playwright config and point it at the current app. Capacitor's iOS runtime *is* WKWebView and its viewport *is* mobile — the two configurations with zero test coverage today. This converts the central assumption of the Capacitor case into a measurement.

---

## Consequences

### Accepted

- **Two build targets from one source tree.** Web deploys to Cloudflare Workers via OpenNext (SSR-capable); native builds `output: 'export'`. These differ in more than a flag — `trailingSlash` and `images.unoptimized` change rendered output, and `middleware.ts` / Sentry server configs are picked up by *file convention* and cannot be disabled from `next.config.ts`. This needs a real build script, not config conditionals. See [05-shared-code-architecture.md](04-shared-code-architecture.md).
- **Two auth storage backends** (cookies on web, Capacitor Preferences on native) behind one factory, and **two OAuth entry paths** (native plugin for cold sign-in, redirect flow for `linkIdentity`).
- **A version tail.** Store-reviewed binaries stay installed indefinitely against a continuously-deployed backend. We need a client version header and a minimum-supported-version gate. Today there is no readable app version anywhere.

### Rejected as false economies

- Sharing one `next.config.ts` with no divergence — `images.unoptimized: true` on the web build would disable the avatar optimizer that `remotePatterns` exists to serve.
- Treating `packages/contracts/openapi.yaml` as the contract for a second client. It documents 5 of 22 functions, every path is wrong, and the answer-submit field name is wrong (`selected_choice_id` vs `selected_answer_id`). A native client generated from it would 400 on every answer. The real contract is `apps/web/src/lib/api/edge-functions.ts`.

---

## App Store review posture

Two corrections to the conventional read.

**Guideline 4.2 (minimum functionality) is a manageable risk, not an existential one.** The rule asks for features, content and UI that elevate an app beyond a repackaged website — but the same guideline explicitly credits "lasting entertainment value" and adequate utility. A legitimate daily game has a far stronger 4.2 story than a marketing-site wrapper.

The right framing is **not** "we need push notifications to convince Apple this isn't a website." It is: *we are shipping the native distribution of an actual daily game, and the native version uses the device where that improves the game.* Daily-drop push, haptics on answer lock-in, the native share sheet, and offline availability of today's questions all qualify on their own merits. No individual API "solves" 4.2 and Apple publishes no threshold — the total experience is what matters. **Do not bolt on native features purely for review.**

**Google Play is not a free pass.** Play's Spam and Minimum Functionality policy has its own rule against apps that merely provide a web view of a website. Google does officially support Trusted Web Activities, so web technology is not disqualifying — but plan for a real mobile experience on both platforms, not "Android doesn't care."

The genuinely hard store requirements are not about wrapping at all. They are **account deletion** (Apple 5.1.1(v) — currently missing entirely) and **UGC moderation** (Apple 1.2 — currently zero of the four required mechanisms). See [07-store-readiness.md](STORE_READINESS.md).

---

## Related

- [02-current-state.md](02-current-state.md) — audit evidence
- [03-blocking-fixes.md](03-blocking-fixes.md) — what must be fixed before submission, independent of this decision
- [04-migration-plan.md](05-migration-plan.md) — phased execution
- [05-shared-code-architecture.md](04-shared-code-architecture.md) — how code stays shared
- [06-observability.md](OBSERVABILITY.md) — one PostHog project, one Sentry project, platform-dimensioned
- [07-store-readiness.md](STORE_READINESS.md) — Apple + Google compliance
