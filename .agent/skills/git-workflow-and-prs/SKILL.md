---
name: Git Workflow & Pull Requests
description: Enforce rebase-first Git workflow with conventional commits, branch naming, and structured PR creation via gh CLI. Applies when creating branches, making commits, or preparing pull requests.
---

# Git Workflow & Pull Requests

## When This Skill Applies

- Creating a branch for new work
- Writing commit messages
- Rebasing, squashing, or pushing changes
- Creating or updating a pull request
- Merging code to main

## Scope

All Git operations and GitHub PR management across the entire repository.

## Guidelines

### Branching

- Format: `<type>/<domain>-<short-slug>`
- Types: `feat/`, `fix/`, `chore/`, `docs/`
- Never commit directly to main.
- Before creating a branch:
  ```bash
  git checkout main
  git pull --rebase origin main
  git checkout -b <branch-name>
  ```

### Commit Messages (Mandatory Format)

Structure: `<type>(<domain>): <imperative summary>`

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`

Optional body answering: what changed, why, and any invariant/security implications.

**Sizing:** Each commit must be logically coherent. "Add migration + function change + tests" is acceptable if it's one feature slice. Avoid mega-commits mixing unrelated changes. If touching core correctness areas (timing/scoring/RLS), commits must include tests in the same PR.

### Rebase-First Workflow

- Keep history linear: rebase onto `origin/main` frequently.
- `git fetch origin` then `git rebase origin/main`.
- **Never** merge main into your branch.

### Fixups and Squashing

During development: `git commit --fixup <commit_sha>`
Before PR finalization: `git rebase -i --autosquash origin/main`
Push: `git push --force-with-lease`

### What Must Never Be Committed

- Secrets (Supabase service role key, JWT secrets)
- Local env files: `.env.local`, `.env.*` (except `.env.example`)
- Generated build output: `.next/`, `dist/`
- Verify entries in `.gitignore`.

### PR Creation (via `gh` CLI Only)

**Pre-PR checks:**
1. Confirm you're on a feature branch (not main).
2. Branch up to date: `git fetch origin && git rebase origin/main`.
3. Run `npm test` and `npm run lint` locally.
4. If Supabase migrations/functions changed: `npx supabase db reset`.

**Title format:** `<type>(<domain>): <short outcome>`

**PR description must include:**
- **What changed** — bullet list of behavior-level changes (not file lists)
- **Why** — link to spec/ADR/rule being satisfied
- **How it works** — key invariants, trust boundary notes; for Edge Functions: auth, idempotency, timing authority
- **Tests** — exact commands run, key cases covered
- **Risk / Rollback** — what could break, how to revert safely
- **Screenshots** — if UI changed

**Creation command:**
```bash
gh pr create \
  --base main \
  --title "feat(attempt): server-authoritative submit-answer" \
  --body "$(cat .github/PULL_REQUEST_TEMPLATE.md)"
```

### PR Hygiene

- Keep PRs small: prefer < ~400 lines changed.
- One domain outcome per PR.
- No mixed concerns (don't combine refactors + features + formatting).
- Explicitly call out RLS changes, schema/migration changes, scoring/timing/publish logic.

### Merge Policy

- Default: **squash merge** (PR title becomes squash commit message).
- Preserve key bullets from PR description in squash commit.

### Post-Merge Cleanup

```bash
git checkout main
git pull --rebase origin main
git branch -d <branch>
git push origin --delete <branch>
```

## Anti-Patterns

- Branch name `feature-branch` (missing domain), `fix-bug` (wrong format)
- Commit message `fixed scoring` (missing type, domain, imperative)
- Merging main into feature branch instead of rebasing
- Creating PR via GitHub UI instead of `gh` CLI
- PR title `Add submit answer function` (missing prefix/domain)
- Mega-commit mixing unrelated changes
- Committing `.env.local` or secrets

## Examples

**Valid branch names:** `feat/attempt-submit-answer`, `fix/publish-quiz-idempotency`, `chore/repo-supabase-scripts`

**Valid commit:**
```
feat(scoring): implement linear bonus with half-point rounding

Adds linear bonus calculation to scoring formula with proper
rounding to nearest half-point. Enforces invariant that total
score never exceeds question point value.
```
