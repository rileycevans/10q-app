# scripts/release

Deterministic release machinery. The [release skill](../../.claude/skills/release/SKILL.md) is the operator, [docs/cross-platform/release/](../../docs/cross-platform/release/) is the source of truth, and these scripts are the hands.

> **STATUS: STUBS.** Every script here exits non-zero with the reason. They define the intended contract so the skill and docs can reference stable names, and so nothing mistakes an unimplemented step for a passing one. Implement them in Phase 9 of [the migration plan](../../docs/cross-platform/05-migration-plan.md).

| Script | Contract | Public impact |
|---|---|---|
| `preflight` | Verify the repo, gates and credentials are ready. Exits non-zero on any failure | none |
| `verify` | Report what version/build is live on each channel | none |
| `web` | Build, deploy and smoke-test the Cloudflare Worker | **yes** |
| `ios-build` | Native export → `cap sync ios` → archive → signed IPA + sourcemaps | none |
| `ios-submit` | Upload the IPA to TestFlight | none for the public |
| `android-build` | Native export → `cap sync android` → signed AAB + sourcemaps | none |
| `android-submit` | Upload the AAB to a Play testing track | none for the public |

**There is deliberately no `ios-release` or `android-release` script.** Publishing to production and advancing a staged rollout are explicit, human-confirmed operations performed through the store consoles or an explicitly-invoked API call. See rule 1 in the release skill.

## Conventions

- Exit 0 only on complete success. Any partial failure exits non-zero.
- Every script is idempotent where the underlying operation allows it, and says so where it is not.
- No script reads a secret from the repo. Credentials come from the environment or a path supplied at invocation.
- Every script prints what it is about to do before doing it, so its output is a usable audit trail.
