import { MAX_QUESTIONS_PER_QUIZ } from '@10q/contracts';
import { QuestionPageClient } from './ClientPage';

/**
 * The one dynamic route that survives static export.
 *
 * Every quiz is exactly MAX_QUESTIONS_PER_QUIZ questions, so unlike league ids
 * or handles the full set of paths is known at build time — /play/q/1 through
 * /play/q/10 are emitted as real pages.
 *
 * This file is a server component purely so it can export
 * generateStaticParams; all the behaviour lives in ClientPage.
 */
export function generateStaticParams() {
  return Array.from({ length: MAX_QUESTIONS_PER_QUIZ }, (_, i) => ({
    index: String(i + 1),
  }));
}

/**
 * Anything outside the generated set is a 404 rather than a server render.
 * On web that was a soft redirect; in an app bundle there is no server to
 * fall back to, so the set must be closed.
 */
export const dynamicParams = false;

export default async function QuestionPage({
  params,
}: {
  params: Promise<{ index: string }>;
}) {
  const { index } = await params;
  return <QuestionPageClient index={parseInt(index, 10)} />;
}
