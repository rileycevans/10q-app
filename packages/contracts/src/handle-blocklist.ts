/**
 * Handle content filtering.
 *
 * Handles are public: they appear on global leaderboards and in leagues, which
 * makes them user-generated content under App Store Guideline 1.2 and Google
 * Play's user-generated content policy. Both expect a filter for objectionable
 * content in addition to a way to report what slips through.
 *
 * This is deliberately a small, high-confidence list rather than an exhaustive
 * profanity filter. Handles are alphanumeric with no separators, so substring
 * matching produces false positives that are worse than the misses: the classic
 * "Scunthorpe problem" would reject a legitimate handle and the player has no
 * idea why. Two rules keep that in check:
 *
 *   1. Slurs and sexual terms match as substrings — there is no innocent handle
 *      containing them, and they are what actually has to be kept off a
 *      leaderboard.
 *   2. Milder profanity matches only as a whole word or with digits around it
 *      ("Shit", "Shit42"), so "Bassist", "Assassin", "Cocktail", "Analyst" and
 *      "Titan" are all accepted.
 *
 * Anything this misses is caught by user reports, which is the other half of
 * the requirement.
 */

/**
 * Terms with no legitimate use inside a handle. Matched anywhere in the string.
 * Deliberately covers leetspeak after normalisation (see normaliseForMatching).
 */
const SUBSTRING_BLOCKED = [
  // Racial and ethnic slurs
  'nigger', 'nigga', 'chink', 'spic', 'kike', 'gook', 'wetback', 'coon',
  'paki', 'raghead', 'towelhead', 'beaner',
  // Homophobic and transphobic slurs
  'faggot', 'fagot', 'tranny', 'shemale',
  // Ableist slurs
  'retard',
  // Sexual content
  // NB: "cunt" is NOT here — it is the canonical Scunthorpe case, so it is
  // word-matched in WORD_BLOCKED instead.
  'blowjob', 'handjob', 'creampie', 'cumshot', 'dildo', 'felch',
  'rimjob', 'bukkake', 'hentai', 'fleshlight',
  // Sexual content involving minors, and related terms
  'pedo', 'paedo', 'childporn', 'cp0rn', 'jailbait', 'lolicon', 'shotacon',
  // Extremist references
  'hitler', 'nazi', 'kkk', 'heilhitler', 'whitepower', 'gaschamber',
  'holocaust', 'isis', 'alqaeda',
  // Self-harm promotion
  'killyourself', 'kysnow', 'suicidal',
];

/**
 * Milder profanity, matched only as a standalone word (optionally with digits
 * attached, since handles commonly end in numbers). This is what keeps
 * "Bassist" and "Assassin" working.
 */
const WORD_BLOCKED = [
  // "cunt" lives here rather than in the substring list so that Scunthorpe
  // (a real town, and the name this whole class of bug is named after) is
  // still a usable handle. "Cunt" and "Cunt42" are still blocked.
  'cunt',
  'fuck', 'fucker', 'fucking', 'shit', 'shite', 'bullshit', 'piss', 'pissed',
  'ass', 'asshole', 'arse', 'arsehole', 'bastard', 'bitch', 'bollocks',
  'wanker', 'wank', 'twat', 'prick', 'dick', 'cock', 'penis', 'vagina',
  'boob', 'boobs', 'tits', 'titties', 'anus', 'anal', 'rape', 'rapist',
  'porn', 'porno', 'slut', 'whore', 'hoe', 'milf', 'orgy', 'orgasm',
  'masturbate', 'cum', 'jizz', 'semen', 'scrotum', 'testicle',
];

/**
 * Handles reserved for the app itself. Someone calling themselves "Admin" or
 * "Moderator" on a leaderboard can impersonate staff, which both stores treat
 * as deceptive.
 */
const RESERVED = [
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support',
  'official', 'system', 'root', 'owner', 'team10q', 'play10q', 'the10q',
  'help', 'security', 'billing', 'noreply', 'nobody', 'anonymous', 'null',
  'undefined', 'deleted', 'deleteduser', 'removed',
];

/**
 * Fold the common character substitutions people use to slip past a filter,
 * so "n1gg3r" and "sh1t" are caught by the same lists above.
 *
 * Applied only for matching. The player's actual handle is never rewritten.
 */
function normaliseForMatching(handle: string): string {
  return handle
    .toLowerCase()
    .replace(/[013457@$!|]/g, (ch) => {
      switch (ch) {
        case '0':
          return 'o';
        case '1':
        case '!':
        case '|':
          return 'i';
        case '3':
          return 'e';
        case '4':
        case '@':
          return 'a';
        case '5':
        case '$':
          return 's';
        case '7':
          return 't';
        default:
          return ch;
      }
    });
}

/**
 * True when the handle contains content that must not appear on a public
 * leaderboard.
 *
 * Checked in addition to validateHandle's format rules, not instead of them.
 */
export function containsBlockedContent(handle: string): boolean {
  if (!handle) return false;

  const raw = handle.trim().toLowerCase();
  const normalised = normaliseForMatching(handle.trim());

  // Reserved names are compared against the handle as typed, so that
  // "Administrator" is caught but "Adminster" is not.
  const strippedDigits = raw.replace(/[0-9]+$/, '');
  if (RESERVED.includes(raw) || RESERVED.includes(strippedDigits)) {
    return true;
  }

  // Slurs: match anywhere, on both the raw and leet-folded forms.
  for (const term of SUBSTRING_BLOCKED) {
    if (raw.includes(term) || normalised.includes(term)) {
      return true;
    }
  }

  // Milder profanity: only as a whole word. Handles have no separators, so
  // "word boundary" here means the start/end of the handle or a digit, and
  // also a case change (the CamelCase people actually type: "BigAssTiger").
  for (const term of WORD_BLOCKED) {
    if (matchesAsWord(raw, term) || matchesAsWord(normalised, term)) {
      return true;
    }
    if (matchesCamelCaseWord(handle.trim(), term)) {
      return true;
    }
  }

  return false;
}

/**
 * Whether `term` appears in `value` bounded by string edges or digits.
 * "shit" and "shit42" match; "bassist" does not match "ass".
 */
function matchesAsWord(value: string, term: string): boolean {
  let index = value.indexOf(term);
  while (index !== -1) {
    const before = index === 0 ? '' : value[index - 1];
    const afterIndex = index + term.length;
    const after = afterIndex >= value.length ? '' : value[afterIndex];

    const boundedBefore = before === '' || /[0-9]/.test(before);
    const boundedAfter = after === '' || /[0-9]/.test(after);

    if (boundedBefore && boundedAfter) {
      return true;
    }
    index = value.indexOf(term, index + 1);
  }
  return false;
}

/**
 * Whether `term` appears as a CamelCase segment, e.g. "BigAssTiger" -> "Ass".
 * Splitting on case changes is how people actually separate words in a handle.
 */
function matchesCamelCaseWord(handle: string, term: string): boolean {
  const segments = handle
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .split(/\s+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  return segments.includes(term);
}
