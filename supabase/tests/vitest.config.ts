import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["./*.test.ts", "./unit/**/*.test.ts"],
  },
  resolve: {
    // Edge function modules use Deno-style `.ts` import specifiers. Vitest
    // needs this so it can resolve them when running unit tests under Node.
    extensions: [".ts", ".js", ".mjs", ".json"],
  },
});
