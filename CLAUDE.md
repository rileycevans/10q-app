# 10Q

Daily trivia game. Next.js web client in `apps/web`, shared contracts in
`packages/contracts`, Supabase backend in `supabase/`.

## Active cross-platform migration

10Q is currently undergoing a Web/iOS/Android architecture migration.

Before modifying code related to the client architecture, mobile platforms,
analytics, observability, testing, CI/CD, or releases, read and follow:

**[.agent/skills/cross-platform-migration/SKILL.md](.agent/skills/cross-platform-migration/SKILL.md)**

Start any resumed or compacted session with *"Use the cross-platform migration
skill and continue the migration."* The current checkpoint is
[docs/cross-platform/STATUS.md](docs/cross-platform/STATUS.md); the authoritative
plan is [docs/cross-platform/](docs/cross-platform/).

> This section is temporary. Remove it when the migration completion contract in
> the skill is satisfied and the skill is deleted.

## Working agreements

Repository skills live in [.agent/skills/](.agent/skills/) and encode the rules that
apply to this codebase — read the relevant one before working in its area:

| Skill | Applies to |
|---|---|
| [cross-platform-migration](.agent/skills/cross-platform-migration/SKILL.md) | **Temporary.** Web/iOS/Android migration control |
| [release](.agent/skills/release/SKILL.md) | Shipping to web, App Store, Play Store |
| [git-workflow-and-prs](.agent/skills/git-workflow-and-prs/SKILL.md) | Branches, commits, pull requests |
| [contracts-and-schema-first](.agent/skills/contracts-and-schema-first/SKILL.md) | New features, schema changes, domain events |
| [trust-boundary-and-security](.agent/skills/trust-boundary-and-security/SKILL.md) | Data access, Edge Functions, RLS |
| [attempt-lifecycle](.agent/skills/attempt-lifecycle/SKILL.md) | Attempt creation, answers, finalization, resume |
| [server-authoritative-timing](.agent/skills/server-authoritative-timing/SKILL.md) | Timing, countdowns, expiry, anti-cheat |
| [scoring-formula](.agent/skills/scoring-formula/SKILL.md) | Scoring and bonus calculation |
| [error-handling-and-logging](.agent/skills/error-handling-and-logging/SKILL.md) | Error envelopes, structured logging |
| [project-structure](.agent/skills/project-structure/SKILL.md) | Where code lives, domain boundaries |
| [neo-brutalist-ui](.agent/skills/neo-brutalist-ui/SKILL.md) | Any UI component or screen |

Equivalent rules for Cursor live in [.cursor/rules/](.cursor/rules/).

Every change carries its proof: schema changes need a migration, access-pattern
changes need RLS updates, and correctness work needs tests in the same PR.
