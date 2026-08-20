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
      */}
      <div className="relative z-10 max-w-[420px] mx-auto min-h-screen pt-safe-only px-safe">
        {children}
      </div>
    </div>
  );
}

