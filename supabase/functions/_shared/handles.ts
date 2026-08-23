/**
 * Xbox-style handle generation (for Edge Functions)
 * Pattern: {adjective}{noun}{number}
 * Inlined version for Deno compatibility
 */

const ADJECTIVES = [
  'Swift', 'Bold', 'Clever', 'Mighty', 'Brave', 'Fierce', 'Noble', 'Wise',
  'Quick', 'Sharp', 'Bright', 'Dark', 'Wild', 'Calm', 'Silent', 'Loud',
  'Fast', 'Slow', 'Strong', 'Gentle', 'Proud', 'Humble', 'Ancient', 'Young',
  'Golden', 'Silver', 'Iron', 'Steel', 'Crimson', 'Azure', 'Emerald', 'Amber',
  'Thunder', 'Storm', 'Fire', 'Ice', 'Shadow', 'Light', 'Mystic', 'Sacred',
  'Frozen', 'Burning', 'Flying', 'Running', 'Hidden', 'Seen', 'Lost', 'Found',
  'Lone', 'Twin', 'Triple', 'Single'
];

const NOUNS = [
  'Tiger', 'Eagle', 'Wolf', 'Phoenix', 'Dragon', 'Lion', 'Bear', 'Hawk',
  'Falcon', 'Raven', 'Fox', 'Panther', 'Jaguar', 'Leopard', 'Cobra', 'Viper',
  'Shark', 'Orca', 'Dolphin', 'Whale', 'Stallion', 'Mustang', 'Stallion', 'Mare',
  'Warrior', 'Knight', 'Ranger', 'Hunter', 'Scout', 'Guardian', 'Sentinel', 'Warden',
  'Blade', 'Arrow', 'Shield', 'Sword', 'Axe', 'Spear', 'Bow', 'Crossbow',
  'Storm', 'Thunder', 'Lightning', 'Wind', 'Flame', 'Frost', 'Void', 'Star',
  'Moon', 'Sun', 'Comet', 'Nebula', 'Galaxy', 'Planet', 'Asteroid', 'Meteor'
];

/**
 * Generate a random Xbox-style handle
 * Format: {adjective}{noun}{number}
 */
export function generateXboxStyleHandle(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  
  return `${adjective}${noun}${number}`;
}

/**
 * Validate handle format
 */
export function validateHandle(handle: string): { valid: boolean; error?: string } {
  if (!handle || typeof handle !== 'string') {
    return { valid: false, error: 'Handle is required' };
  }

  const trimmed = handle.trim();

  if (trimmed.length < 3) {
    return { valid: false, error: 'Handle must be at least 3 characters' };
  }

  if (trimmed.length > 20) {
    return { valid: false, error: 'Handle must be 20 characters or less' };
  }

  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(trimmed)) {
    return { valid: false, error: 'Handle must start with a letter and contain only letters and numbers' };
  }

  return { valid: true };
}

/**
 * Convert handle to canonical form (lowercase)
 */
export function canonicalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}


/**
 * Create a player row with a generated handle, retrying on collision.
 *
 * Auto-handles used to be `Player` + the first 8 hex characters of the auth
 * UUID — published on the global leaderboard, where they are a stable
 * fragment of a user identifier that nobody chose to share. The generated
 * form carries no user data at all.
 *
 * `handle_canonical` is UNIQUE, so a collision fails the insert rather than
 * silently sharing a handle. ~291k combinations makes that unlikely, but
 * unlikely over enough signups is a support ticket someone cannot resolve —
 * so retry with a fresh name instead.
 */
export async function createPlayerWithGeneratedHandle(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  extraColumns: Record<string, unknown> = {},
  maxAttempts = 5,
): Promise<{ ok: true; handle: string } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const handleDisplay = generateXboxStyleHandle();
    const handleCanonical = canonicalizeHandle(handleDisplay);

    const { error } = await supabase.from("players").insert({
      id: userId,
      handle_display: handleDisplay,
      handle_canonical: handleCanonical,
      ...extraColumns,
    });

    if (!error) return { ok: true, handle: handleDisplay };

    // 23505 is unique_violation. Anything else is a real failure and
    // retrying with a different name will not help.
    if (error.code !== "23505") {
      return { ok: false, error: error.message };
    }
  }

  return {
    ok: false,
    error: `Could not find an unused handle after ${maxAttempts} attempts`,
  };
}
