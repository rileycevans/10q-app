import Link from 'next/link';

/**
 * Links to the privacy policy and terms.
 *
 * App review checks that these are reachable from inside the app, not just at
 * a URL pasted into the store listing.
 */
export function LegalFooter() {
  return (
    <footer className="mt-8 mb-4 flex items-center justify-center gap-4 text-xs font-bold text-ink/60">
      <Link href="/privacy" className="hover:text-ink underline-offset-2 hover:underline">
        Privacy
      </Link>
      <span aria-hidden="true">·</span>
      <Link href="/terms" className="hover:text-ink underline-offset-2 hover:underline">
        Terms
      </Link>
    </footer>
  );
}
