import { storage, lifecycle } from '@/platform';
import { edgeFunctions } from '@/lib/api/edge-functions';
import { trackAppError } from '@/lib/analytics';

/**
 * A durable queue for answers that could not be submitted.
 *
 * The game gives each player one attempt per day on a server clock. Losing an
 * answer to a dropped connection — a lift, a tunnel, a train — costs them
 * points they earned and cannot re-earn. Queueing the submission and draining
 * it on reconnect turns that from lost progress into a delay.
 *
 * Safe because `submit-answer` is idempotent: it returns the existing result
 * for an already-answered question rather than erroring, and handles the
 * unique violation underneath. So a queued answer that actually did reach the
 * server is a no-op on retry, and there is no way to double-score.
 *
 * NOT full offline play — that would mean shipping the answer key to the
 * device. The server still decides whether a late answer counts; this only
 * ensures the attempt reaches it.
 */

const KEY = 'answer_outbox';

/** Give up rather than retry forever against a permanent rejection. */
const MAX_ATTEMPTS = 5;

export interface QueuedAnswer {
  attemptId: string;
  questionId: string;
  selectedAnswerId: string | null;
  isTimeout: boolean;
  /** Reconciled client time — diagnostic only; the server times the attempt. */
  queuedAt: number;
  tries: number;
}

async function read(): Promise<QueuedAnswer[]> {
  const result = await storage.get(KEY);
  // ok:false means storage is unreadable, which is not the same as an empty
  // queue — but both lead to "nothing to drain right now", and unlike
  // ensureSession there is no irreversible decision resting on the
  // difference.
  if (!result.ok || !result.value) return [];
  try {
    const parsed = JSON.parse(result.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function write(queue: QueuedAnswer[]): Promise<void> {
  if (queue.length === 0) {
    await storage.remove(KEY);
    return;
  }
  await storage.set(KEY, JSON.stringify(queue));
}

/** Queue an answer whose submission failed. */
export async function enqueueAnswer(
  answer: Omit<QueuedAnswer, 'queuedAt' | 'tries'>,
): Promise<void> {
  const queue = await read();

  // One entry per question. A retry of the same question replaces rather than
  // appends, so a flapping connection cannot grow the queue without bound.
  const existing = queue.findIndex(
    (q) => q.attemptId === answer.attemptId && q.questionId === answer.questionId,
  );
  const entry: QueuedAnswer = { ...answer, queuedAt: Date.now(), tries: 0 };

  if (existing >= 0) queue[existing] = { ...entry, tries: queue[existing].tries };
  else queue.push(entry);

  await write(queue);
}

/**
 * Try to submit everything queued.
 *
 * Sequential rather than parallel: the answers belong to one attempt and the
 * server advances `current_index` as each lands, so submitting out of order
 * would have later ones rejected as the wrong question.
 */
export async function drainOutbox(): Promise<{ sent: number; remaining: number }> {
  const queue = await read();
  if (queue.length === 0) return { sent: 0, remaining: 0 };

  const stillQueued: QueuedAnswer[] = [];
  let sent = 0;

  for (const item of queue) {
    try {
      const response = await edgeFunctions.submitAnswer(
        item.attemptId,
        item.questionId,
        item.selectedAnswerId,
        item.isTimeout,
      );

      if (response.ok) {
        sent += 1;
        continue;
      }

      // A rejection the server will repeat — already finalized, expired,
      // unknown question — is not worth retrying. Dropping it loses nothing
      // that a retry would recover.
      const code = response.error?.code ?? '';
      const permanent =
        code === 'ATTEMPT_ALREADY_COMPLETED' ||
        code === 'QUESTION_ALREADY_ANSWERED' ||
        code === 'QUESTION_NOT_FOUND' ||
        code === 'INVALID_STATE_TRANSITION';

      if (permanent) {
        sent += 1; // resolved, even if not accepted
        continue;
      }

      const tries = item.tries + 1;
      if (tries < MAX_ATTEMPTS) stillQueued.push({ ...item, tries });
      else {
        trackAppError({
          location: 'answer_outbox_gave_up',
          message: `question=${item.questionId} code=${code} after ${tries} tries`,
        });
      }
    } catch {
      // Still offline. Keep it and try again on the next reconnect.
      const tries = item.tries + 1;
      if (tries < MAX_ATTEMPTS) stillQueued.push({ ...item, tries });
    }
  }

  await write(stillQueued);
  return { sent, remaining: stillQueued.length };
}

/** Anything waiting? Cheap enough to call on a render path. */
export async function hasQueuedAnswers(): Promise<boolean> {
  return (await read()).length > 0;
}

/**
 * Drain whenever the network comes back or the app returns to the foreground.
 *
 * Both matter on mobile: a phone can regain signal while backgrounded and
 * never fire an online event the WebView sees, and it can be foregrounded
 * hours later on a different network.
 */
export function startOutboxDrain(): () => void {
  const stopNetwork = lifecycle.onNetworkChange((online) => {
    if (online) void drainOutbox();
  });

  const stopLifecycle = lifecycle.onAppStateChange((state) => {
    if (state === 'active') void drainOutbox();
  });

  // And once now, for answers queued in a previous session.
  void drainOutbox();

  return () => {
    stopNetwork();
    stopLifecycle();
  };
}
