/**
 * League name validation.
 *
 * League names are the second user-generated content surface in 10Q (the first
 * is handles) and the more permissive one: free text up to 100 characters,
 * visible to every member of the league. Apple Guideline 1.2 and Google Play's
 * UGC policy both require objectionable content to be filtered before it goes
 * live, so this runs the same blocklist that guards handles.
 *
 * The blocklist itself was built for handles, which are `[a-zA-Z][a-zA-Z0-9]*`
 * — no spaces, no punctuation, no non-ASCII. Free text is not, and every
 * evasion that shape rules out is available here: "F.U.C.K United",
 * "shit_lords", Cyrillic lookalikes, zero-width joiners, full-width forms.
 * So names are normalised to a comparable ASCII skeleton *before* matching,
 * and the raw value is stored unchanged.
 */

import { containsBlockedContent } from './handle-blocklist';

export const LEAGUE_NAME_MAX_LENGTH = 100;
export const LEAGUE_NAME_MIN_LENGTH = 2;

/**
 * Characters that carry no meaning in a league name but let a blocked term slip
 * past a matcher: zero-width joiners/spaces, bidi overrides, soft hyphens.
 * Stripped entirely rather than mapped to a space — "sh<ZWSP>it" is "shit".
 */
const INVISIBLE_CHARS =
  /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/**
 * Confusable Latin lookalikes, chiefly Cyrillic and Greek. Deliberately small
 * and hand-picked: a full confusables table is large and mostly irrelevant
 * here, and over-mapping risks corrupting legitimate non-English names.
 */
const CONFUSABLES: Record<string, string> = {
  'а': 'a', 'ᴀ': 'a', 'ɑ': 'a', 'α': 'a',
  'ᴄ': 'c', 'с': 'c', 'ϲ': 'c',
  'е': 'e', 'ᴇ': 'e', 'ε': 'e',
  'ɡ': 'g', 'ɢ': 'g',
  'һ': 'h', 'ʜ': 'h',
  'і': 'i', 'ı': 'i', 'ɪ': 'i', 'ι': 'i',
  'ј': 'j',
  'ᴋ': 'k', 'κ': 'k',
  'ʟ': 'l', 'ɭ': 'l',
  'ᴍ': 'm', 'м': 'm',
  'ɴ': 'n', 'п': 'n',
  'о': 'o', 'ᴏ': 'o', 'ο': 'o', 'σ': 'o',
  'р': 'p', 'ᴘ': 'p', 'ρ': 'p',
  'ԛ': 'q',
  'ʀ': 'r', 'г': 'r',
  'ѕ': 's', 'ꜱ': 's',
  'т': 't', 'ᴛ': 't', 'τ': 't',
  'ᴜ': 'u', 'υ': 'u',
  'ᴠ': 'v', 'ν': 'v',
  'ᴡ': 'w', 'ш': 'w',
  'х': 'x', 'χ': 'x',
  'у': 'y', 'ʏ': 'y', 'γ': 'y',
  'ᴢ': 'z',
};

/**
 * Reduce a free-text name to the ASCII-ish skeleton the blocklist expects.
 *
 * Used only for matching — never for storage or display. Deliberately lossy:
 * the goal is that every spelling of a blocked word collapses onto the same
 * string, not that the output is readable.
 */
export function normaliseLeagueNameForMatching(name: string): string {
  return name
    // Decompose accents so "ｆ" and "é" fold to their base letters.
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(INVISIBLE_CHARS, '')
    .split('')
    .map((ch) => CONFUSABLES[ch] ?? CONFUSABLES[ch.toLowerCase()] ?? ch)
    .join('')
    // Punctuation and symbols become word separators, so "F.U.C.K" and
    // "shit_lords" present to the matcher the same way "Shit Lords" does.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type LeagueNameValidation =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Validate a league name for shape and content.
 *
 * Content failures return a deliberately vague message. Naming the matched
 * term would tell someone probing the filter exactly what to work around,
 * the same reasoning as `validateHandle`.
 */
export function validateLeagueName(name: unknown): LeagueNameValidation {
  if (typeof name !== 'string') {
    return { valid: false, error: 'League name is required' };
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'League name is required' };
  }

  if (trimmed.length < LEAGUE_NAME_MIN_LENGTH) {
    return {
      valid: false,
      error: `League name must be at least ${LEAGUE_NAME_MIN_LENGTH} characters`,
    };
  }

  if (trimmed.length > LEAGUE_NAME_MAX_LENGTH) {
    return {
      valid: false,
      error: `League name must be ${LEAGUE_NAME_MAX_LENGTH} characters or less`,
    };
  }

  // Control characters would let a name break log output or a terminal.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return { valid: false, error: 'League name contains invalid characters' };
  }

  // A name has to contain something pronounceable. Blocks pure-emoji and
  // pure-punctuation names, which are unmoderatable and unsearchable.
  const normalised = normaliseLeagueNameForMatching(trimmed);
  if (!/\p{L}/u.test(normalised)) {
    return { valid: false, error: 'League name must contain letters' };
  }

  if (containsBlockedContent(normalised)) {
    return {
      valid: false,
      error: "That league name isn't available. Please choose another.",
    };
  }

  // "F.U.C.K United" normalises to "F U C K United" — correct, but it spreads
  // the word into single letters and the blocklist matches whole words. Rejoin
  // runs of isolated letters so the spelled-out form is checked too.
  const deSpaced = collapseSingleLetterRuns(normalised);
  if (deSpaced !== normalised && containsBlockedContent(deSpaced)) {
    return {
      valid: false,
      error: "That league name isn't available. Please choose another.",
    };
  }

  return { valid: true };
}

/**
 * Join runs of three or more single-letter tokens into one word, so
 * "F U C K United" also presents as "FUCK United".
 *
 * Three is the threshold because two-letter runs are common in legitimate
 * names ("A B Quiz Team", initials) and joining them invents words that were
 * never there.
 */
function collapseSingleLetterRuns(value: string): string {
  const tokens = value.split(' ');
  const out: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length >= 3) {
      out.push(run.join(''));
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const token of tokens) {
    if (token.length === 1 && /\p{L}/u.test(token)) {
      run.push(token);
    } else {
      flush();
      out.push(token);
    }
  }
  flush();

  return out.join(' ').replace(/\s+/g, ' ').trim();
}
