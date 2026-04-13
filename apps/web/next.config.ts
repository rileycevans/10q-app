import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const vercelOgStub = path.join(process.cwd(), "src/lib/stubs/vercel-og-stub.mjs");

const nextConfig: NextConfig = {
  transpilePackages: ["@10q/contracts"],
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
