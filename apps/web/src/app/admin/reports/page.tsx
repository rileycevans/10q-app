'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { supabase } from '@/lib/supabase/client';

/**
 * Moderation queue for reported handles.
 *
 * Access is gated by the admin layout and enforced again by RLS on
 * handle_reports (admin-only SELECT/UPDATE), so a non-admin hitting this route
 * directly gets an empty result rather than other players' reports.
 */

type ReportStatus = 'pending' | 'actioned' | 'dismissed';

interface HandleReport {
  id: string;
  reported_player_id: string;
  reported_handle: string;
  reporter_player_id: string | null;
  reason: string;
  details: string | null;
  status: ReportStatus;
  created_at: string;
  resolution_note: string | null;
  resolved_at: string | null;
}

const REASON_LABELS: Record<string, string> = {
  offensive: 'Offensive or hateful',
  impersonation: 'Impersonation',
  spam: 'Spam',
  other: 'Other',
};

const STATUS_STYLES: Record<ReportStatus, string> = {
  pending: 'bg-yellow',
  actioned: 'bg-green',
  dismissed: 'bg-paper',
};

export default function AdminReportsPage() {
  const [reports, setReports] = useState<HandleReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ReportStatus | 'all'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    let query = supabase
      .from('handle_reports')
      .select(
        'id, reported_player_id, reported_handle, reporter_player_id, reason, details, status, created_at, resolution_note, resolved_at'
      )
      .order('created_at', { ascending: false })
      .limit(200);

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data, error: queryError } = await query;

    if (queryError) {
      setError(queryError.message);
      setReports([]);
    } else {
      setReports((data as HandleReport[]) ?? []);
    }

    setLoading(false);
  }, [filter]);

  useEffect(() => {
    // Fetching the queue on mount and on filter change is the point of this
    // effect; the loading flag it sets is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function resolve(id: string, status: ReportStatus, note?: string) {
    setBusyId(id);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();

    const { error: updateError } = await supabase
      .from('handle_reports')
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id ?? null,
        resolution_note: note ?? null,
      })
      .eq('id', id);

    if (updateError) {
      setError(updateError.message);
    } else {
      await load();
    }

    setBusyId(null);
  }

  // Multiple reports against the same handle are the strongest signal that
  // something is actually wrong, so surface the count per handle.
  const countsByHandle = reports.reduce<Record<string, number>>((acc, r) => {
    acc[r.reported_player_id] = (acc[r.reported_player_id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="w-full max-w-3xl">
          <div className="flex items-center justify-between mb-6">
            <h1 className="font-display text-3xl text-ink">Handle Reports</h1>
            <Link
              href="/admin"
              className="h-10 px-4 flex items-center bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink"
            >
              Admin
            </Link>
          </div>

          <div className="flex gap-2 mb-6">
            {(['pending', 'actioned', 'dismissed', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`h-10 px-4 border-[3px] border-ink rounded-lg font-bold text-sm text-ink capitalize transition-transform duration-[120ms] active:translate-x-[1px] active:translate-y-[1px] ${
                  filter === f ? 'bg-cyanA shadow-sticker-sm' : 'bg-paper'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red border-[3px] border-ink rounded-lg">
              <p className="font-body text-sm font-bold text-ink">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 text-center">
              <p className="font-bold text-lg text-ink">Loading reports...</p>
            </div>
          ) : reports.length === 0 ? (
            <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 text-center">
              <p className="font-bold text-lg text-ink">
                {filter === 'pending'
                  ? 'Nothing to review — no pending reports.'
                  : `No ${filter} reports.`}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {reports.map((r) => (
                <div
                  key={r.id}
                  className="bg-paper border-[4px] border-ink rounded-[20px] shadow-sticker p-5"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <Link
                        href={`/u/${r.reported_handle}`}
                        className="font-display text-2xl text-ink break-words underline-offset-2 hover:underline"
                      >
                        {r.reported_handle}
                      </Link>
                      <p className="font-body text-xs text-ink/60 mt-1">
                        {new Date(r.created_at).toLocaleString()}
                        {countsByHandle[r.reported_player_id] > 1 && (
                          <span className="ml-2 font-bold text-ink">
                            · {countsByHandle[r.reported_player_id]} reports
                          </span>
                        )}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 px-3 py-1 border-[3px] border-ink rounded-full font-bold text-xs text-ink capitalize ${STATUS_STYLES[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </div>

                  <div className="mb-3">
                    <p className="font-body text-sm font-bold text-ink">
                      {REASON_LABELS[r.reason] ?? r.reason}
                    </p>
                    {r.details && (
                      <p className="mt-2 p-3 bg-ink/5 border-[2px] border-ink/20 rounded-lg font-body text-sm text-ink/90 whitespace-pre-wrap break-words">
                        {r.details}
                      </p>
                    )}
                    {!r.reporter_player_id && (
                      <p className="mt-2 font-body text-xs text-ink/50">
                        Reporter has since deleted their account.
                      </p>
                    )}
                  </div>

                  {r.status === 'pending' ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => resolve(r.id, 'dismissed', 'No action needed')}
                        className="flex-1 h-11 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50"
                      >
                        {busyId === r.id ? 'Saving...' : 'Dismiss'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => resolve(r.id, 'actioned', 'Handle actioned')}
                        className="flex-1 h-11 bg-green border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50"
                      >
                        {busyId === r.id ? 'Saving...' : 'Mark actioned'}
                      </button>
                    </div>
                  ) : (
                    <p className="font-body text-xs text-ink/60">
                      {r.resolution_note}
                      {r.resolved_at &&
                        ` · ${new Date(r.resolved_at).toLocaleDateString()}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Renaming a handle is a destructive action on someone else's
              account, so it is deliberately not a button here — it is done
              deliberately in the Supabase dashboard. */}
          <p className="mt-6 font-body text-xs text-ink/50 text-center">
            To rename or remove an offending handle, update the player in the
            Supabase dashboard, then mark the report actioned.
          </p>
        </div>
      </div>
    </ArcadeBackground>
  );
}
