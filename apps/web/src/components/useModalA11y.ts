'use client';

import { useEffect, useRef } from 'react';

/**
 * Keyboard and screen-reader behaviour for a modal.
 *
 * The app's five modals are plain divs today: no role, no focus management,
 * no Escape. For a keyboard user that means Tab walks straight out of the
 * dialog and into the page behind it — which is still there, still focusable,
 * and visually covered — with no way back and no way to close.
 *
 * Handles the three things a dialog owes its user:
 *   - identity: role="dialog" aria-modal="true" (applied by the caller)
 *   - containment: Tab and Shift+Tab cycle within the dialog
 *   - escape: Esc closes, and focus returns where it came from
 *
 * Returns a ref to attach to the dialog element.
 */
export function useModalA11y(isOpen: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const node = ref.current;
    // Where focus was before the dialog opened, so it can be handed back.
    // Losing this is what strands a keyboard user at the top of the document.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    // Move focus in, so the first Tab lands inside rather than behind.
    const first = focusable()[0];
    (first ?? node)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends rather than letting focus escape the dialog.
      if (e.shiftKey && active === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Only restore if focus is still somewhere in the dialog; if something
      // else has deliberately taken it, do not steal it back.
      if (!node || node.contains(document.activeElement)) {
        previouslyFocused?.focus?.();
      }
    };
  }, [isOpen, onClose]);

  return ref;
}
