'use client';

import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import { ensureSession } from '@/lib/auth';
import { getCurrentQuiz, reshapeQuizRows, type QuizQuestion } from '@/domains/quiz';
import { startAttempt, type AttemptState } from '@/domains/attempt';

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
        // Step 1: session + quiz discovery in parallel
        // getCurrentQuiz doesn't need auth, so fire both at once.
        // Imports are static (top of file) — keeping them eager shaves
        // ~30–80ms off play start, which is a hot path.
        const [, currentQuiz] = await Promise.all([
          ensureSession(),
          getCurrentQuiz(),
        ]);

        if (!currentQuiz) {
          setState({ phase: 'error', error: 'No quiz available. Come back at 11:30 UTC!' });
          return;
        }

        // Step 2: start attempt (now returns all questions too)
        const attemptState = await startAttempt(currentQuiz.quiz_id);

        // Reshape flat quiz_play_view rows into nested questions+answers
        const questions = reshapeQuizRows(
          (attemptState.all_questions as Parameters<typeof reshapeQuizRows>[0]) || []
        );

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
  // eslint-disable-next-line react-hooks/refs
  if (!storeRef.current) {
    storeRef.current = createGameStore();
  }

  return (
    // eslint-disable-next-line react-hooks/refs
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
