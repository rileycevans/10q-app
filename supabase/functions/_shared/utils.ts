/**
 * Utility functions for Edge Functions
 */

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function logStructured(
  requestId: string,
  eventType: string,
  data: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      request_id: requestId,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      ...data,
    })
  );
}

