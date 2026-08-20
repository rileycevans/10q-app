/**
 * Handle content filtering (for Edge Functions).
 *
 * Deno cannot import the @10q/contracts workspace package, so this mirrors
 * packages/contracts/src/handle-blocklist.ts. The two must stay in sync:
 * client-side validation is a convenience, but this copy is the one that
 * actually enforces the rule, since a direct API call skips the browser
 * entirely. Tests for the shared logic live with the contracts copy.
 */

/**
 * Terms with no legitimate use inside a handle. Matched anywhere in the string.
 * Deliberately covers leetspeak after normalisation (see normaliseForMatching).
 */
const SUBSTRING_BLOCKED = [
  // Racial and ethnic slurs. Only terms with no innocent English embedding
  // live here — see WORD_BLOCKED for the ones that do (spic, coon, chink...).
  'nigger', 'nigga', 'kike', 'wetback', 'raghead', 'towelhead',
  // Homophobic and transphobic slurs
  'faggot', 'tranny', 'shemale',
  // Sexual content
  // NB: "cunt" is NOT here — it is the canonical Scunthorpe case.
  'blowjob', 'handjob', 'creampie', 'cumshot', 'dildo',
  'rimjob', 'bukkake', 'fleshlight',
  // Sexual content involving minors
  'childporn', 'jailbait', 'lolicon', 'shotacon',
  // Extremist references
  'heilhitler', 'whitepower', 'gaschamber', 'alqaeda',
  // Self-harm promotion
  'killyourself', 'kysnow',
];

/**
 * Milder profanity, matched only as a standalone word (optionally with digits
 * attached, since handles commonly end in numbers). This is what keeps
 * "Bassist" and "Assassin" working.
 */
const WORD_BLOCKED = [
  // Slurs and loaded terms that are also substrings of ordinary English, so
  // they must be word-matched rather than found anywhere. Each was measured
  // against /usr/share/dict/words: as substrings these five alone flagged
  // ~350 innocent words (pedometer, auspicious, raccoon, chinking, crisis).
  // Word-matched they still catch "Spic", "SpicHater", "Coon42", "PedoBear".
  'spic', 'coon', 'chink', 'gook', 'paki', 'pedo', 'paedo', 'isis',
  'nazi', 'hitler', 'holocaust', 'retard', 'fagot', 'beaner', 'suicidal',
  'felch', 'hentai', 'kkk',
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
  //
  // The CamelCase split runs on both the raw handle and a leet-folded copy
  // that keeps the original capitalisation. Without the second pass "Sh1tLord"
  // survives: folding alone gives "shitlord" (no case boundary left to split
  // on) and splitting alone gives "Sh1t" (not a listed term).
  const leetPreservingCase = foldLeetPreservingCase(handle.trim());

  for (const term of WORD_BLOCKED) {
    if (matchesAsWord(raw, term) || matchesAsWord(normalised, term)) {
      return true;
    }
    if (
      matchesCamelCaseWord(handle.trim(), term) ||
      matchesCamelCaseWord(leetPreservingCase, term) ||
      matchesCamelCaseWord(normalised, term)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Fold leetspeak digits to letters while preserving the case of surrounding
 * characters, so CamelCase segmentation still has boundaries to split on.
 * Substituted letters take the case of the segment they sit in: "Sh1tLord"
 * becomes "ShitLord", which splits into "shit" + "lord".
 */
function foldLeetPreservingCase(handle: string): string {
  const LEET: Record<string, string> = {
    '0': 'o',
    '1': 'i',
    '!': 'i',
    '|': 'i',
    '3': 'e',
    '4': 'a',
    '@': 'a',
    '5': 's',
    '$': 's',
    '7': 't',
  };

  return handle
    .split('')
    .map((ch, i) => {
      const sub = LEET[ch];
      if (!sub) return ch;
      // A digit that ends the handle is almost always a suffix number
      // ("Tiger42"), not an evasion — leave those alone so matchesAsWord's
      // digit-boundary rule still applies.
      const isTrailingRun = /^[0-9]+$/.test(handle.slice(i));
      if (isTrailingRun) return ch;
      // Always substitute lowercase. Uppercasing to match a preceding capital
      // would invent a case boundary mid-word: "SuperF4ckMaster" would fold to
      // "SuperFAckMaster" and split as "fack", missing the term entirely.
      // Lowercase keeps the real boundaries (the capitals already in the
      // handle) and lets the substituted letter join the word around it.
      return sub;
    })
    .join('');
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
 *
 * Deliberately an exact segment comparison. Fuzzy matching (comparing consonant
 * skeletons, so "f4ck" -> "fck" catches "fuck") was tried and reverted: tested
 * against /usr/share/dict/words it flagged 343 ordinary English words —
 * "aconite", "apron", "auspicious", "beanery" — to catch a handful of extra
 * evasions. A player rejected for "Apron" has no idea why, and reporting
 * already covers what the filter misses.
 */
function matchesCamelCaseWord(handle: string, term: string): boolean {
  const segments = handle
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    // "xX" padding is a gamertag convention, not part of the word:
    // "XxRetardxX" is three segments, not one. Only runs at a segment edge
    // are stripped, so "Foxx" and "Maxx" keep their trailing x's.
    .replace(/(^|\s)[xX]{1,3}(?=[A-Za-z])/g, '$1 ')
    .replace(/[xX]{1,3}(?=\s|$)/g, ' ')
    .split(/\s+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  return segments.includes(term);
}
