'use client';

import { createContext, useContext, useCallback, useRef, useSyncExternalStore } from 'react';
import type { QuizQuestion } from '@/domains/quiz';
import type { AttemptState } from '@/domains/attempt';

// ── Types ──────────────────────────────────────────────────────────────────

type GamePhase =
  | 'idle'        // nothing loaded yet
  | 'loading'     // prep pipeline running
  | 'ready'       // all data loaded, countdown can begin
  | 'playing'     // actively on a question
  | 'error';      // something went wrong

interface GameState {
  phase: GamePhase;
  quizId: string | null;
  attempt: AttemptState | null;
  questions: QuizQuestion[] | null;
  error: string | null;
}

interface GameStore {
  getState: () => GameState;
  subscribe: (cb: () => void) => () => void;
  /** Run the full prep pipeline: session, quiz, attempt, questions — all at once. */
  prepare: () => Promise<void>;
  /** Update attempt state after an answer submit (avoids re-fetching). */
  setAttempt: (attempt: AttemptState) => void;
}

const INITIAL_STATE: GameState = {
  phase: 'idle',
  quizId: null,
  attempt: null,
  questions: null,
  error: null,
};

// ── Store factory ──────────────────────────────────────────────────────────

function createGameStore(): GameStore {
  let state: GameState = { ...INITIAL_STATE };
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  function setState(patch: Partial<GameState>) {
    state = { ...state, ...patch };
    emit();
  }

  return {
    getState: () => state,

    subscribe: (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    prepare: async () => {
      // Don't re-run if already loaded or in flight
      if (state.phase === 'ready' || state.phase === 'loading') return;

      setState({ phase: 'loading', error: null });

      try {
        // Lazy-import domains so this module stays light
        const [{ ensureSession }, { getCurrentQuiz, getQuizQuestions }, { startAttempt }] =
          await Promise.all([
            import('@/lib/auth'),
            import('@/domains/quiz'),
            import('@/domains/attempt'),
          ]);

        // Step 1: session + quiz discovery in parallel
        // getCurrentQuiz doesn't need auth, so fire both at once
        const [, currentQuiz] = await Promise.all([
          ensureSession(),
          getCurrentQuiz(),
        ]);

        if (!currentQuiz) {
          setState({ phase: 'error', error: 'No quiz available. Come back at 11:30 UTC!' });
          return;
        }

        // Step 2: attempt + questions in parallel (both need session, but not each other)
        const [attemptState, questions] = await Promise.all([
          startAttempt(currentQuiz.quiz_id),
          getQuizQuestions(currentQuiz.quiz_id),
        ]);

        // Persist to sessionStorage for hard-refresh recovery
        sessionStorage.setItem('quiz_id', currentQuiz.quiz_id);
        sessionStorage.setItem('quiz_questions', JSON.stringify(questions));
        sessionStorage.setItem('attempt_state', JSON.stringify(attemptState));

        setState({
          phase: 'ready',
          quizId: currentQuiz.quiz_id,
          attempt: attemptState,
          questions,
        });
      } catch (err) {
        setState({
          phase: 'error',
          error: err instanceof Error ? err.message : 'Failed to load quiz',
        });
      }
    },

    setAttempt: (attempt) => {
      sessionStorage.setItem('attempt_state', JSON.stringify(attempt));
      setState({ attempt });
    },
  };
}

// ── React context ──────────────────────────────────────────────────────────

const GameContext = createContext<GameStore | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  // Single store instance per mount — survives client-side navigations within /play/*
  const storeRef = useRef<GameStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createGameStore();
  }

  return (
    <GameContext.Provider value={storeRef.current}>
      {children}
    </GameContext.Provider>
  );
}

export function useGameStore(): GameStore {
  const store = useContext(GameContext);
  if (!store) throw new Error('useGameStore must be used within <GameProvider>');
  return store;
}

export function useGameState(): GameState {
  const store = useGameStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
