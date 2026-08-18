# Migration Status

The live checkpoint for the Web/iOS/Android migration. **This is not a diary.** Keep it
short enough that it stays true. Update it in the same PR as the work it describes.

Read this immediately after invoking the
[cross-platform migration skill](../../.agent/skills/cross-platform-migration/SKILL.md).
Verify it against `.agent/skills/cross-platform-migration/check-docs` — **if the observed
implementation state contradicts this file, the observation wins and this file is wrong.**

**Last updated:** 2026-08-18

---

**Current phase: Phase 0 — Preconditions (0A–0E)** (not started)

Planning and documentation are complete. No migration code has landed. `check-docs`
reports the static export, Capacitor, both native projects, the platform seam and the
release scripts as absent — consistent with a migration that has not begun.

## Completed

- Pre-migration repository audit — [02-current-state.md](02-current-state.md)
- Architecture decision — [ADR-001](01-architecture-decision.md)
- Blocking-fix inventory — [03-blocking-fixes.md](03-blocking-fixes.md)
- Shared code architecture and the platform seam — [04-shared-code-architecture.md](04-shared-code-architecture.md)
- Phased migration plan with exit gates — [05-migration-plan.md](05-migration-plan.md)
- Observability architecture — [OBSERVABILITY.md](OBSERVABILITY.md)
- Testing architecture — [TESTING.md](TESTING.md)
- Store readiness assessment — [STORE_READINESS.md](STORE_READINESS.md)
- Release documentation set — [release/](release/)
- Release operator skill and `scripts/release/` contract stubs
- Migration control skill — `.agent/skills/cross-platform-migration/`

## In progress

- Nothing. Phase 0 has not started.

## Blocked

- Nothing blocked. But see the external track below — it is the longest lead time in the
  program and it is not engineering work.

## Next gate

**The 0E gate** — no substantive migration implementation begins until 0A–0D all pass.
See [05-migration-plan.md](05-migration-plan.md#phase-0--preconditions).

| | Precondition | Kind |
|---|---|---|
| **0A** | Prove the packaged Capacitor routing model on real hardware | architectural go/no-go |
| **0B** | Fix server-side attempt integrity (`delete-attempt`, Q1 clock, run the RLS suite) | security |
| **0C** | Secure quiz publishing (`publish-quiz` is unauthenticated) | security |
| **0D** | Prove Capacitor-origin CORS from a device | architectural go/no-go |
| **0E** | Gate — native work may now begin | checkpoint |

**Do not create `ios/`, `android/`, or add any `@capacitor/*` dependency before 0E clears.**

0A and 0D are independent of 0B and 0C and can run concurrently. Phase 2 (foundations)
parallelizes with all of Phase 0.

### External track — start now, in parallel

Apple Developer enrollment, and especially **Google Play production-access eligibility**.
If the Play account is a personal account created after 2023-11-13, production requires a
closed test with **12 testers opted in for 14 consecutive days**, then a human-reviewed
written application. That is a multi-week calendar dependency with no engineering
shortcut. Decide the account type and start recruiting testers before Phase 0 finishes.

## Important discoveries

- **The HEAD probe is the real risk in Phase 0.** Under `output: 'export'`, Next fires
  `fetch(url, {method:'HEAD'})` before every route-cache fill. In Capacitor these go
  through the iOS `WKURLSchemeHandler` / Android `WebViewAssetLoader`, not an HTTP server.
  If HEAD does not return 2xx the router degrades to full document navigation, which
  unmounts `GameProvider` and destroys in-flight quiz state between questions.
  **`python3 -m http.server` cannot detect this** — it handles HEAD correctly.
- **A green build proved nothing once already.** During the audit, the export build was
  made green by deleting the four dynamic routes under test — a false positive that took
  a second pass to catch. Stub them; do not delete them.
- **Phase 2 is the most likely to be skipped and the most expensive to skip.** No version
  source of truth means no Sentry `dist`, so an old binary's crash cannot be symbolicated.
- **CORS fails in the worst possible shape.** `_shared/cors.ts` emits a single static
  origin. Under Capacitor, leagues and profiles would keep working while the entire game
  loop fails on every request. Proven in 0D, before anyone can waste a day blaming the
  client.
- **Security findings are preconditions, not cleanup.** `delete-attempt` lets an
  authenticated user read the answer key and replay for a perfect score; `publish-quiz`
  is unauthenticated. Neither is "Capacitor work", but shipping an IPA/APK makes hidden
  client behavior trivially inspectable — so they land in 0B/0C, not "after mobile ships".
- **Google Play account maturation can be a four-week gate.** Scheduling, not
  architecture — but it must run in parallel from day one.

## Known documentation gaps

- `scripts/release/*` are contract stubs that exit non-zero by design. They are not
  release machinery yet — that is Phase 9.
