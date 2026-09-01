import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
  /**
   * The platform seam boundary.
   *
   * Two rules from 04-shared-code-architecture.md, enforced here rather than
   * left to discipline — both failures are silent and expensive.
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/platform/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@capacitor/*', '@capacitor-community/*'],
            message:
              'Capacitor may only be imported inside src/platform/. Importing it elsewhere pulls native code into the web bundle and puts an if (isNative) branch in a screen. Add a capability to src/platform/ instead.',
          },
          {
            group: ['**/platform/*.web', '**/platform/*.native'],
            message:
              "Import from '@/platform', not a concrete implementation — the seam picks the right one at build time. Importing .web or .native directly hard-codes one platform into a shared module.",
          },
        ],
      }],
    },
  },

  /**
   * The seam itself may import Capacitor, and needs require() for build-time
   * implementation selection — a static import would pull both platforms'
   * modules into every bundle, which is the thing the seam exists to avoid.
   */
  {
    files: ['src/platform/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build artifacts:
    ".open-next/**",
    "playwright-report/**",
    "test-results/**",

    // Native projects. `cap sync` copies the built web bundle into both, and
    // Gradle writes its own copies again under android/app/build — so the same
    // minified output gets linted three or four times over. None of it is
    // source: editing it does nothing, because the next sync overwrites it.
    //
    // CI never saw this (a fresh checkout has no synced bundle), so lint was
    // green there while a working machine reported hundreds of findings in
    // files nobody wrote. That divergence is the actual bug — a check that
    // disagrees with CI teaches you to ignore it.
    "ios/**",
    "android/**",
  ]),
]);

export default eslintConfig;
