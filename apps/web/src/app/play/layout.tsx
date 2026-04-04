'use client';

import { GameProvider } from '@/components/GameProvider';

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return <GameProvider>{children}</GameProvider>;
}
