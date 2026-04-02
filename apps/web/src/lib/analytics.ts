import { posthog } from './posthog';

type ScreenName =
  | 'home'
  | 'play'
  | 'question'
  | 'finalize'
  | 'results'
  | 'leaderboard'
  | 'profile'
  | 'settings'
  | 'tomorrow';

function capture(event: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Swallow analytics errors to avoid impacting gameplay.
  }
}

// ── Person properties ───────────────────────────────────────────────

export function identifyUser(userId: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    posthog.identify(userId, properties);
  } catch {
    // Swallow
  }
}

export function setPersonProperties(properties: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    posthog.people.set(properties);
  } catch {
    // Swallow
  }
}

export function resetIdentity() {
  if (typeof window === 'undefined') return;
  try {
    posthog.reset();
  } catch {
    // Swallow
  }
}

// ── Screen views ────────────────────────────────────────────────────

export function trackScreenView(props: {
  screen: ScreenName;
  route?: string;
  quiz_id?: string;
  attempt_id?: string;
}) {
  capture('screen_view', props);
}

// ── Quiz lifecycle ──────────────────────────────────────────────────

export function trackQuizStart(props: {
  quiz_id: string;
  attempt_id: string;
  is_resume: boolean;
}) {
  capture('quiz_start', props);
}

export function trackQuizUnavailable(props: {
  reason: string;
}) {
  capture('quiz_unavailable', props);
}

export function trackQuestionView(props: {
  quiz_id: string;
  attempt_id: string;
  question_id: string;
  question_index: number;
}) {
  capture('question_view', props);
}

export function trackAnswerSubmit(props: {
  quiz_id: string;
  attempt_id: string;
  question_id: string;
  question_index: number;
  answer_id: string | null;
  is_correct: boolean;
  time_ms: number;
  base_points: number;
  bonus_points: number;
  total_points: number;
  answer_kind: 'selected' | 'timeout';
  question_tags?: string[];
}) {
  capture('answer_submit', props);
}

export function trackQuizFinalized(props: {
  attempt_id: string;
  quiz_id?: string;
  total_score: number;
  correct_count?: number;
  total_time_ms?: number;
}) {
  capture('quiz_finalized', props);
}

export function trackResultsView(props: {
  attempt_id: string;
  quiz_id: string;
  quiz_number: number | null;
  total_score: number;
  total_time_ms: number;
  correct_count: number;
}) {
  capture('results_view', props);
}

export function trackShareClicked(props: {
  attempt_id?: string;
  quiz_number?: number | null;
  total_score?: number;
}) {
  capture('share_clicked', props);
}

// ── Leaderboard / profile ───────────────────────────────────────────

export function trackLeaderboardView(props: {
  window: string;
  mode: string;
  score_type: string;
  has_session: boolean;
}) {
  capture('leaderboard_view', props);
}

export function trackProfileView(props: {
  player_id: string;
  handle: string;
}) {
  capture('profile_view', props);
}

export function trackSettingsView() {
  capture('settings_view');
}

export function trackHandleUpdate(props: {
  success: boolean;
}) {
  capture('handle_update', props);
}

// ── Auth events ─────────────────────────────────────────────────────

export function trackSignIn(props: {
  provider: string;
  is_upgrade: boolean;
}) {
  capture('sign_in', props);
}

export function trackSignOut() {
  capture('sign_out');
}

export function trackAuthUpgradeStarted(props: {
  provider: string;
}) {
  capture('auth_upgrade_started', props);
}

// ── Errors ──────────────────────────────────────────────────────────

export function trackAppError(props: {
  location: string;
  message: string;
}) {
  capture('app_error', props);
}
