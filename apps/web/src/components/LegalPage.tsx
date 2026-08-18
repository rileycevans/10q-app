import Link from 'next/link';
import { ArcadeBackground } from '@/components/ArcadeBackground';

/**
 * Shared shell for the /privacy and /terms pages.
 *
 * These are server-rendered with no client JS: both app stores fetch the
 * privacy policy URL during review, and Google Play additionally requires the
 * account-deletion disclosure to be reachable without signing in.
 */
export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 sm:p-8 w-full max-w-2xl">
          <h1 className="font-display text-3xl mb-2 text-ink text-center">{title}</h1>
          <p className="font-body text-sm text-ink/60 text-center mb-8">
            Last updated: {lastUpdated}
          </p>

          <div className="space-y-6 font-body text-ink">{children}</div>

          <Link
            href="/"
            className="mt-8 flex items-center justify-center w-full h-12 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
          >
            Go Home
          </Link>
        </div>
      </div>
    </ArcadeBackground>
  );
}

/** Section heading + body, so both legal pages stay visually consistent. */
export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl font-bold text-ink mb-3">{heading}</h2>
      <div className="space-y-3 text-base leading-relaxed text-ink/90">{children}</div>
    </section>
  );
}
