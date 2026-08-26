import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection } from '@/components/LegalPage';
import { SUPPORT_EMAIL } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Privacy Policy | 10Q',
  description: 'How 10Q collects, uses, and deletes your data.',
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="18 August 2026">
      <LegalSection heading="Who we are">
        <p>
          10Q is a daily trivia game available at play10q.com and as a mobile
          app. This policy explains what we collect, why, and how to get rid of
          it.
        </p>
      </LegalSection>

      <LegalSection heading="What we collect">
        <p>
          <strong>Account information.</strong> You can play anonymously, in
          which case we create an account identifier for you and nothing else.
          If you sign in with Google or Apple, we receive and store your email
          address and the account identifier from that provider. We never
          receive your password.
        </p>
        <p>
          <strong>Your handle.</strong> Every player gets an auto-generated
          handle, which you can customise. Handles are public: they appear on
          global leaderboards and in any league you join.
        </p>
        <p>
          <strong>Gameplay data.</strong> The answers you select, how long you
          took, your scores, your streaks, and which leagues you belong to.
        </p>
        <p>
          <strong>Analytics.</strong> We use PostHog to understand how the game
          is used — screens viewed, quizzes started and completed, sign-ins, and
          errors. When you sign in, your email address and account identifier
          are sent to PostHog so that this activity is associated with your
          account. Anonymous players are tracked only by a generated
          identifier.
        </p>
        <p>
          <strong>Crash and error reports.</strong> We use Sentry to capture
          errors. These reports can include the page you were on, your browser
          or device type, and a technical stack trace.
        </p>
      </LegalSection>

      <LegalSection heading="What we do not collect">
        <p>
          We do not collect your location, contacts, photos, or advertising
          identifiers. We do not serve ads, we do not sell your data, and we do
          not track you across other apps or websites.
        </p>
      </LegalSection>

      <LegalSection heading="Why we collect it">
        <p>
          To run the game: to show you the daily quiz, save your attempt so you
          can resume it, score it, and place you on leaderboards and in leagues.
          To keep the game working: to find and fix crashes and bugs. To
          understand what to improve: aggregate analytics about how the game is
          played.
        </p>
      </LegalSection>

      <LegalSection heading="Who we share it with">
        <p>
          We share data only with the services that make the game run:{' '}
          <strong>Supabase</strong> (database, authentication, and server
          functions), <strong>Cloudflare</strong> (hosting and content
          delivery), <strong>PostHog</strong> (product analytics, hosted in the
          United States), and <strong>Sentry</strong> (error monitoring). Each
          processes data on our behalf. We do not sell your data to anyone.
        </p>
        <p>
          Signing in with Google or Apple is handled by those providers under
          their own privacy policies.
        </p>
      </LegalSection>

      <LegalSection heading="Deleting your account and data">
        <p>
          You can permanently delete your account at any time from{' '}
          <Link href="/settings" className="underline font-bold">
            Settings
          </Link>
          , using the Delete Account button in the Danger Zone. Step-by-step
          instructions, including what to do if you can no longer sign in, are
          on the{' '}
          <Link href="/delete-account" className="underline font-bold">
            account deletion page
          </Link>
          .
        </p>
        <p>
          Deleting your account permanently removes your handle, scores,
          streaks, past attempts and answers, and your league memberships. If
          you own a league that still has other members, ownership passes to its
          longest-standing member so their league is not destroyed; if you are
          the only member, the league is deleted with your account.
        </p>
        <p>
          We keep a record that game events occurred, with your identity removed
          from them, so that historical game statistics remain accurate. These
          records can no longer be linked back to you.
        </p>
        <p>
          Deletion is immediate and cannot be undone. If you would rather have
          us do it for you, email {SUPPORT_EMAIL}.
        </p>
      </LegalSection>

      <LegalSection heading="How long we keep data">
        <p>
          We keep your account data for as long as your account exists. When you
          delete your account it is removed immediately, as described above.
          Backups are retained by our hosting providers for a short period and
          then overwritten.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          Depending on where you live, you may have the right to access,
          correct, export, or delete the personal data we hold about you, and to
          object to how we use it. You can delete your data yourself from
          Settings. For anything else, email {SUPPORT_EMAIL} and we will
          respond.
        </p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>
          10Q is not directed at children under 13, and we do not knowingly
          collect personal data from them. If you believe a child has created an
          account, email {SUPPORT_EMAIL} and we will delete it.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>
          If we change this policy we will update the date at the top of this
          page. Significant changes will be announced in the game.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>Questions about this policy or your data: {SUPPORT_EMAIL}</p>
      </LegalSection>
    </LegalPage>
  );
}
