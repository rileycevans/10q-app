'use client';

import { useState } from 'react';
import { reportHandle, type ReportReason } from '@/domains/profile';
import { trackHandleReported, trackAppError } from '@/lib/analytics';
import { useModalA11y } from './useModalA11y';

const REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'offensive', label: 'Offensive or hateful' },
  { value: 'impersonation', label: 'Impersonating someone' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'other', label: 'Something else' },
];

const MAX_DETAILS = 500;

/**
 * Lets a player report another player's handle.
 *
 * Handles are public on leaderboards, which makes them user-generated content
 * under App Store Guideline 1.2 and Google Play's UGC policy; both expect a
 * reporting path reachable from where the content appears.
 */
export function ReportHandleModal({
  handle,
  isOpen,
  onClose,
}: {
  handle: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const dialogRef = useModalA11y(isOpen, onClose);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  function reset() {
    setReason(null);
    setDetails('');
    setSubmitting(false);
    setSubmitted(false);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!reason || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await reportHandle(handle, reason, details.trim() || undefined);
      trackHandleReported({ reason });
      setSubmitted(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit report';
      setError(message);
      trackAppError({ location: 'report_handle', message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink/50" onClick={handleClose} />

      {/* Stop clicks inside the panel from reaching the backdrop's close
          handler. React events bubble through the component tree rather than
          the DOM tree, so without this a click on Send also dismisses the
          modal and the confirmation is never shown. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Report Modal"
        tabIndex={-1}
        className="relative bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-ink hover:bg-ink/10 rounded-full"
        >
          ✕
        </button>

        {submitted ? (
          <div className="text-center py-4">
            <h2 className="font-display text-2xl font-bold text-ink mb-3 uppercase tracking-wide">
              Report sent
            </h2>
            <p className="font-body text-sm text-ink/80 mb-6">
              Thanks — we&apos;ll review this handle. You won&apos;t hear back
              directly, but we look at every report.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="w-full h-12 bg-cyanA border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 className="font-display text-2xl font-bold text-ink mb-2 uppercase tracking-wide">
              Report handle
            </h2>
            <p className="font-body text-sm text-ink/80 mb-4 break-words">
              Reporting <span className="font-bold">{handle}</span>
            </p>

            <fieldset className="mb-4">
              <legend className="block font-bold text-xs uppercase tracking-wide text-ink mb-2">
                Why are you reporting this?
              </legend>
              <div className="flex flex-col gap-2">
                {REASONS.map((r) => (
                  <label
                    key={r.value}
                    className={`flex items-center gap-3 p-3 border-[3px] border-ink rounded-lg cursor-pointer transition-colors ${
                      reason === r.value ? 'bg-cyanA' : 'bg-paper hover:bg-ink/5'
                    }`}
                  >
                    <input
                      type="radio"
                      name="report-reason"
                      value={r.value}
                      checked={reason === r.value}
                      onChange={() => {
                        setReason(r.value);
                        setError(null);
                      }}
                      disabled={submitting}
                      className="w-4 h-4 accent-ink"
                    />
                    <span className="font-body font-bold text-sm text-ink">
                      {r.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mb-4">
              <label
                htmlFor="report-details"
                className="block font-bold text-xs uppercase tracking-wide text-ink mb-2"
              >
                Anything else? (optional)
              </label>
              <textarea
                id="report-details"
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, MAX_DETAILS))}
                disabled={submitting}
                rows={3}
                maxLength={MAX_DETAILS}
                className="w-full px-3 py-2 bg-paper border-[3px] border-ink rounded-lg font-body text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-[3px] focus:ring-cyanA focus:ring-offset-2 disabled:opacity-50 resize-none"
                placeholder="Add context if it helps"
              />
              <p className="mt-1 font-body text-xs text-ink/50 text-right">
                {details.length}/{MAX_DETAILS}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red border-[3px] border-ink rounded-lg">
                <p className="font-body text-sm font-bold text-ink">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                className="flex-1 h-12 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!reason || submitting}
                className="flex-1 h-12 bg-red border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Sending...' : 'Send report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
