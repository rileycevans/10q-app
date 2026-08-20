import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection } from '@/components/LegalPage';
import { SUPPORT_EMAIL } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Terms of Service | 10Q',
  description: 'The rules for playing 10Q.',
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="18 August 2026">
      <LegalSection heading="Playing 10Q">
        <p>
          10Q is a daily trivia game. A new quiz of ten questions is released
          every day at 11:30 UTC, and each player gets one attempt at it. By
          playing, you agree to these terms.
        </p>
        <p>
          The game is free. There is nothing to buy, and no subscription.
        </p>
      </LegalSection>

      <LegalSection heading="Your account">
        <p>
          You can play anonymously or sign in with Google or Apple. Signing in
          saves your progress across devices. You are responsible for what
          happens under your account, and for keeping access to the email
          address you sign in with.
        </p>
        <p>
          You can delete your account at any time from{' '}
          <Link href="/settings" className="underline font-bold">
            Settings
          </Link>
          . Deletion is permanent.
        </p>
      </LegalSection>

      <LegalSection heading="Handles and fair play">
        <p>
          Your handle is public and appears on leaderboards. Do not choose a
          handle that is obscene, hateful, harassing, impersonates someone else,
          or that a reasonable person would find offensive. We may change or
          remove a handle that breaks this rule, and may suspend accounts that
          do so repeatedly.
        </p>
        <p>
          Do not cheat. That includes automating play, using more than one
          account to game the leaderboards, interfering with other players, or
          trying to extract answers before you have submitted them. We may
          remove scores or accounts that do.
        </p>
        <p>
          If you see a handle that breaks these rules, report it using the
          report control on that player&apos;s profile, or email {SUPPORT_EMAIL}.
        </p>
      </LegalSection>

      <LegalSection heading="Leagues">
        <p>
          Anyone can create a private league and invite others. League owners
          can add and remove members. If a league owner deletes their account,
          ownership passes to the longest-standing remaining member so the
          league survives.
        </p>
      </LegalSection>

      <LegalSection heading="Our content">
        <p>
          The questions, artwork, and the 10Q name belong to us. You may share
          screenshots and your results freely, but please do not republish the
          question set as your own or use it to build a competing product.
        </p>
      </LegalSection>

      <LegalSection heading="Availability">
        <p>
          We try to publish a quiz every day and keep the game running, but we
          do not guarantee it. The game is provided as-is, without warranties.
          We are not liable for any loss arising from your use of it, to the
          extent the law allows.
        </p>
        <p>
          Quiz answers are researched carefully, but occasionally a question may
          be wrong or ambiguous. If you spot one, email {SUPPORT_EMAIL}.
        </p>
      </LegalSection>

      <LegalSection heading="Ending access">
        <p>
          You can stop playing and delete your account whenever you like. We may
          suspend or end access for accounts that break these terms.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          If we change these terms we will update the date at the top of this
          page. Continuing to play after a change means you accept it.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>Questions about these terms: {SUPPORT_EMAIL}</p>
      </LegalSection>
    </LegalPage>
  );
}
