"use client";

import * as Sentry from "@sentry/nextjs";

export default function SentryTestPage() {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Sentry Test</h1>
      <p>Buttons below trigger events. Check your Sentry dashboard.</p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          onClick={() => {
            throw new Error("Sentry client test error — thrown from button");
          }}
        >
          Throw client error
        </button>
        <button
          onClick={() => {
            Sentry.captureException(new Error("Sentry client test — captureException"));
          }}
        >
          captureException
        </button>
        <button
          onClick={async () => {
            const res = await fetch("/sentry-test/server");
            alert(`Server route status: ${res.status}`);
          }}
        >
          Trigger server error
        </button>
      </div>
    </div>
  );
}
