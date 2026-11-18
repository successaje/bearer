/**
 * Risk notes on loan requests, from an open model in NEAR AI Cloud's confidential enclaves.
 *
 * GET              whether this deployment can write notes (it needs NEAR_AI_API_KEY), and the model.
 * GET ?check=1     a fresh attestation of the model's enclaves, every check run here. Needs no key.
 * POST {token_id}  a note on that vault's loan: attestation first, then the model, then the reply's
 *                  signature. The facts are read here from NEAR testnet, never taken from the request.
 *
 * Each note is kept for ten minutes per loan state, so asking again doesn't spend credits; a fresh
 * attestation check is kept for a minute.
 */
import { IS_SIMULATED } from "@/lib/config";
import { attestModel } from "@/lib/nearai/attest";
import { loanFacts, NEAR_AI_MODEL, NoLoan, writeRiskNote } from "@/lib/nearai/risk-note";
import type { ModelEvidence, RiskNoteResult, RiskNoteStatus } from "@/lib/nearai/types";

const NOTE_TTL_MS = 10 * 60_000;
const CHECK_TTL_MS = 60_000;
const notes = new Map<string, { at: number; result: Promise<RiskNoteResult> }>();
let check: { at: number; result: Promise<ModelEvidence> } | null = null;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  if (IS_SIMULATED) return json({ error: "The simulated demo asks no model." }, 404);
  if (new URL(request.url).searchParams.get("check")) {
    if (!check || Date.now() - check.at > CHECK_TTL_MS) {
      check = { at: Date.now(), result: attestModel(NEAR_AI_MODEL) };
      check.result.catch(() => (check = null));
    }
    return json(await check.result);
  }
  return json({ configured: Boolean(process.env.NEAR_AI_API_KEY), model: NEAR_AI_MODEL } satisfies RiskNoteStatus);
}

export async function POST(request: Request) {
  if (IS_SIMULATED) return json({ error: "The simulated demo asks no model." }, 404);
  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) return json({ error: "Risk notes aren't set up on this deployment: it has no NEAR AI key." }, 503);
  const body = (await request.json().catch(() => null)) as { token_id?: unknown } | null;
  const tokenId = typeof body?.token_id === "string" && /^\d{1,10}$/.test(body.token_id) ? body.token_id : null;
  if (!tokenId) return json({ error: "Name a vault by its number." }, 400);

  try {
    const { loan, facts } = await loanFacts(tokenId);
    const key = `${tokenId}:${loan.requested_at_ns}:${loan.state.kind}`;
    const hit = notes.get(key);
    if (hit && Date.now() - hit.at < NOTE_TTL_MS) return json(await hit.result);
    const entry = { at: Date.now(), result: writeRiskNote(facts, apiKey) };
    notes.set(key, entry);
    entry.result.catch(() => notes.delete(key));
    return json(await entry.result);
  } catch (e) {
    if (e instanceof NoLoan) return json({ error: "This vault isn't pledged for a loan." }, 404);
    return json({ error: e instanceof Error ? e.message.slice(0, 300) : "The risk note couldn't be written." }, 502);
  }
}
