---
name: release-web
description: The 10Q web release lane — Next.js static output through OpenNext to Cloudflare Workers at play10q.com. Covers build and deploy, environment configuration, exact artifact and SHA verification, post-deploy activation checks, and web rollback by redeploy. Load only when the web lane is the next transition in a release; the release skill decides whether web should ship.
---

# Release — Web

The web lane. **[release](../release/SKILL.md) owns whether web should ship and at what
version. This skill owns how the web lane works.** Load it when the web transition is
next, not before.

## Before invoking any Friday command

Most of Friday is **designed and not yet built**. This skill describes the target
architecture; `friday capabilities` is the source of truth for what exists today.

```bash
friday capabilities        # ✓ built, ○ designed
```

A planned capability prints what it will do and **exits 2**. It never reports false
success.

> **If a capability you need is planned but not implemented, treat implementing that
> Friday capability as the next development task. Do not permanently bypass Friday with
> an ad hoc shell workflow.**

If you must proceed before it exists, follow the documented manual procedure in `docs/`
and **say plainly that you did so, and why**. See [friday](../friday/SKILL.md).

## The pipeline

```
apps/web (Next.js 16)
      │  opennextjs-cloudflare build
      ▼
  Worker bundle + assets
      │  opennextjs-cloudflare deploy
      ▼
Cloudflare Workers  →  play10q.com · www.play10q.com
```

This is **not** Vercel. Any document that says otherwise is wrong. The Worker is named
`10q-web` and its routes are pinned in `apps/web/wrangler.jsonc`.

## Before anything

Web is the fastest lane and the only genuinely reversible one, which makes it easy to
ship carelessly. Two preconditions, both non-negotiable:

1. **The backend for this SHA is verified and active.** A client deployed ahead of the
   schema it needs is broken for every visitor immediately. See
   [backend](../backend/SKILL.md).
2. **The release state names this SHA.** Do not deploy `HEAD` because it is convenient.
   Deploy the SHA the release was cut at.

## Deploying

```bash
friday release web deploy
```

Friday builds, deploys and verifies as one operation. It injects the version identifiers
so the running app reports the same version, build and SHA the release state claims —
this is why the deploy is a Friday command rather than `npm run deploy`.

Running the underlying build by hand produces an artifact with no version identity,
which then reports the wrong release in Sentry and PostHog and cannot be matched to a
release afterwards. Do not do it.

## Verifying the deploy

A successful deploy proves the upload worked. It does not prove the right thing is
being served — Workers propagate, caches hold, and a route pattern can silently miss.

```bash
friday release web verify
```

Confirms the live origin reports the expected version, build and **commit SHA**, and
that both `play10q.com` and `www.play10q.com` resolve to it.

**Never report web as live on the strength of the deploy exiting 0.** Verify, then
report. If verification disagrees with the release state, treat the deploy as failed.

## Environment configuration

Build-time public values (`NEXT_PUBLIC_*`) are baked into the bundle. Changing one
requires a rebuild and redeploy — editing a dashboard value changes nothing that is
already served.

Secrets live in CI, never in the repo and never on a laptop. If a value is missing,
`friday system doctor` names it and where it comes from. Do not improvise a local `.env` to
get a deploy through.

## Rollback

**Web rollback is real**, and it is the only lane where that is true.

```bash
friday release web rollback
```

This redeploys the previously live SHA. It is a **forward operation** — a new deploy of
old code — not a state reversal. Consequences worth stating out loud:

- It does **not** roll back the backend. If the rollback target predates a migration,
  the old client must still be compatible with the new schema. It usually is, because
  backend changes are required to be backward-compatible — but verify rather than assume.
- It does not undo anything users already did.

Contain first: rolling web back is fast and cheap, so do it before diagnosing if users
are affected.

## Prohibitions

- **Never** run `opennextjs-cloudflare` or `wrangler` directly to ship. The version
  injection and verification are the point.
- **Never** deploy web ahead of the backend for that SHA.
- **Never** deploy a SHA the release state does not name.
- **Never** report live without `friday release web verify` passing.

## Related skills

| Skill | Use it for |
|---|---|
| [release](../release/SKILL.md) | Whether web should ship, and at what version |
| [backend](../backend/SKILL.md) | Confirming the backend is active first |
