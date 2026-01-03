interface ArcadeBackgroundProps {
  children: React.ReactNode;
  className?: string;
}

export function ArcadeBackground({ children, className = '' }: ArcadeBackgroundProps) {
  return (
    <div className={`bg-arcade ${className}`}>
      <div className="relative z-10 max-w-[420px] mx-auto min-h-screen">
        {children}
      </div>
    </div>
  );
}

