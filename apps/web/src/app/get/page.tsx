import type { Metadata } from 'next';
import { GetAppClient } from './GetAppClient';

/**
 * The link every shared score points at.
 *
 * One URL that resolves correctly for whoever taps it: the App Store on an
 * iPhone, Play on Android, the playable site on a desktop. A raw store URL in
 * the share text would be a dead end for roughly half of recipients, and it
 * could never be corrected — the text is baked into installed binaries.
 */

export const metadata: Metadata = {
  title: 'Get 10Q',
  description:
    'Play 10Q — 10 questions, one attempt, a new quiz every day at 11:30 UTC.',
};

export default function GetPage() {
  return <GetAppClient />;
}
