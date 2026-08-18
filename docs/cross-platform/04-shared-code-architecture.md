# Shared Code Architecture

**Goal:** maximize shared code across web, iOS and Android so the repo stays cheap to maintain — while keeping the places where platforms genuinely diverge explicit, small, and in one predictable location.

**The failure mode to avoid:** `if (isNative)` scattered through page components. That is how one codebase quietly becomes three.

---

## What is shared, and what is not

```
┌─────────────────────────────────────────────────────────────┐
│  packages/contracts        scoring · handles · constants     │  100% shared
├─────────────────────────────────────────────────────────────┤
│  apps/web/src/app          routes + screens                  │
│  apps/web/src/components   presentation                      │  100% shared
│  apps/web/src/domains      domain adapters                   │
│  apps/web/src/lib/api      Edge Function client              │
├─────────────────────────────────────────────────────────────┤
│  apps/web/src/platform     ◄── THE SEAM. Every native        │  interface shared
│                                divergence lives here.         │  impl per platform
├─────────────────────────────────────────────────────────────┤
│  ios/  ·  android/         Capacitor native projects         │  platform-specific
└─────────────────────────────────────────────────────────────┘
                              │
                    all three talk to the SAME
                    22 Supabase Edge Functions
```

The backend is already fully shared and transport-agnostic — no Server Actions, no Realtime, no Storage, no server components in the data path. Nothing about the backend needs to change for a second or third client, apart from the CORS fix in [03-blocking-fixes.md](03-blocking-fixes.md).

---

## The platform seam

Create `apps/web/src/platform/`. Every module exports a **capability interface**, with a web implementation and a native implementation selected once at module load.

```
src/platform/
  index.ts          ← selects impl, re-exports the interfaces
  types.ts          ← the interfaces. THE contract.
  storage.web.ts    storage.native.ts     durable key/value
  session.web.ts    session.native.ts     Supabase client + auth storage
  oauth.web.ts      oauth.native.ts       sign-in / linkIdentity entry + callback
  share.web.ts      share.native.ts       share sheet vs clipboard
  haptics.web.ts    haptics.native.ts     no-op on web
  lifecycle.web.ts  lifecycle.native.ts   background/foreground/online/offline
  navigation.web.ts navigation.native.ts  hardware back, deep links
  notifications.web.ts notifications.native.ts
  appInfo.web.ts    appInfo.native.ts     platform, version, build
```

**Selection happens once**, driven by the build target — not by runtime sniffing scattered through the app:

```ts
// src/platform/index.ts
const NATIVE = process.env.NEXT_PUBLIC_CLIENT_PLATFORM !== 'web';
export const storage = NATIVE
  ? require('./storage.native').default
  : require('./storage.web').default;
```

Use the build flag rather than `Capacitor.isNativePlatform()` so the web bundle never pulls `@capacitor/*` into its dependency graph.

**Rules:**
1. **No `@capacitor/*` import outside `src/platform/`.** Enforce with an ESLint `no-restricted-imports` rule so it fails CI rather than relying on discipline.
2. **No `if (isNative)` in `src/app/` or `src/components/`.** If a screen needs to branch, the branch belongs behind a capability.
3. **Every capability has a working web implementation**, even if it is a no-op (haptics) or a degraded fallback (clipboard instead of share sheet). Web is not a second-class target.
4. **The interface is the shared contract.** Changing it is a deliberate act touching both implementations.

---

## The capabilities that actually matter

### `storage` — the highest-stakes one

Web uses `localStorage`; native uses `@capacitor/preferences` (NSUserDefaults / SharedPreferences), which survives WebView cache eviction.

This is not cosmetic. Today the Supabase session lives in `document.cookie` via `@supabase/ssr`, and `ensureSession()` calls `signInAnonymously()` whenever no session is readable. On a custom-scheme origin where cookies are unreliable, **a storage read failure is indistinguishable from a first run and mints a brand-new anonymous user on every cold start** — silently orphaning the previous account's streak, history and leagues.

So `storage` must expose the distinction the current code cannot make:

```ts
type StorageResult<T> = { ok: true; value: T | null } | { ok: false; error: Error };
```

`ok: false` means *"could not read"*, which must **never** be treated as *"no session, create one."* Gate `signInAnonymously()` on a positive "storage is durable and empty" result.

Also migrate off `sessionStorage` here. `attempt_state` is the mid-quiz recovery key and `sessionStorage` does not survive a WebView process kill — which on mobile is the normal interruption, not an edge case. (`quiz_id` and `quiz_questions` are written and never read; delete them.)

### `session` — one Supabase client, two storage backends

Today: `createBrowserClient` from `@supabase/ssr`, cookie-backed, one instance imported everywhere.

Keep the single import. Change how it is constructed:

| | Web | Native |
|---|---|---|
| Client | `createBrowserClient` (`@supabase/ssr`) | `createClient` (`@supabase/supabase-js`) |
| Storage | cookies | `@capacitor/preferences` adapter |
| `detectSessionInUrl` | `true` (current default) | **`false`** — the deep-link handler owns the exchange |
| `flowType` | PKCE | PKCE |

`@supabase/supabase-js` is already a direct dependency. Because every consumer imports one `supabase` export, the blast radius is one module — but **validate on a real device across at least three cold starts and a reinstall**, because the failure mode is silent.

> Worth noting: `@supabase/ssr` is currently buying nothing. `src/lib/supabase/server.ts` has zero importers and there are no Server Actions. The honest option is to move **web** to `createClient` too and delete the ssr dependency, converging the platforms instead of branching them. Evaluate that during Gate 0 — it is cheaper than maintaining two client constructions.

### `oauth` — the one place two mechanisms are unavoidable

Native needs `skipBrowserRedirect: true`, `@capacitor/browser` (ASWebAuthenticationSession / Chrome Custom Tabs — Google returns `disallowed_useragent` inside an embedded WebView), a registered custom scheme, and an `appUrlOpen` listener.

**The callback logic must be extracted from the React page.** `src/app/auth/callback/page.tsx` does all its work in a `useEffect`, so on native — where the callback arrives as a deep-link event, not a navigation — it never mounts and `exchangeCodeForSession` never runs.

Extract to a framework-free function:

```ts
// src/lib/auth/handleCallback.ts  — shared, no React, no Next
export async function handleAuthCallback(url: URL): Promise<{ next: string }>
```

Called by the web page component **and** the native deep-link listener. This also fixes the `?next=` param being dropped on the link-failure recovery path (`callback/page.tsx:56`).

**Two OAuth mechanisms are required and this is not avoidable.** `linkIdentity` — which preserves the user id through the anonymous→named upgrade, and therefore all scores, leagues and streaks — is **redirect-only**. supabase-js has no `linkIdentityWithIdToken`. Native sign-in plugins return an `id_token` usable only with `signInWithIdToken`, which creates a *new* user.

| Path | Mechanism |
|---|---|
| Cold sign-in (no session) | Native plugin → `signInWithIdToken`. Satisfies Apple 4.8's expectation of the native sheet |
| Anonymous → named upgrade | `linkIdentity` via ASWebAuthenticationSession / Custom Tabs |

Since 10Q is anonymous-first, **the upgrade path is the main path**, not an edge case. Budget for both.

### `lifecycle` — currently missing entirely

Zero `visibilitychange`, `pagehide`, `freeze`, `online` or `offline` listeners exist anywhere. On mobile these are the normal case.

Web maps to DOM events; native to `@capacitor/app` `appStateChange` plus `@capacitor/network`. Consumers subscribe to one interface: `onForeground`, `onBackground`, `onOnline`, `onOffline`.

On foreground the app must re-reconcile the attempt with the server. The rAF countdown halts while backgrounded, so on resume it snaps to 0 and the server — long past 12s — records a 0-point timeout.

### `navigation` — Android hardware back

Web has no equivalent, so the web implementation is a no-op. Native registers an `@capacitor/app` `backButton` listener with per-route semantics: on `/` confirm-and-exit; on `/play/*` suppress or prompt; elsewhere hierarchical up-navigation.

**This depends on a shared-code fix, not just a native handler.** Every "back" affordance today is a forward `router.push('/')`, so history only grows, and the corrective redirect at `play/q/[index]/page.tsx:57-71` **pushes** rather than replaces — so a back press appends another entry and the user is bounced forward while the stack deepens. Convert the intra-quiz advances (`:292`, `:411`) and the corrective redirect (`:69`) to `router.replace`, collapsing ten questions into one history entry. That improves web too.

### `share`, `haptics`, `notifications`

The cheap, high-impact ones. `buildShareText()` already emits a Wordle-style emoji grid that is share-sheet-ready — `@capacitor/share` is ~10 lines against a button that currently just says "COPIED!". `@capacitor/haptics` on the correct/wrong branches of `AnswerButton.tsx:112-133` is ~5 lines.

Notifications need a web no-op (web push is out of scope for V1) and a native implementation. **The backend half is the larger part and is identical on either client path**: a device-token table, APNs/FCM credentials, and a sender. `public.outbox_events` already exists as an append-only domain-event table with no consumer — the natural trigger source.

**Blocked on a data fix:** streak-at-risk notifications, the highest-value native feature, cannot be built today. Streaks are computed only at finalize, so nothing expires them — the database cannot tell you a streak is dead. See [03-blocking-fixes.md](03-blocking-fixes.md) C7.

---

## Two builds from one source tree

Web deploys to Cloudflare Workers via OpenNext (SSR-capable). Native builds `output: 'export'`.

### Config divergence is real and cannot be avoided

| Setting | Web | Native | Why it cannot be shared |
|---|---|---|---|
| `output` | *(unset)* | `'export'` | `'export'` breaks the OpenNext deploy |
| `trailingSlash` | `false` | **`true`** | Export must emit `dir/index.html`; Capacitor's WebView will not append `.html`. But this re-canonicalizes every web URL |
| `images.unoptimized` | `false` | **`true`** | No `/_next/image` endpoint in a static bundle. Setting it on web would disable the avatar optimizer that `remotePatterns` exists to serve |

`images.unoptimized` is the dangerous one: **Next 16 does not error at build time.** The export silently emits `/_next/image?url=...` references that 404 in the WebView. Add a CI check that greps the export output for `/_next/image` and fails.

### Config flags are not sufficient

`middleware.ts`, `instrumentation.ts` and `sentry.server.config.ts` / `sentry.edge.config.ts` are picked up by **file convention**. `next.config.ts` cannot exclude them. The native build must physically move them aside.

So this needs a real build script, not conditionals:

```
scripts/build-native.sh
  1. move src/middleware.ts, src/instrumentation.ts, sentry.{server,edge}.config.ts aside
  2. BUILD_TARGET=native next build     (config keys off BUILD_TARGET)
  3. restore the moved files            (trap on EXIT so a failure cannot leave the tree dirty)
  4. npx cap sync
```

Two footguns: `next.config.ts:5` resolves the `@vercel/og` stub via `process.cwd()`, so the script must run with `cwd=apps/web`; and the webpack alias is `isServer`-gated while the turbopack alias is not, so the bundlers differ if anyone passes `--webpack`.

**CI must build both targets on every PR.** A change that passes the static export can still break the Cloudflare deploy, and vice versa.

### Routing must diverge — decide the URL shape deliberately

Under `output: 'export'`, `dynamicParams` is forced off and every dynamic segment needs `generateStaticParams`, which **cannot be exported from a `"use client"` module**. All four dynamic pages are client components.

| Route | Params | Plan |
|---|---|---|
| `/play/q/[index]` | 1–10, bounded | Split into server `page.tsx` (exports `generateStaticParams`) + `ClientPage.tsx`. **URL unchanged.** |
| `/leagues/[id]` | league UUID, unbounded | → `/leagues/detail?id=` |
| `/u/[handle]` | user handle, unbounded | → `/u?handle=` |
| `/invite/[code]` | invite code, unbounded | → `/invite?code=` |

`useParams()` → `useSearchParams()`, wrapped in `Suspense` (the pattern already exists at `results/page.tsx:133`).

**The decision this forces:** do the *web* URLs change too, or do web and native keep different route trees?

**Recommendation: change both, and keep permanent redirects on the web deploy.** One route tree is the whole point of this architecture, and two would erode the shared-code goal exactly where the shared-code goal is most valuable. The cost is bounded:

- `https://play10q.com/invite/<code>` links are already circulating. Add a Cloudflare redirect covering both slashed and unslashed forms and **keep it indefinitely** — this is the growth loop.
- `/u/[handle]` has **zero internal linkers** (grep confirms), so it is nearly free.
- `/leagues/[id]` has four internal call sites, all enumerated.
- A fifth caller is easy to miss: `buildOAuthRedirect()` serializes `window.location.pathname + search` into the OAuth `next` param (`src/lib/auth/oauth.ts:113-121`), and the callback reads it back. **That is the signed-out-user-opens-a-shared-invite flow** — the reason `/invite` exists. Verify the nested encoding survives the Supabase round-trip.

Also clamp before routing: `current_index` is server-authoritative and `11` is a real wire value. Today an out-of-range index self-corrects; under export it is an unrecoverable 404. Route to `/results` when `> 10` and `/play/q/1` when `< 1`.

### Share links must stop using `window.location.origin`

`leagues/[id]/page.tsx:52-53` builds invite links from the origin, which on native yields `capacitor://localhost/invite/CODE` — a URL that is meaningless to the friend who receives it, **silently breaking the growth loop**.

**Rule: `window.location.origin` is for same-document navigation only.** Any URL that leaves the app uses a build-time canonical base:

```ts
export const PUBLIC_ORIGIN = process.env.NEXT_PUBLIC_PUBLIC_URL ?? 'https://play10q.com';
```

Audit all five origin call sites: `leagues/[id]/page.tsx:52`, `lib/auth.ts:11`, `:96`, `lib/auth/oauth.ts:113`, `app/auth/callback/page.tsx:56`.

---

## Backend: shared by construction, with two obligations

All three clients hit the same 22 Edge Functions. Two things must change.

**1. CORS must accept three origins.** `_shared/cors.ts` emits a single static `Access-Control-Allow-Origin`. Capacitor sends `capacitor://localhost` (iOS) or `http://localhost` (Android). Make `corsHeaders` a function taking `req`, echo the Origin when it matches an allow-list, and add `Vary: Origin`. Twelve functions import the shared module and ten more hardcode `"*"` inline — consolidate them all. **Prototype this before the client port; without it the game loop fails while leagues keep working, which is the worst debugging shape.**

**2. The contract must tolerate version skew.** Store binaries stay installed indefinitely. Additive changes only; never remove or repurpose a field. See [release/RELEASE_ARCHITECTURE.md](release/RELEASE_ARCHITECTURE.md).

**Do not use `packages/contracts/openapi.yaml` as the contract.** It documents 5 of 22 functions, every path is wrong, and it names `selected_choice_id` where the server requires `selected_answer_id` — a native client generated from it would 400 on every answer. The real contract is `apps/web/src/lib/api/edge-functions.ts:275-666`. Delete or regenerate the YAML.

**Constants are forked** between `packages/contracts` and `supabase/functions/_shared` because Deno cannot import the Node workspace package. They agree today; nothing enforces it. Add a test that fails CI on drift — the native client makes this worse, not better.

---

## What stays in `apps/web`

Everything else. Screens, components, domain adapters, design tokens, the quiz state machine. That is the point.

The name `apps/web` becomes slightly misleading once it feeds three platforms. **Renaming it is not worth the churn** — it would touch every import path, both `package.json` workspaces, CI, and the OpenNext config, for zero functional gain. Note it in `CLAUDE.md` and move on.
