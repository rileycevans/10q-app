'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { ArcadeBackground } from '@/components/ArcadeBackground';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.app_metadata?.role !== 'admin') {
        router.replace('/');
        return;
      }
      setAuthorized(true);
      setLoading(false);
    }
    checkAdmin();
  }, [router]);

  if (loading || !authorized) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Checking access...</p>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  return <>{children}</>;
}
