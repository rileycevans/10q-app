import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const vercelOgStub = path.join(process.cwd(), "src/lib/stubs/vercel-og-stub.mjs");

/**
 * One config, two targets.
 *
 *   BUILD_TARGET=web     (default) — Cloudflare Workers via OpenNext. Unchanged.
 *   BUILD_TARGET=native            — `output: 'export'` for the Capacitor shells.
 *
 * The native target is a strict subset: no middleware, no route handlers, no
 * image optimizer, no server rendering. Anything the export cannot represent
 * is moved aside by scripts/build-native.sh rather than deleted, because web
 * still needs it.
 *
 * Keep web's behaviour identical to what it was before this split. A native
 * build that fails is an inconvenience; a web build that silently changes is
 * a production incident.
 */
const isNative = process.env.BUILD_TARGET === "native";

const nextConfig: NextConfig = {
  transpilePackages: ["@10q/contracts"],

  ...(isNative
    ? {
        output: "export" as const,
        // The export writes a directory per route, so every path needs its
        // trailing slash to resolve as index.html from a file:// or
        // capacitor:// origin where there is no server to rewrite it.
        trailingSlash: true,
      }
    : {}),

  images: {
    // The optimizer is a server feature. Without this the export emits
    // /_next/image?url=... URLs that 404 inside the app bundle — silently,
    // as a broken avatar rather than a build error. CI greps for it.
    unoptimized: isNative,
    // Allow OAuth provider avatars (Google, Apple) so we can serve them
    // through the Next.js image optimizer instead of raw <img>.
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "appleid.cdn-apple.com" },
    ],
  },
  /**
   * Permanent redirects from the pre-Phase-3 URL shapes.
   *
   * Static export cannot build a page per league id, handle or invite code,
   * so those routes moved to query params. The old URLs are already out in
   * the world — invite links especially live in people's message threads and
   * are the growth loop — so they must keep working indefinitely.
   *
   * 308 rather than 302: permanent, and it preserves the method. These are
   * not a migration aid to delete later.
   *
   * Web-only. The native export has no server to redirect, and no old links
   * to honour because the app has never shipped.
   */
  ...(isNative
    ? {}
    : {
        async redirects() {
          return [
            { source: '/invite/:code', destination: '/invite/?code=:code', permanent: true },
            { source: '/u/:handle', destination: '/u/?handle=:handle', permanent: true },
            // Negative lookahead: /leagues/create and /leagues/view are real
            // pages, and a bare :id would swallow both — sending someone who
            // clicked "create a league" into a lookup for a league whose id is
            // the literal string "create".
            {
              source: '/leagues/:id((?!create$|view$)[^/]+)',
              destination: '/leagues/view?id=:id',
              permanent: true,
            },
          ];
        },
      }),

  turbopack: {
    resolveAlias: {
      "next/dist/compiled/@vercel/og/index.edge.js": vercelOgStub,
      "next/dist/compiled/@vercel/og/index.node.js": vercelOgStub,
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...config.resolve.alias,
        "next/dist/compiled/@vercel/og/index.edge.js": vercelOgStub,
        "next/dist/compiled/@vercel/og/index.node.js": vercelOgStub,
      };
    }
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
});
