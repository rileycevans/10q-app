/**
 * `Deno` for the Node-based typechecker.
 *
 * The unit tests import _shared/*.ts directly — that is the point, they test
 * the real Edge Function code rather than a copy — but those modules run under
 * Deno and reference a global Node's TypeScript does not know.
 *
 * Only what the shared modules actually use. Deliberately not @types/deno:
 * pulling the full Deno lib into a Node project pollutes globals (its fetch,
 * its Request) and makes the tests typecheck against a runtime they do not run
 * on.
 */
declare global {
  const Deno: {
    env: {
      get(key: string): string | undefined;
    };
  };
}

export {};
