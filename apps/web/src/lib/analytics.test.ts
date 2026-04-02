/**
 * Unit tests for analytics module.
 * Verifies that each tracking function calls posthog.capture / people.set
 * with the expected event name and properties.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted lets us declare mocks that are available inside vi.mock factories
const { mockCapture, mockIdentify, mockPeopleSet, mockReset } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  mockIdentify: vi.fn(),
  mockPeopleSet: vi.fn(),
  mockReset: vi.fn(),
}));

vi.mock('./posthog', () => ({
  posthog: {
    capture: mockCapture,
    identify: mockIdentify,
    people: { set: mockPeopleSet },
    reset: mockReset,
  },
}));

// Simulate browser environment
vi.stubGlobal('window', {});

import {
  trackScreenView,
  trackQuizStart,
  trackQuizUnavailable,
  trackQuestionView,
  trackAnswerSubmit,
  trackQuizFinalized,
  trackResultsView,
  trackShareClicked,
  trackLeaderboardView,
  trackProfileView,
  trackSettingsView,
  trackHandleUpdate,
  trackSignIn,
  trackSignOut,
  trackAuthUpgradeStarted,
  trackAppError,
  identifyUser,
  setPersonProperties,
  resetIdentity,
} from './analytics';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('analytics capture helpers', () => {
  it('trackScreenView sends screen_view', () => {
    trackScreenView({ screen: 'home', route: '/' });
    expect(mockCapture).toHaveBeenCalledWith('screen_view', {
      screen: 'home',
      route: '/',
    });
  });

  it('trackQuizStart sends quiz_start', () => {
    trackQuizStart({ quiz_id: 'q1', attempt_id: 'a1', is_resume: false });
    expect(mockCapture).toHaveBeenCalledWith('quiz_start', {
      quiz_id: 'q1',
      attempt_id: 'a1',
      is_resume: false,
    });
  });

  it('trackQuizUnavailable sends quiz_unavailable', () => {
    trackQuizUnavailable({ reason: 'NO_QUIZ_AVAILABLE' });
    expect(mockCapture).toHaveBeenCalledWith('quiz_unavailable', {
      reason: 'NO_QUIZ_AVAILABLE',
    });
  });

  it('trackQuestionView sends question_view', () => {
    trackQuestionView({
      quiz_id: 'q1',
      attempt_id: 'a1',
      question_id: 'qq1',
      question_index: 3,
    });
    expect(mockCapture).toHaveBeenCalledWith('question_view', {
      quiz_id: 'q1',
      attempt_id: 'a1',
      question_id: 'qq1',
      question_index: 3,
    });
  });

  it('trackAnswerSubmit includes answer_kind and question_tags', () => {
    trackAnswerSubmit({
      quiz_id: 'q1',
      attempt_id: 'a1',
      question_id: 'qq1',
      question_index: 2,
      answer_id: 'ans1',
      is_correct: true,
      time_ms: 3000,
      base_points: 5,
      bonus_points: 4,
      total_points: 9,
      answer_kind: 'selected',
      question_tags: ['history', 'europe'],
    });
    expect(mockCapture).toHaveBeenCalledWith('answer_submit', {
      quiz_id: 'q1',
      attempt_id: 'a1',
      question_id: 'qq1',
      question_index: 2,
      answer_id: 'ans1',
      is_correct: true,
      time_ms: 3000,
      base_points: 5,
      bonus_points: 4,
      total_points: 9,
      answer_kind: 'selected',
      question_tags: ['history', 'europe'],
    });
  });

  it('trackAnswerSubmit handles timeout with null answer_id', () => {
    trackAnswerSubmit({
      quiz_id: 'q1',
      attempt_id: 'a1',
      question_id: 'qq1',
      question_index: 5,
      answer_id: null,
      is_correct: false,
      time_ms: 16000,
      base_points: 0,
      bonus_points: 0,
      total_points: 0,
      answer_kind: 'timeout',
      question_tags: ['science'],
    });
    const call = mockCapture.mock.calls[0];
    expect(call[0]).toBe('answer_submit');
    expect(call[1]).toMatchObject({
      answer_id: null,
      answer_kind: 'timeout',
      is_correct: false,
    });
  });

  it('trackQuizFinalized sends quiz_finalized', () => {
    trackQuizFinalized({ attempt_id: 'a1', total_score: 85 });
    expect(mockCapture).toHaveBeenCalledWith('quiz_finalized', {
      attempt_id: 'a1',
      total_score: 85,
    });
  });

  it('trackResultsView sends results_view with all fields', () => {
    trackResultsView({
      attempt_id: 'a1',
      quiz_id: 'q1',
      quiz_number: 42,
      total_score: 85,
      total_time_ms: 45000,
      correct_count: 8,
    });
    expect(mockCapture).toHaveBeenCalledWith('results_view', {
      attempt_id: 'a1',
      quiz_id: 'q1',
      quiz_number: 42,
      total_score: 85,
      total_time_ms: 45000,
      correct_count: 8,
    });
  });

  it('trackShareClicked sends share_clicked', () => {
    trackShareClicked({ attempt_id: 'a1', quiz_number: 10, total_score: 90 });
    expect(mockCapture).toHaveBeenCalledWith('share_clicked', {
      attempt_id: 'a1',
      quiz_number: 10,
      total_score: 90,
    });
  });

  it('trackLeaderboardView sends leaderboard_view', () => {
    trackLeaderboardView({
      window: '7d',
      mode: 'top',
      score_type: 'cumulative',
      has_session: true,
    });
    expect(mockCapture).toHaveBeenCalledWith('leaderboard_view', {
      window: '7d',
      mode: 'top',
      score_type: 'cumulative',
      has_session: true,
    });
  });

  it('trackProfileView sends profile_view', () => {
    trackProfileView({ player_id: 'p1', handle: 'test_user' });
    expect(mockCapture).toHaveBeenCalledWith('profile_view', {
      player_id: 'p1',
      handle: 'test_user',
    });
  });

  it('trackSettingsView sends settings_view', () => {
    trackSettingsView();
    expect(mockCapture).toHaveBeenCalledWith('settings_view', undefined);
  });

  it('trackHandleUpdate sends handle_update', () => {
    trackHandleUpdate({ success: true });
    expect(mockCapture).toHaveBeenCalledWith('handle_update', { success: true });
  });
});

describe('auth tracking', () => {
  it('trackSignIn sends sign_in with provider and is_upgrade', () => {
    trackSignIn({ provider: 'google', is_upgrade: true });
    expect(mockCapture).toHaveBeenCalledWith('sign_in', {
      provider: 'google',
      is_upgrade: true,
    });
  });

  it('trackSignOut sends sign_out', () => {
    trackSignOut();
    expect(mockCapture).toHaveBeenCalledWith('sign_out', undefined);
  });

  it('trackAuthUpgradeStarted sends auth_upgrade_started', () => {
    trackAuthUpgradeStarted({ provider: 'apple' });
    expect(mockCapture).toHaveBeenCalledWith('auth_upgrade_started', {
      provider: 'apple',
    });
  });
});

describe('identity management', () => {
  it('identifyUser calls posthog.identify', () => {
    identifyUser('user-123', { email: 'a@b.com' });
    expect(mockIdentify).toHaveBeenCalledWith('user-123', { email: 'a@b.com' });
  });

  it('setPersonProperties calls posthog.people.set', () => {
    setPersonProperties({ is_anonymous: false, last_quiz_score: 90 });
    expect(mockPeopleSet).toHaveBeenCalledWith({
      is_anonymous: false,
      last_quiz_score: 90,
    });
  });

  it('resetIdentity calls posthog.reset', () => {
    resetIdentity();
    expect(mockReset).toHaveBeenCalled();
  });
});

describe('error resilience', () => {
  it('swallows capture errors without throwing', () => {
    mockCapture.mockImplementationOnce(() => {
      throw new Error('PostHog down');
    });
    expect(() => trackScreenView({ screen: 'home' })).not.toThrow();
  });

  it('swallows identify errors without throwing', () => {
    mockIdentify.mockImplementationOnce(() => {
      throw new Error('PostHog down');
    });
    expect(() => identifyUser('u1')).not.toThrow();
  });

  it('swallows people.set errors without throwing', () => {
    mockPeopleSet.mockImplementationOnce(() => {
      throw new Error('PostHog down');
    });
    expect(() => setPersonProperties({ x: 1 })).not.toThrow();
  });

  it('swallows reset errors without throwing', () => {
    mockReset.mockImplementationOnce(() => {
      throw new Error('PostHog down');
    });
    expect(() => resetIdentity()).not.toThrow();
  });
});

describe('trackAppError', () => {
  it('sends app_error with location and message', () => {
    trackAppError({ location: 'play_initialize', message: 'timeout' });
    expect(mockCapture).toHaveBeenCalledWith('app_error', {
      location: 'play_initialize',
      message: 'timeout',
    });
  });
});
