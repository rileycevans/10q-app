export const dynamic = "force-dynamic";

export async function GET() {
  throw new Error("Sentry server test error — thrown from /sentry-test/server");
}
