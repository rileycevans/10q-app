"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

const buttonStyle: React.CSSProperties = {
  padding: "0.75rem 1.25rem",
  background: "#000",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "1rem",
};

export default function SentryTestPage() {
  const [status, setStatus] = useState<string>("");

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 720 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Sentry Test</h1>
      <p style={{ marginBottom: "1.5rem", color: "#444" }}>
        Each button below triggers an event. Check your Sentry dashboard within ~30 seconds.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            setStatus("Throwing client error...");
            throw new Error("Sentry client test error — thrown from button");
          }}
        >
          Throw client error
        </button>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            Sentry.captureException(new Error("Sentry client test — captureException"));
            setStatus("Sent captureException at " + new Date().toISOString());
          }}
        >
          captureException
        </button>
        <button
          type="button"
          style={buttonStyle}
          onClick={async () => {
            setStatus("Calling /sentry-test/server...");
            try {
              const res = await fetch("/sentry-test/server");
              setStatus(`Server route returned ${res.status} at ${new Date().toISOString()}`);
            } catch (err) {
              setStatus(`Fetch failed: ${(err as Error).message}`);
            }
          }}
        >
          Trigger server error
        </button>
      </div>
      {status && (
        <pre style={{ background: "#f3f3f3", padding: "0.75rem", borderRadius: 6, fontSize: "0.85rem" }}>
          {status}
        </pre>
      )}
    </div>
  );
}
