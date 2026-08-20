/**
 * Shared extraction core: calls OpenAI and returns validated claims.
 * Used by both `extract-claim` (pure, no DB) and `ingest-claim` (persists).
 */

import { buildMessages, EXTRACTION_MODEL, STAGES, TRANSFER_TYPES } from "./extraction-prompt.ts";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const STAGE_SET = new Set<string>(STAGES);
const TYPE_SET = new Set<string>(TRANSFER_TYPES);

export interface ExtractedClaim {
  player: string;
  destination_club: string;
  source_club: string | null;
  stage: string;
  transfer_type: string | null;
  confidence: number;
  contradicts: boolean;
  fee_text: string | null;
  reasoning: string;
}

export interface ExtractionResult {
  claims: ExtractedClaim[];
  warnings: string[];
  usage: unknown;
}

export class ExtractionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function extractClaims(
  apiKey: string,
  text: string,
  journalistHandle?: string,
  model: string = EXTRACTION_MODEL,
): Promise<ExtractionResult> {
  let resp: Response;
  try {
    resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: buildMessages(text, journalistHandle),
      }),
    });
  } catch (e) {
    throw new ExtractionError(`Failed to reach OpenAI API: ${String(e)}`, 502);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new ExtractionError(`OpenAI API error (${resp.status}): ${errText.slice(0, 200)}`, 502);
  }

  const openaiJson = await resp.json();
  const choices = (openaiJson.choices as Array<{ message?: { content?: string } }>) ?? [];
  const rawOutput = choices[0]?.message?.content ?? "";

  let parsed: { claims?: unknown };
  try {
    parsed = JSON.parse(stripFences(rawOutput));
  } catch {
    throw new ExtractionError("Model returned non-JSON output", 502);
  }

  const { claims, warnings } = sanitizeClaims(parsed.claims);
  return { claims, warnings, usage: openaiJson.usage ?? null };
}

function stripFences(s: string): string {
  const trimmed = s.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1].trim() : trimmed;
}

function sanitizeClaims(raw: unknown): { claims: ExtractedClaim[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!Array.isArray(raw)) {
    if (raw !== undefined) warnings.push("`claims` was not an array; treated as empty.");
    return { claims: [], warnings };
  }

  const claims: ExtractedClaim[] = [];
  raw.forEach((item, i) => {
    if (typeof item !== "object" || item === null) {
      warnings.push(`claim[${i}] was not an object; dropped.`);
      return;
    }
    const c = item as Record<string, unknown>;
    const player = typeof c.player === "string" ? c.player.trim() : "";
    const destination = typeof c.destination_club === "string" ? c.destination_club.trim() : "";

    if (!player || !destination) {
      warnings.push(`claim[${i}] missing player or destination_club; dropped.`);
      return;
    }
    if (typeof c.stage !== "string" || !STAGE_SET.has(c.stage)) {
      warnings.push(`claim[${i}] had invalid stage "${String(c.stage)}"; dropped.`);
      return;
    }

    let transferType: string | null = null;
    if (typeof c.transfer_type === "string" && TYPE_SET.has(c.transfer_type)) {
      transferType = c.transfer_type;
    } else if (c.transfer_type != null && c.transfer_type !== "") {
      warnings.push(`claim[${i}] had invalid transfer_type "${String(c.transfer_type)}"; set to null.`);
    }

    let confidence = typeof c.confidence === "number" ? Math.round(c.confidence) : 50;
    confidence = Math.max(0, Math.min(100, confidence));

    claims.push({
      player,
      destination_club: destination,
      source_club: typeof c.source_club === "string" && c.source_club.trim() ? c.source_club.trim() : null,
      stage: c.stage,
      transfer_type: transferType,
      confidence,
      contradicts: c.contradicts === true,
      fee_text: typeof c.fee_text === "string" && c.fee_text.trim() ? c.fee_text.trim() : null,
      reasoning: typeof c.reasoning === "string" ? c.reasoning.trim() : "",
    });
  });

  return { claims, warnings };
}
