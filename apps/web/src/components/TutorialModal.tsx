'use client';

/**
 * First-run tutorial modal.
 *
 * Four steps, all soft-dismissible (backdrop click or × closes):
 *  1. Welcome
 *  2. Sign in (provider buttons)
 *  3. Pick a username
 *  4. All set (confirmation + "Start Quiz" CTA)
 *
 * Dismissing without completing leaves localStorage state intact, so the
 * tutorial will reopen on the next visit until the anonymous-view budget
 * (see lib/tutorial.ts) is exhausted or the user signs in.
 *
 * Resume behavior: between steps 2 and 3 the browser does a full OAuth
 * round-trip. We set tutorial_resume='handle' before the redirect; on the
 * post-redirect home-page mount, tutorialOnMount returns 'resume_handle'
 * and the modal opens directly at step 3.
 */

import { useEffect, useState } from 'react';
import { validateHandle } from '@10q/contracts';
import { updateHandle } from '@/domains/profile';
import { OAuthButtons } from '@/components/SignInModal';
import {
  buildOAuthRedirect,
  startOAuth,
  type OAuthProvider,
} from '@/lib/auth/oauth';
import {
  consumeResumeHint,
  markCompletedForUser,
  setResumeAfterOAuth,
} from '@/lib/tutorial';

type Step = 'welcome' | 'signin' | 'handle' | 'done';

interface TutorialModalProps {
  /** Whether the tutorial is open. Driven by the home page from `tutorialOnMount`. */
  isOpen: boolean;
  /** Initial step. 'welcome' for fresh starts; 'handle' for post-OAuth resume. */
  initialStep: Step;
  /** Called when the modal closes (any soft-dismiss or completion). */
  onClose: () => void;
}

export function TutorialModal(props: TutorialModalProps) {
  if (!props.isOpen) return null;
  // Key on initialStep so a change (e.g. post-OAuth remount opens at
  // 'handle' instead of 'welcome') restarts the inner state at the new
  // step. Without the key, useState(initialStep) only honors the *first*
  // initialStep value the component sees.
  return <TutorialModalInner key={props.initialStep} {...props} />;
}

function TutorialModalInner({ initialStep, onClose }: TutorialModalProps) {
  const [step, setStep] = useState<Step>(initialStep);

  // Clear the resume hint once we've actually opened at the resumed step
  // so the next mount doesn't re-trigger the resume.
  useEffect(() => {
    if (initialStep === 'handle') {
      consumeResumeHint();
    }
  }, [initialStep]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-ink hover:bg-ink/10 rounded-full"
          aria-label="Close tutorial"
        >
          ✕
        </button>

        <StepIndicator step={step} />

        {step === 'welcome' && <WelcomeStep onNext={() => setStep('signin')} />}
        {step === 'signin' && <SignInStep />}
        {step === 'handle' && (
          <HandleStep
            onSaved={() => setStep('done')}
            onSkip={() => {
              markCompletedForUser();
              onClose();
            }}
          />
        )}
        {step === 'done' && (
          <DoneStep
            onClose={() => {
              markCompletedForUser();
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  // 'done' is a confirmation, not a numbered step — collapse it under 3/3.
  const index = step === 'welcome' ? 1 : step === 'signin' ? 2 : 3;
  return (
    <div className="flex items-center justify-center gap-2 mb-4">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className={`h-2 w-8 rounded-full border-[2px] border-ink ${
            n <= index ? 'bg-cyanA' : 'bg-paper'
          }`}
        />
      ))}
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <h2 className="font-display text-2xl font-bold text-ink mb-2 text-center uppercase tracking-wide">
        Welcome to 10Q!
      </h2>
      <p className="font-body text-sm text-ink/70 text-center mb-6">
        A short setup so your scores, streak, and leaderboard rank stick
        around. Two steps — sign in, then pick a username.
      </p>
      <button
        type="button"
        onClick={onNext}
        className="w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
      >
        LET&apos;S GO
      </button>
    </>
  );
}

function SignInStep() {
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);

  // Anchor the redirect to /, so post-OAuth the user lands on the home
  // page where tutorialOnMount can pick up the resume hint and open at
  // the handle step.
  const redirectTo = buildOAuthRedirect();

  const handleOAuth = async (provider: OAuthProvider) => {
    setLoadingProvider(provider);
    // Set the resume hint *before* awaiting OAuth — the redirect can fire
    // synchronously from Supabase's helper, and if we set this after, the
    // hint wouldn't survive.
    setResumeAfterOAuth('handle');
    try {
      await startOAuth(provider, redirectTo);
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <>
      <h2 className="font-display text-2xl font-bold text-ink mb-2 text-center uppercase tracking-wide">
        Sign in
      </h2>
      <p className="font-body text-sm text-ink/70 text-center mb-6">
        Pick a provider — this saves your scores so you can come back
        tomorrow without losing your streak.
      </p>
      <OAuthButtons
        onSelect={handleOAuth}
        loadingProvider={loadingProvider}
        disabled={loadingProvider !== null}
      />
      {/* No skip / no × — see TutorialModal docblock for why. */}
    </>
  );
}

/**
 * Embedded copy of HandleNudgeModal's body. We don't reuse the
 * HandleNudgeModal component itself because it ships its own backdrop +
 * dismiss × that would conflict with the tutorial's own chrome. The form
 * logic is identical.
 */
function HandleStep({
  onSaved,
  onSkip,
}: {
  onSaved: () => void;
  onSkip: () => void;
}) {
  const [handle, setHandle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = handle.trim() ? validateHandle(handle.trim()) : null;
  const canSubmit = validation?.valid && !saving;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await updateHandle(handle.trim());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save handle');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2 className="font-display text-2xl font-bold text-ink mb-2 text-center uppercase tracking-wide">
        Pick a username
      </h2>
      <p className="font-body text-sm text-ink/70 text-center mb-6">
        How you&apos;ll appear on leaderboards and to friends. You can
        change it later from Settings.
      </p>

      <div className="mb-4">
        <input
          type="text"
          value={handle}
          onChange={(e) => { setHandle(e.target.value); setError(null); }}
          placeholder="Pick a username..."
          maxLength={20}
          className="w-full h-12 px-4 bg-paper border-[3px] border-ink rounded-lg font-body font-bold text-base text-ink placeholder:text-ink/40 focus:outline-none focus:ring-[3px] focus:ring-cyanA"
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          autoFocus
        />
        {handle.trim() && validation && !validation.valid && (
          <p className="mt-2 text-xs font-bold text-red">{validation.error}</p>
        )}
        {error && (
          <p className="mt-2 text-xs font-bold text-red">{error}</p>
        )}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full h-14 bg-green border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'SAVING...' : 'SAVE USERNAME'}
      </button>

      <button
        type="button"
        onClick={onSkip}
        className="w-full mt-3 text-sm font-bold text-ink/50 hover:text-ink/80 transition-colors text-center py-2"
      >
        Maybe later
      </button>
    </>
  );
}

function DoneStep({ onClose }: { onClose: () => void }) {
  return (
    <>
      <h2 className="font-display text-2xl font-bold text-ink mb-2 text-center uppercase tracking-wide">
        All set!
      </h2>
      <p className="font-body text-sm text-ink/70 text-center mb-6">
        You&apos;re ready to play today&apos;s quiz. Good luck!
      </p>
      <button
        type="button"
        onClick={onClose}
        className="w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
      >
        START QUIZ
      </button>
    </>
  );
}
