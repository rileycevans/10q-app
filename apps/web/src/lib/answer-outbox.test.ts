import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The outbox exists so a dropped connection does not cost a player points on
 * their one attempt of the day. The behaviours worth pinning are the ones
 * that would silently lose or duplicate an answer.
 */

const store = new Map<string, string>();

vi.mock('@/platform', () => ({
  storage: {
    get: async (k: string) => ({ ok: true as const, value: store.get(k) ?? null }),
    set: async (k: string, v: string) => { store.set(k, v); return { ok: true as const, value: undefined }; },
    remove: async (k: string) => { store.delete(k); return { ok: true as const, value: undefined }; },
    isDurable: async () => true,
  },
  lifecycle: {
    onNetworkChange: () => () => {},
    onAppStateChange: () => () => {},
  },
}));

const submitAnswer = vi.fn();
vi.mock('@/lib/api/edge-functions', () => ({
  edgeFunctions: { submitAnswer: (...a: unknown[]) => submitAnswer(...a) },
}));
vi.mock('@/lib/analytics', () => ({ trackAppError: vi.fn() }));

const { enqueueAnswer, drainOutbox, hasQueuedAnswers } = await import('./answer-outbox');

const answer = {
  attemptId: 'attempt-1',
  questionId: 'question-1',
  selectedAnswerId: 'answer-a',
  isTimeout: false,
};

describe('answer outbox', () => {
  beforeEach(() => {
    store.clear();
    submitAnswer.mockReset();
  });

  it('queues an answer and reports it pending', async () => {
    await enqueueAnswer(answer);
    expect(await hasQueuedAnswers()).toBe(true);
  });

  it('delivers a queued answer and clears it', async () => {
    submitAnswer.mockResolvedValue({ ok: true, data: {} });
    await enqueueAnswer(answer);

    const result = await drainOutbox();

    expect(result).toEqual({ sent: 1, remaining: 0 });
    expect(await hasQueuedAnswers()).toBe(false);
  });

  it('keeps an answer queued while still offline', async () => {
    submitAnswer.mockRejectedValue(new Error('network'));
    await enqueueAnswer(answer);

    const result = await drainOutbox();

    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(1);
    expect(await hasQueuedAnswers()).toBe(true);
  });

  it('replaces rather than appends when the same question is queued twice', async () => {
    // A flapping connection must not grow the queue without bound.
    await enqueueAnswer(answer);
    await enqueueAnswer({ ...answer, selectedAnswerId: 'answer-b' });

    submitAnswer.mockResolvedValue({ ok: true, data: {} });
    const result = await drainOutbox();

    expect(result.sent).toBe(1);
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    // The latest choice wins.
    expect(submitAnswer).toHaveBeenCalledWith('attempt-1', 'question-1', 'answer-b', false);
  });

  it('does not retry a rejection the server will repeat', async () => {
    // Already answered means the answer landed. Retrying forever would keep
    // a dead entry in the queue on every reconnect.
    submitAnswer.mockResolvedValue({
      ok: false,
      error: { code: 'QUESTION_ALREADY_ANSWERED', message: 'already answered' },
    });
    await enqueueAnswer(answer);

    const result = await drainOutbox();

    expect(result.remaining).toBe(0);
    expect(await hasQueuedAnswers()).toBe(false);
  });

  it('gives up after repeated transient failures', async () => {
    submitAnswer.mockRejectedValue(new Error('network'));
    await enqueueAnswer(answer);

    // MAX_ATTEMPTS is 5.
    for (let i = 0; i < 5; i++) await drainOutbox();

    expect(await hasQueuedAnswers()).toBe(false);
  });

  it('submits in order, because the server advances current_index', async () => {
    const order: string[] = [];
    submitAnswer.mockImplementation(async (_a: string, q: string) => {
      order.push(q);
      return { ok: true, data: {} };
    });

    await enqueueAnswer({ ...answer, questionId: 'q1' });
    await enqueueAnswer({ ...answer, questionId: 'q2' });
    await enqueueAnswer({ ...answer, questionId: 'q3' });

    await drainOutbox();

    expect(order).toEqual(['q1', 'q2', 'q3']);
  });

  it('is a no-op when nothing is queued', async () => {
    const result = await drainOutbox();
    expect(result).toEqual({ sent: 0, remaining: 0 });
    expect(submitAnswer).not.toHaveBeenCalled();
  });
});
