import path from "node:path";
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const vercelOgStub = path.join(process.cwd(), "src/lib/stubs/vercel-og-stub.mjs");

export default defineCloudflareConfig({
  esbuild: {
    external: [],
    alias: {
      "next/dist/compiled/@vercel/og/index.edge.js": vercelOgStub,
      "next/dist/compiled/@vercel/og/index.node.js": vercelOgStub,
    },
  },
});
