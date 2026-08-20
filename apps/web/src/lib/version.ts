/**
 * Build identity, inlined at build time.
 *
 * `NEXT_PUBLIC_*` is substituted by the bundler, so these are constants in the
 * shipped artifact — there is no runtime lookup and no way to change them in a
 * store binary. That is the point: a crash report from a three-week-old iOS
 * build has to say which build it came from, and the binary cannot be asked
 * after the fact.
 *
 * Populated by `scripts/release/version.mjs env`, whose only source is
 * version.json. See docs/cross-platform/release/VERSIONING.md.
 *
 * The fallbacks are for local `npm run dev`, where the build script has not
 * run. They are deliberately obvious ('0.0.0-dev', 'unknown') so a value that
 * escapes into Sentry or PostHog is recognisable as unstamped rather than
 * looking like a real release.
 */

export type ClientPlatform = 'web' | 'ios' | 'android';
export type AppEnvironment = 'production' | 'staging' | 'development';

/** Product version, shared across all three platforms. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0-dev';

/**
 * Unique artifact id.
 *
 * Native: the monotonic build integer. Web: the release SHA, because web
 * deploys on every push and a counter would mean a bot commit per deploy.
 * Consumers do not branch on platform — the field is always present and always
 * uniquely identifies the artifact.
 */
export const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? 'unknown';

export const CLIENT_PLATFORM = (process.env.NEXT_PUBLIC_CLIENT_PLATFORM ??
  'web') as ClientPlatform;

export const RELEASE_SHA = process.env.NEXT_PUBLIC_RELEASE_SHA ?? 'unknown';

export const APP_ENVIRONMENT = (process.env.NEXT_PUBLIC_ENVIRONMENT ??
  'development') as AppEnvironment;

/**
 * Sentry's `release`. Product version plus artifact id, so two builds of the
 * same version are distinguishable — which is the whole reason `dist` exists
 * alongside it.
 */
export const SENTRY_RELEASE = `${APP_VERSION}+${APP_BUILD}`;

/**
 * Value of the X-Client-Version request header.
 *
 * Format: `<platform>/<version>+<build>`. The server parses this to enforce a
 * minimum supported version — the only lever that works once store binaries
 * are in the wild, because mobile cannot be rolled back.
 */
export const CLIENT_VERSION_HEADER = `${CLIENT_PLATFORM}/${APP_VERSION}+${APP_BUILD}`;

/** True when the build was not stamped — local dev, or a broken build script. */
export const IS_UNSTAMPED_BUILD =
  APP_VERSION === '0.0.0-dev' || APP_BUILD === 'unknown';

/** Every identifier at once, for analytics registration and debugging. */
export function buildIdentity() {
  return {
    app_version: APP_VERSION,
    app_build: APP_BUILD,
    client_platform: CLIENT_PLATFORM,
    release_sha: RELEASE_SHA,
    environment: APP_ENVIRONMENT,
  } as const;
}

/**
 * The origin that shared links must point at.
 *
 * `window.location.origin` is wrong on native. Inside the Capacitor WebView it
 * is `capacitor://localhost`, so an invite link built from it is a URL nobody
 * outside the app can open — and it fails silently, as a link a friend taps and
 * nothing happens, not as an error anyone sees in testing.
 *
 * The invite link is the growth loop, so it must always be an https://
 * play10q.com URL regardless of which platform generated it.
 *
 * Web keeps using the live origin so preview deploys and localhost still
 * self-reference correctly; only native pins to the canonical site.
 */
export const PUBLIC_ORIGIN: string =
  process.env.NEXT_PUBLIC_PUBLIC_ORIGIN ??
  (CLIENT_PLATFORM === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : 'https://play10q.com');

/** Absolute URL on the public site, for anything shared outside the app. */
export function publicUrl(path: string): string {
  return `${PUBLIC_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}
