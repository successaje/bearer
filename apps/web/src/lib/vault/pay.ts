import type { ChainTag } from "@bearer/sdk";
import { CHAIN_META, fromDecimal, toDecimalString, vaultNumber } from "./format";

/** Base Sepolia, as in packages/sdk/src/testnet/config.ts. */
const BASE_SEPOLIA_CHAIN_ID = 84532;

/** A note is a short line of plain text, not a message board. */
export const NOTE_MAX = 80;

const CHAINS: readonly ChainTag[] = ["btc", "evm", "sol"];

/**
 * What a payment link asks for: `/v/[id]/pay?chain=btc&amount=0.0005&note=Invoice%2042`.
 * The link names a coin, an amount and a note. It never names an address: the page always reads
 * the vault's addresses from the contract, so a link can't send a payer anywhere else.
 */
export type PayRequest = { chain: ChainTag | null; amount: bigint | null; note: string | null };

/** Reads a payment link's query. Anything that doesn't parse is dropped, never guessed. */
export function parsePayRequest(params: { get(name: string): string | null }): PayRequest {
  const c = params.get("chain");
  const chain = CHAINS.includes(c as ChainTag) ? (c as ChainTag) : null;
  const raw = params.get("amount");
  const amount = chain && raw ? fromDecimal(chain, raw) : null;
  return { chain, amount: amount && amount > 0n ? amount : null, note: cleanNote(params.get("note")) };
}

/** One line of printable text, at most NOTE_MAX characters. */
export function cleanNote(note: string | null): string | null {
  const text = (note ?? "")
    // Control and format characters (bidi overrides among them) become spaces; emoji joiners stay.
    .replace(/(?!\u200d)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? [...text].slice(0, NOTE_MAX).join("") : null;
}

/** The page's path for a request, e.g. `/v/32/pay?chain=btc&amount=0.0005`. */
export function payPath(tokenId: string, request: PayRequest): string {
  const q = new URLSearchParams();
  if (request.chain) q.set("chain", request.chain);
  if (request.chain && request.amount) q.set("amount", toDecimalString(request.chain, request.amount));
  const note = cleanNote(request.note);
  if (note) q.set("note", note);
  const query = q.toString();
  return `/v/${tokenId}/pay${query ? `?${query}` : ""}`;
}

/**
 * What a wallet scans. Without an amount it's the bare address, which every wallet reads. With one,
 * it's the chain's payment URI so the wallet fills the amount in: BIP 21 for Bitcoin, EIP-681 with
 * Base Sepolia's chain id for Base, Solana Pay for Solana.
 */
export function paymentUri(
  chain: ChainTag,
  address: string,
  tokenId: string,
  amount: bigint | null,
  note: string | null,
): string {
  if (!amount) return address;
  const label = encodeURIComponent(`Bearer vault ${vaultNumber(tokenId)}`);
  const message = note ? `&message=${encodeURIComponent(note)}` : "";
  if (chain === "btc") return `bitcoin:${address}?amount=${toDecimalString("btc", amount)}&label=${label}${message}`;
  if (chain === "evm") return `ethereum:${address}@${BASE_SEPOLIA_CHAIN_ID}?value=${amount.toString()}`;
  return `solana:${address}?amount=${toDecimalString("sol", amount)}&label=${label}${message}`;
}

/** "0.0005 tBTC" from base units, exact (no rounding). */
export function exactAmount(chain: ChainTag, amount: bigint): string {
  return `${toDecimalString(chain, amount)} ${CHAIN_META[chain].unit}`;
}
