/**
 * Contact address shown on the /privacy and /terms pages.
 *
 * TODO(launch): replace with a real, monitored inbox before submitting to the
 * App Store or Google Play. Both stores require a working contact address on
 * the privacy policy, and Google Play requires a reachable address for data
 * deletion requests. App review will email this address to verify it.
 *
 * Set NEXT_PUBLIC_SUPPORT_EMAIL to override without a code change.
 */
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@play10q.com';
