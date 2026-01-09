'use client';

import type { LeagueMember } from '@/domains/league';

interface LeagueMemberListProps {
  members: LeagueMember[];
  isOwner: boolean;
  onRemove?: (playerId: string) => void;
  currentUserId?: string | null;
}

export function LeagueMemberList({
  members,
  isOwner,
  onRemove,
  currentUserId,
}: LeagueMemberListProps) {
  if (members.length === 0) {
    return (
      <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 text-center">
        <p className="font-body text-sm text-ink/80">No members yet</p>
      </div>
    );
  }

  return (
    <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-4 w-full">
      <h3 className="font-display text-lg font-bold text-ink mb-4">Members</h3>
      <div className="space-y-2">
        {members.map((member) => (
          <div
            key={member.player_id}
            className="flex items-center justify-between py-2 px-3 rounded-lg border-[3px] border-ink bg-paper"
          >
            <div className="flex items-center gap-3">
              <span className="font-body font-bold text-base text-ink">
                {member.handle_display}
              </span>
              {member.player_id === currentUserId && (
                <span className="text-xs bg-ink text-paper px-2 py-0.5 rounded-full border-[2px] border-ink">
                  YOU
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`px-2 py-1 rounded-full border-[2px] border-ink font-bold text-xs ${
                  member.role === 'owner'
                    ? 'bg-yellow text-ink'
                    : 'bg-cyanA text-ink'
                }`}
              >
                {member.role === 'owner' ? 'OWNER' : 'MEMBER'}
              </span>
              {isOwner &&
                member.role !== 'owner' &&
                onRemove &&
                member.player_id !== currentUserId && (
                  <button
                    onClick={() => onRemove(member.player_id)}
                    className="h-8 px-3 bg-red border-[2px] border-ink rounded-lg shadow-sticker-sm font-bold text-xs text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
                  >
                    Remove
                  </button>
                )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

