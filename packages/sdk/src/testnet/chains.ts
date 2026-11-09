import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58, base64, hex } from "@scure/base";
import type { BtcWithdrawParams, ChainTag, EvmWithdrawParams, SolWithdrawParams, WithdrawalStage } from "../types";
import { BASE_SEPOLIA_CHAIN_ID, BTC_DUST, EXPLORERS, btcVsize, type TestnetEndpoints } from "./config";
import { btcFeeRate } from "./observe";
import { RpcError, getJson, jsonRpc } from "./rpc";

/* ---------- building the contract's withdrawal parameters ---------- */

export async function evmParams(from: string, to: string, amountWei: string, ep: TestnetEndpoints): Promise<EvmWithdrawParams> {
  const [nonce, block, tip] = await Promise.all([
    jsonRpc<string>(ep.evm, "eth_getTransactionCount", [from, "pending"]),
    jsonRpc<{ baseFeePerGas: string }>(ep.evm, "eth_getBlockByNumber", ["latest", false]),
    jsonRpc<string>(ep.evm, "eth_maxPriorityFeePerGas", []).catch(() => "0xf4240"), // 0.001 gwei
  ]);
  const priority = BigInt(tip);
  // Twice the base fee leaves room for a few full blocks before the transaction is underpriced.
  const maxFee = BigInt(block.baseFeePerGas) * 2n + priority;
  return {
    chain_id: String(BASE_SEPOLIA_CHAIN_ID),
    nonce: String(BigInt(nonce)),
    to,
    amount_wei: amountWei,
    gas_limit: "21000",
    max_fee_per_gas: maxFee.toString(),
    max_priority_fee_per_gas: priority.toString(),
  };
}

/**
 * Picks confirmed coins, largest first, until they cover the amount and the fee. Change below
 * the dust limit is added to the fee rather than refused (the contract won't create dust).
 */
export async function btcParams(
  from: string,
  to: string,
  amountSats: string,
  maxInputs: number,
  ep: TestnetEndpoints,
): Promise<BtcWithdrawParams> {
  const [utxos, rate] = await Promise.all([
    getJson<{ txid: string; vout: number; value: number; status: { confirmed: boolean } }[]>(`${ep.esplora}/address/${from}/utxo`),
    btcFeeRate(ep.esplora),
  ]);
  const amount = Number(amountSats);
  const coins = (utxos ?? []).filter((u) => u.status.confirmed).sort((a, b) => b.value - a.value);
  const picked: typeof coins = [];
  let total = 0;
  for (const c of coins) {
    if (picked.length === maxInputs) break;
    picked.push(c);
    total += c.value;
    if (total >= amount + rate * btcVsize(picked.length)) break;
  }
  let fee = rate * btcVsize(picked.length);
  if (!picked.length || total < amount + fee) {
    throw new Error(`ERR_INSUFFICIENT_FUNDS: ${total} sats confirmed in up to ${maxInputs} coins; ${amount + fee} needed`);
  }
  const change = total - amount - fee;
  if (change > 0 && change < BTC_DUST) fee += change;
  return {
    inputs: picked.map((c) => ({ txid: c.txid, vout: c.vout, value_sat: String(c.value) })),
    to_address: to,
    amount_sat: String(amount),
    fee_sat: String(fee),
  };
}

export async function solParams(to: string, lamports: string, ep: TestnetEndpoints): Promise<SolWithdrawParams> {
  const { value } = await jsonRpc<{ value: { blockhash: string } }>(ep.solana, "getLatestBlockhash", [{ commitment: "finalized" }]);
  return { recent_blockhash: value.blockhash, to, lamports };
}

/* ---------- identifying a signed transaction ---------- */

function readVarint(b: Uint8Array, at: number): [number, number] {
  const first = b[at];
  if (first < 0xfd) return [first, 1];
  const len = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
  let n = 0;
  for (let i = len; i >= 1; i--) n = n * 256 + b[at + i];
  return [n, 1 + len];
}

/** Bitcoin txid: double SHA-256 of the transaction without its witness, byte-reversed. */
export function btcTxid(rawHex: string) {
  const b = hex.decode(rawHex);
  if (b[4] !== 0x00 || b[5] !== 0x01) return hex.encode(sha256(sha256(b)).reverse());
  let p = 6;
  const [nIn, a] = readVarint(b, p);
  p += a;
  for (let i = 0; i < nIn; i++) {
    p += 36;
    const [sl, s] = readVarint(b, p);
    p += s + sl + 4;
  }
  const [nOut, o] = readVarint(b, p);
  p += o;
  for (let i = 0; i < nOut; i++) {
    p += 8;
    const [sl, s] = readVarint(b, p);
    p += s + sl;
  }
  const stripped = new Uint8Array([...b.slice(0, 4), ...b.slice(6, p), ...b.slice(b.length - 4)]);
  return hex.encode(sha256(sha256(stripped)).reverse());
}

/** The hash each chain's explorer knows the signed transaction by. */
export function chainTxId(chain: ChainTag, rawHex: string) {
  const raw = rawHex.replace(/^0x/, "");
  if (chain === "btc") return btcTxid(raw);
  if (chain === "evm") return `0x${hex.encode(keccak_256(hex.decode(raw)))}`;
  // Solana: the transaction's first signature, after the one-byte signature count.
  return base58.encode(hex.decode(raw).slice(1, 65));
}

/* ---------- where a signed transaction stands on its chain (read-only) ---------- */

export interface ChainStatus {
  stage: Extract<WithdrawalStage, "broadcasting" | "confirming" | "confirmed" | "failed">;
  error: string | null;
}

export async function chainStatus(chain: ChainTag, txId: string, raw: string, ep: TestnetEndpoints): Promise<ChainStatus> {
  if (chain === "btc") {
    // Not `/tx/:id/status`: Esplora answers that with `confirmed: false` even for unknown txids.
    const tx = await getJson<{ status: { confirmed: boolean } }>(`${ep.esplora}/tx/${txId}`);
    return { stage: !tx ? "broadcasting" : tx.status.confirmed ? "confirmed" : "confirming", error: null };
  }
  if (chain === "evm") {
    const receipt = await jsonRpc<{ status: string } | null>(ep.evm, "eth_getTransactionReceipt", [txId]);
    if (receipt) return receipt.status === "0x1" ? { stage: "confirmed", error: null } : { stage: "failed", error: "Reverted on Base." };
    const tx = await jsonRpc<unknown>(ep.evm, "eth_getTransactionByHash", [txId]);
    return { stage: tx ? "confirming" : "broadcasting", error: null };
  }
  const { value } = await jsonRpc<{ value: ({ confirmationStatus: string | null; err: unknown } | null)[] }>(ep.solana, "getSignatureStatuses", [
    [txId],
    { searchTransactionHistory: true },
  ]);
  const s = value[0];
  if (s?.err) return { stage: "failed", error: `Solana rejected it: ${JSON.stringify(s.err)}` };
  if (s) return { stage: s.confirmationStatus === "finalized" || s.confirmationStatus === "confirmed" ? "confirmed" : "confirming", error: null };
  // Not on chain. If its blockhash has expired it never will be: ask for a new withdrawal.
  const message = hex.decode(raw).slice(65);
  const blockhash = base58.encode(message.slice(4 + 32 * message[3], 4 + 32 * message[3] + 32));
  const valid = await jsonRpc<{ value: boolean }>(ep.solana, "isBlockhashValid", [blockhash, { commitment: "processed" }]);
  return valid.value
    ? { stage: "broadcasting", error: null }
    : { stage: "failed", error: "Its blockhash expired before it was broadcast. Withdraw again; the vault stays opened." };
}

/** Sends a signed transaction. Re-sending one the chain already has is treated as success. */
export async function broadcastRaw(chain: ChainTag, rawHex: string, ep: TestnetEndpoints) {
  const raw = rawHex.replace(/^0x/, "");
  try {
    if (chain === "btc") {
      const res = await fetch(`${ep.esplora}/tx`, { method: "POST", body: raw });
      const text = await res.text();
      if (!res.ok && !/already|known/i.test(text)) throw new RpcError("esplora /tx", text);
    } else if (chain === "evm") {
      await jsonRpc(ep.evm, "eth_sendRawTransaction", [`0x${raw}`]);
    } else {
      await jsonRpc(ep.solana, "sendTransaction", [base64.encode(hex.decode(raw)), { encoding: "base64" }]);
    }
  } catch (e) {
    if (!/already (known|processed|in block)|known transaction|nonce too low/i.test(String(e))) throw e;
  }
  return chainTxId(chain, raw);
}

export const txExplorer = (chain: ChainTag, txId: string) => EXPLORERS.tx[chain](txId);
