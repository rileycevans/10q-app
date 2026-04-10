import path from "node:path";
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const vercelOgStub = path.join(process.cwd(), "src/lib/stubs/vercel-og-stub.mjs");

export default defineCloudflareConfig({
  override: {
    wrapper: "cloudflare-node",
    converter: "edge",
    generateDockerfile: false,
    incrementalCache: "cloudflare-kv",
    tagCache: "cloudflare-kv",
    queue: "sqs-lite",
    initializationFunction: undefined,
    warmer: undefined,
    proxyExternalWebsockets: false,
  },
  esbuild: {
    external: [],
    alias: {
      "next/dist/compiled/@vercel/og/index.edge.js": vercelOgStub,
      "next/dist/compiled/@vercel/og/index.node.js": vercelOgStub,
    },
  },
});
