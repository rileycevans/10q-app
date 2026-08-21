interface ArcadeBackgroundProps {
  children: React.ReactNode;
  className?: string;
}

export function ArcadeBackground({ children, className = '' }: ArcadeBackgroundProps) {
  return (
    <div className={`bg-arcade ${className}`}>
      {/*
        Top and side insets live here because this wraps nearly every screen —
        one place instead of a padding rule per page. Bottom is deliberately
        not included: screens that pin something to the bottom edge need the
        inset on that element, not on the scroll container.

        `flex flex-col` matters on a notched device. min-h-screen is 100dvh
        and pt-safe-only adds the notch inset INSIDE that box, so the content
        ended up taller than the viewport by the height of the inset and the
        BottomDock sat below the fold — visible on an iPhone, invisible in a
        desktop viewport where the inset is 0. As a flex column the children
        share the available height instead of overflowing it.

        `h-full min-h-0`, not `min-h-screen`. A min-height is only a floor —
        the box still grew to fit its content, so 59px of notch padding plus a
        762px column made 821px against an 812px viewport and the dock was
        clipped. `h-full` takes exactly the parent's height (bg-arcade is now
        100dvh), and `min-h-0` releases the flexbox default that stops a flex
        item shrinking below its content, which is what let the overflow
        happen in the first place.
      */}
      <div className="relative z-10 max-w-[420px] mx-auto h-full min-h-0 flex flex-col pt-safe-only px-safe">
        {children}
      </div>
    </div>
  );
}

