/**
 * Transfer-claim extraction prompt.
 *
 * Converts a single raw social/news post into zero or more structured transfer
 * claims. Kept separate from the Edge Function so the prompt can be iterated on
 * (and unit-tested) without touching request/DB plumbing.
 *
 * The output contract is intentionally close to the `transfers` schema:
 *   - `stage` values are EXACTLY the names in transfers.claim_stages
 *   - `transfer_type` values are EXACTLY the transfers.transfer_type enum
 * so downstream code can map strings to ids without fuzzy logic.
 */

// Cheap + fast; bump to "gpt-4o" for hard cases.
export const EXTRACTION_MODEL = "gpt-4o-mini";

// Must match transfers.claim_stages.name exactly.
export const STAGES = [
  "Monitoring",
  "Interest",
  "Agent Contact",
  "Talks",
  "Bid",
  "Negotiation",
  "Fee Agreed",
  "Terms Agreed",
  "Medical",
  "Done",
] as const;

// Must match transfers.transfer_type enum exactly.
export const TRANSFER_TYPES = [
  "permanent",
  "loan",
  "loan_with_option",
  "loan_with_obligation",
  "free",
] as const;

export const SYSTEM_PROMPT = `You are a precise extraction engine for a football (soccer) transfer-rumour tracking system. You read ONE social-media post or news snippet from a football journalist and extract every distinct transfer CLAIM it makes.

A "claim" is a single assertion that ONE player is involved in a potential move to ONE destination club. One post can contain zero, one, or several claims (e.g. a round-up tweet listing three targets = three claims).

Return ONLY a JSON object, no prose, with this exact shape:
{
  "claims": [
    {
      "player": "string — the player's name as written, cleaned of emojis/handles",
      "destination_club": "string — the club the player would move TO",
      "source_club": "string | null — the club the player would move FROM, if stated or clearly implied",
      "stage": "one of the allowed stage values",
      "transfer_type": "one of the allowed transfer_type values, or null if unstated",
      "confidence": 0-100,
      "contradicts": false,
      "fee_text": "string | null — any fee/wage figure exactly as written, e.g. \\"€60m\\"",
      "reasoning": "string — one short sentence: which words in the post map to this stage"
    }
  ]
}

ALLOWED stage values (use the EXACT string, choose the FURTHEST stage the post supports):
- "Monitoring"    — club is watching/scouting/keeping tabs/admires the player
- "Interest"      — concrete interest registered; club "wants"/"keen on"/"targeting"
- "Agent Contact" — club has spoken to the agent/entourage/representatives
- "Talks"         — active discussions between clubs or with the player
- "Bid"           — a formal bid/offer has been SUBMITTED
- "Negotiation"   — bid received; clubs negotiating, going back and forth
- "Fee Agreed"    — transfer fee between the clubs is AGREED
- "Terms Agreed"  — personal terms with the PLAYER agreed (salary/contract)
- "Medical"       — player is having/scheduled for a medical
- "Done"          — deal officially completed/announced/signed/"here we go"

ALLOWED transfer_type values: "permanent", "loan", "loan_with_option", "loan_with_obligation", "free", or null.

RULES:
1. Extract only CONCRETE transfer claims. Ignore opinion, match reports, contract-extension-only news (a player renewing with his CURRENT club is NOT a transfer), injury news, and general punditry. If the post contains no transfer claim, return {"claims": []}.
2. If the post DENIES, rules out, or pours cold water on a move ("no agreement", "talks broken down", "NOT in talks", "deal off", "rejected the bid"), still emit the claim but set "contradicts": true and set "stage" to the stage the rumour is being denied at.
3. Pick the SINGLE furthest stage the wording supports. "Here we go" / "official" / "completed" => "Done". Do not inflate: "linked with" or "interested" is NOT "Talks".
4. "confidence" = how confident YOU are that you extracted the structured fields correctly from the text (clarity of the post), NOT how likely the transfer is. A vague tweet => low confidence.
5. Preserve player and club names as written (minus emojis, hashtags, @handles, and trailing punctuation). Do not normalise spellings or translate — the matching layer handles that downstream.
6. A loan with a buy clause => "loan_with_option"; loan that becomes permanent automatically => "loan_with_obligation"; out-of-contract/Bosman => "free".
7. Never invent a destination club. If a player is "available"/"up for sale" with no named suitor, there is no claim — return {"claims": []}.
8. Output MUST be valid JSON. No markdown fences, no commentary outside the JSON.`;

// Few-shot examples steer stage selection, denials, multi-claim posts, and noise rejection.
export const FEW_SHOT: { input: string; output: string }[] = [
  {
    input:
      "🚨 Arsenal have opened talks with RB Leipzig over Benjamin Šeško. Personal terms not an issue. #AFC",
    output: JSON.stringify({
      claims: [
        {
          player: "Benjamin Šeško",
          destination_club: "Arsenal",
          source_club: "RB Leipzig",
          stage: "Talks",
          transfer_type: null,
          confidence: 92,
          contradicts: false,
          fee_text: null,
          reasoning: "\"opened talks with RB Leipzig\" maps to Talks.",
        },
      ],
    }),
  },
  {
    input:
      "Here we go! 🚨⚪️ Florian Wirtz to Liverpool, done deal and confirmed. €130m package agreed, contract until 2030. Medical completed.",
    output: JSON.stringify({
      claims: [
        {
          player: "Florian Wirtz",
          destination_club: "Liverpool",
          source_club: null,
          stage: "Done",
          transfer_type: "permanent",
          confidence: 98,
          contradicts: false,
          fee_text: "€130m",
          reasoning: "\"done deal and confirmed\" / \"Here we go\" maps to Done.",
        },
      ],
    }),
  },
  {
    input:
      "Despite reports in Spain, sources insist there is NO agreement between Bayern and Real Madrid for Alphonso Davies. Talks have stalled.",
    output: JSON.stringify({
      claims: [
        {
          player: "Alphonso Davies",
          destination_club: "Real Madrid",
          source_club: "Bayern",
          stage: "Negotiation",
          transfer_type: null,
          confidence: 80,
          contradicts: true,
          fee_text: null,
          reasoning: "Denial (\"NO agreement\", \"talks have stalled\") of a deal at the negotiation stage.",
        },
      ],
    }),
  },
  {
    input:
      "Three names on Juventus' summer shortlist: Sandro Tonali (monitoring), Teun Koopmeiners (formal interest), and a loan move for Marcus Rashford with an option to buy.",
    output: JSON.stringify({
      claims: [
        {
          player: "Sandro Tonali",
          destination_club: "Juventus",
          source_club: null,
          stage: "Monitoring",
          transfer_type: null,
          confidence: 70,
          contradicts: false,
          fee_text: null,
          reasoning: "\"(monitoring)\" maps to Monitoring.",
        },
        {
          player: "Teun Koopmeiners",
          destination_club: "Juventus",
          source_club: null,
          stage: "Interest",
          transfer_type: null,
          confidence: 72,
          contradicts: false,
          fee_text: null,
          reasoning: "\"formal interest\" maps to Interest.",
        },
        {
          player: "Marcus Rashford",
          destination_club: "Juventus",
          source_club: null,
          stage: "Interest",
          transfer_type: "loan_with_option",
          confidence: 68,
          contradicts: false,
          fee_text: null,
          reasoning: "\"loan move ... with an option to buy\" => loan_with_option; shortlist wording => Interest.",
        },
      ],
    }),
  },
  {
    input:
      "OFFICIAL: Marcus Rashford has signed a new contract with Manchester United until 2028. 🔴",
    output: JSON.stringify({ claims: [] }),
  },
  {
    input:
      "What a performance from Lamine Yamal tonight. Generational talent, Barcelona are so lucky to have him. ⭐️",
    output: JSON.stringify({ claims: [] }),
  },
];

/**
 * Builds the OpenAI Chat Completions `messages` array: system prompt first,
 * then few-shot pairs as alternating user/assistant turns, then the real post.
 */
export function buildMessages(rawText: string, journalistContext?: string) {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  for (const ex of FEW_SHOT) {
    messages.push({ role: "user", content: ex.input });
    messages.push({ role: "assistant", content: ex.output });
  }
  const ctx = journalistContext ? `[Context: posted by ${journalistContext}]\n` : "";
  messages.push({ role: "user", content: `${ctx}${rawText}` });
  return messages;
}
