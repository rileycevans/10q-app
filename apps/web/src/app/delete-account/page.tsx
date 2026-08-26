import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection } from '@/components/LegalPage';
import { SUPPORT_EMAIL } from '@/lib/legal';

/**
 * The web-accessible deletion page Google Play requires: reachable without
 * installing the app, prominently about account deletion, and naming the app.
 * This URL goes in the Play Data Safety form verbatim.
 *
 * play10q.com is the same application as the store builds, so the in-app
 * deletion path IS available here — the page's job is to walk someone to it,
 * and to give people who cannot sign in a way that still works.
 */

export const metadata: Metadata = {
  title: 'Delete Your Account | 10Q',
  description:
    'How to permanently delete your 10Q account and all associated data.',
};

export default function DeleteAccountPage() {
  return (
    <LegalPage title="Delete Your Account" lastUpdated="26 August 2026">
      <LegalSection heading="Delete your 10Q account">
        <p>
          You can permanently delete your 10Q account and its data at any time,
          right here on this site — no app install needed. Deletion is
          immediate and cannot be undone.
        </p>
        <ol className="list-decimal pl-6 space-y-2 font-bold">
          <li>
            <Link href="/settings" className="underline">
              Open Settings
            </Link>{' '}
            and sign in if you are not already.
          </li>
          <li>Scroll to the Danger Zone and press Delete Account.</li>
          <li>
            Type <strong>DELETE</strong> to confirm.
          </li>
        </ol>
        <p>
          The same steps work inside the iOS and Android apps, under Settings.
        </p>
      </LegalSection>

      <LegalSection heading="What gets deleted">
        <p>
          Your handle, scores, streaks, past attempts and answers, and your
          league memberships are permanently removed. If you own a league that
          still has other members, ownership passes to its longest-standing
          member so their league is not destroyed; if you are the only member,
          the league is deleted with your account.
        </p>
        <p>
          We keep a record that game events occurred, with your identity
          removed, so historical statistics stay accurate. Full details are in
          the{' '}
          <Link href="/privacy" className="underline font-bold">
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Can't sign in?">
        <p>
          If you no longer have access to the account — a lost sign-in method,
          a device you no longer own — email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline font-bold">
            {SUPPORT_EMAIL}
          </a>{' '}
          from the address associated with your account, or include your player
          handle. We will verify the request and delete the account for you.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
