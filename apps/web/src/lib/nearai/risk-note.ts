/**
 * A risk note on a loan request, written by an open model running in NEAR AI Cloud's confidential
 * enclaves, and checked before it's shown (attest.ts). Server only.
 *
 * The facts are read here, from NEAR testnet and public chain data, never taken from the browser,
 * so a note can only be about the loan as it really is. The note is advice: it can't move anything,
 * and the lending contract decides what happens to the vault.
 */
import { TestnetBearerClient, type ChainObservation, type VaultLoan, type VaultView } from "@bearer/sdk";
import { BASE_RPC, BEARER_CONTRACT, ESPLORA_API, LEND_CONTRACT, NEAR_RPC, SOLANA_RPC } from "@/lib/config";
import { CHAIN_META, toDecimalString, toUsd } from "@/lib/vault/format";
import { attestModel, checkSignature, fetchSignature, NEAR_AI_API, newNonce, sha256Hex } from "./attest";
import type { RiskNote, RiskNoteResult } from "./types";

/** An open model NEAR AI serves from its own TEEs (not a proxied closed model). */
export const NEAR_AI_MODEL = process.env.NEAR_AI_MODEL || "z-ai/glm-5.3-flash";
const NEAR = 10n ** 24n;
const DAY_NS = 86_400n * 1_000_000_000n;

export class NoLoan extends Error {}

const nsIso = (ns: string | bigint) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
const near = (yocto: string) => {
  const v = BigInt(yocto);
  const frac = (v % NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return frac ? `${v / NEAR}.${frac}` : `${v / NEAR}`;
};

/** A read-only client: these reads need no wallet. */
function reader() {
  return new TestnetBearerClient({
    contractId: BEARER_CONTRACT,
    lendId: LEND_CONTRACT,
    wallet: {
      accountId: () => null,
      send: () => Promise.reject(new Error("read-only")),
    },
    endpoints: { near: NEAR_RPC, esplora: ESPLORA_API, evm: BASE_RPC, solana: SOLANA_RPC },
  });
}

/** The loan as it stands, in plain public facts. */
export async function loanFacts(tokenId: string) {
  const client = reader();
  const [vault, loan] = await Promise.all([client.getVault(tokenId), client.getLoan(tokenId)]);
  if (!vault || !loan || vault.owner_id !== LEND_CONTRACT)
    throw new NoLoan(`vault ${tokenId} isn't pledged for a loan`);
  const observed: ChainObservation[] = await client.observe(vault).catch(() => []);
  return { loan, facts: describe(vault, loan, observed) };
}

function describe(vault: VaultView, loan: VaultLoan, observed: ChainObservation[]) {
  const custody = vault.custody;
  const pledged = custody.at(-1);
  const before = custody.slice(0, -1);
  const principal = BigInt(loan.principal);
  const interestBp = principal ? Number(((BigInt(loan.repayment) - principal) * 10_000n) / principal) : 0;
  const holdings = observed.map((o) => ({
    chain: `${CHAIN_META[o.chain].name} ${CHAIN_META[o.chain].network}`,
    asset: CHAIN_META[o.chain].unit,
    confirmed: toDecimalString(o.chain, o.confirmed),
    pending: toDecimalString(o.chain, o.pending),
    usd_estimate: Math.round(toUsd(o.chain, o.confirmed) * 100) / 100,
    source: o.source,
  }));
  const dueNs = "due_at_ns" in loan.state ? BigInt(loan.state.due_at_ns) : null;
  return {
    as_of: new Date().toISOString(),
    vault: {
      number: vault.token_id,
      state: vault.state.kind,
      signatures_ever_requested: vault.signatures_requested,
      withdrawals_ever: vault.withdrawal_count,
      created_at: nsIso(vault.created_at_ns),
      holders_before_pledge: [...new Set(before.map((c) => c.account_id))].length,
      borrower_held_it_since: before.at(-1) ? nsIso(before.at(-1)!.since_ns) : null,
      pledged_at: pledged ? nsIso(pledged.since_ns) : null,
    },
    collateral: holdings,
    collateral_usd_estimate_total: Math.round(holdings.reduce((s, h) => s + h.usd_estimate, 0) * 100) / 100,
    loan: {
      state: loan.state.kind,
      borrower: loan.borrower,
      principal_near: near(loan.principal),
      repayment_near: near(loan.repayment),
      interest_percent: interestBp / 100,
      term_days: Number((BigInt(loan.term_ns) * 100n) / DAY_NS) / 100,
      due_at: dueNs === null ? null : nsIso(dueNs),
      overdue: dueNs !== null && BigInt(Date.now()) * 1_000_000n >= dueNs,
      lender: "lender" in loan.state ? loan.state.lender : null,
    },
    rules: [
      "While the vault is pledged, the lending contract holds it and never breaks its seal, so nobody can withdraw from it, the borrower included.",
      "If the borrower repays exactly the repayment before the due date, the vault goes back to them; from the due date on, only the lender can take it, still sealed.",
      "A sealed vault has never had a withdrawal signature requested, so nobody holds a pre-signed transaction against its coins.",
      "Balances are observed from public testnet data and can lag. Testnet coins have no market value; usd_estimate prices them as if they were real, at fixed estimates.",
      "There is no NEAR price in these facts.",
    ],
  };
}

const SYSTEM = [
  "You write short risk notes for people deciding whether to lend NEAR against a Bearer vault.",
  "A Bearer vault is an NFT on NEAR that controls native Bitcoin, Base ETH and Solana SOL addresses; here it is pledged as collateral for a NEAR loan.",
  "Use only the facts you are given. Never invent prices, balances or history. There is no NEAR price, so do not compare the loan's NEAR amount with the collateral's dollar estimate; judge what the facts do show: whether the collateral is intact and locked, how much is there and on which chains, pending deposits, the vault's history, and the terms.",
  'Reply with one JSON object and nothing else: {"rating": "lower" | "moderate" | "higher" (risk to the lender), "summary": one sentence, "points": up to 4 short strings, "caveat": one short string}.',
].join(" ");

function parseNote(content: string): RiskNote | null {
  try {
    const j = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Partial<RiskNote>;
    const rating = j.rating;
    if (rating !== "lower" && rating !== "moderate" && rating !== "higher") return null;
    if (typeof j.summary !== "string") return null;
    const points = Array.isArray(j.points)
      ? j.points.filter((p): p is string => typeof p === "string").slice(0, 4)
      : [];
    const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 280);
    return {
      rating,
      summary: clip(j.summary),
      points: points.map(clip),
      caveat: typeof j.caveat === "string" ? clip(j.caveat) : "",
    };
  } catch {
    return null;
  }
}

/**
 * Attests the model's enclaves with a fresh nonce, then asks it, then checks the reply's
 * signature against the attested key. Refuses to ask a model whose attestation didn't pass.
 */
export async function writeRiskNote(facts: ReturnType<typeof describe>, apiKey: string): Promise<RiskNoteResult> {
  const model = NEAR_AI_MODEL;
  const evidence = await attestModel(model, newNonce());
  const base = {
    model,
    facts,
    evidence,
    note: null,
    raw: "",
    signature: null,
    requestBody: "",
    responseBody: "",
    requestHash: "",
    responseHash: "",
    chatId: null,
    at: new Date().toISOString(),
    simulated: false,
  } satisfies RiskNoteResult;
  if (!evidence.ok) return base;

  // The exact bytes sent are the bytes hashed; the reply is hashed before it's parsed.
  const requestBody = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Facts, read from NEAR testnet and public chain data just now:\n${JSON.stringify(facts, null, 2)}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    // GLM reasons before answering; at its default effort a note took 75 s, at low about 12.
    reasoning_effort: "low",
    max_tokens: 1500,
  });
  const res = await fetch(`${NEAR_AI_API}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "accept-encoding": "identity",
      "x-no-aliasing": "true",
    },
    body: requestBody,
    cache: "no-store",
    signal: AbortSignal.timeout(150_000),
  });
  const responseBody = await res.text();
  if (!res.ok) throw new Error(`NEAR AI answered HTTP ${res.status}: ${responseBody.slice(0, 200)}`);
  const requestHash = sha256Hex(requestBody);
  const responseHash = sha256Hex(responseBody);
  const reply = JSON.parse(responseBody) as { id?: string; choices?: { message?: { content?: string } }[] };
  const raw = reply.choices?.[0]?.message?.content ?? "";
  const chatId = reply.id ?? null;
  const signature = chatId
    ? checkSignature(
        await fetchSignature(chatId, model, apiKey),
        model,
        requestHash,
        responseHash,
        evidence.signingAddress,
      )
    : null;

  return {
    ...base,
    note: parseNote(raw),
    raw,
    signature,
    requestBody,
    responseBody,
    requestHash,
    responseHash,
    chatId,
    at: new Date().toISOString(),
  };
}
