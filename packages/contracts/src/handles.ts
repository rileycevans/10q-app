/**
 * Xbox-style handle generation
 * Pattern: {adjective}{noun}{number}
 * Examples: SwiftTiger42, BoldEagle17, CleverWolf93
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
 * Rules:
 * - 3-20 characters
 * - Alphanumeric only (no spaces, special chars)
 * - Must start with letter
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

