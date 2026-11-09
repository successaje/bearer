import type { ChainObservation, ObservedDeposit } from "../types";
import { EXPLORERS, SOL_FEE_LAMPORTS, SOURCE_NAMES, btcVsize, type TestnetEndpoints } from "./config";
import { getJson, jsonRpc } from "./rpc";

/* ---------- Bitcoin (Esplora) ---------- */

interface EsploraStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
}
interface EsploraTx {
  txid: string;
  status: { confirmed: boolean; block_time?: number };
  vin: { prevout: { scriptpubkey_address?: string } | null }[];
  vout: { scriptpubkey_address?: string; value: number }[];
}

/** Fastest fee rate Esplora offers, at least 2 sat/vB so testnet4 withdrawals confirm promptly. */
export async function btcFeeRate(esplora: string) {
  const estimates = (await getJson<Record<string, number>>(`${esplora}/fee-estimates`)) ?? {};
  const fastest = Object.entries(estimates).sort(([a], [b]) => Number(a) - Number(b))[0]?.[1] ?? 0;
  return Math.max(2, Math.ceil(fastest));
}

export async function observeBtc(address: string, ep: TestnetEndpoints): Promise<ChainObservation> {
  const [info, txs, rate] = await Promise.all([
    getJson<{ chain_stats: EsploraStats; mempool_stats: EsploraStats }>(`${ep.esplora}/address/${address}`),
    getJson<EsploraTx[]>(`${ep.esplora}/address/${address}/txs`),
    btcFeeRate(ep.esplora),
  ]);
  const confirmed = info ? info.chain_stats.funded_txo_sum - info.chain_stats.spent_txo_sum : 0;
  const pending = info ? Math.max(0, info.mempool_stats.funded_txo_sum - info.mempool_stats.spent_txo_sum) : 0;
  // Deposits are transactions that pay this address and spend nothing from it.
  const deposits: ObservedDeposit[] = (txs ?? [])
    .filter((t) => !t.vin.some((i) => i.prevout?.scriptpubkey_address === address))
    .slice(0, 10)
    .map((t) => ({
      txHash: t.txid,
      amount: String(t.vout.filter((o) => o.scriptpubkey_address === address).reduce((s, o) => s + o.value, 0)),
      confirmed: t.status.confirmed,
      at: t.status.block_time ? t.status.block_time * 1000 : Date.now(),
      explorerUrl: EXPLORERS.tx.btc(t.txid),
    }));
  return {
    chain: "btc",
    address,
    confirmed: String(confirmed),
    pending: String(pending),
    source: SOURCE_NAMES.btc,
    observedAt: Date.now(),
    explorerUrl: EXPLORERS.address.btc(address),
    deposits,
    feeEstimate: String(rate * btcVsize(1)),
    simulated: false,
  };
}

/* ---------- Base (EVM JSON-RPC) ---------- */

export async function observeEvm(address: string, ep: TestnetEndpoints): Promise<ChainObservation> {
  const [latest, pendingBal, gasPrice] = await Promise.all([
    jsonRpc<string>(ep.evm, "eth_getBalance", [address, "latest"]),
    jsonRpc<string>(ep.evm, "eth_getBalance", [address, "pending"]),
    jsonRpc<string>(ep.evm, "eth_gasPrice", []),
  ]);
  const confirmed = BigInt(latest);
  const pending = BigInt(pendingBal) > confirmed ? BigInt(pendingBal) - confirmed : 0n;
  return {
    chain: "evm",
    address,
    confirmed: confirmed.toString(),
    pending: pending.toString(),
    source: SOURCE_NAMES.evm,
    observedAt: Date.now(),
    explorerUrl: EXPLORERS.address.evm(address),
    // A plain RPC has no deposit index; the explorer link lists them.
    deposits: [],
    feeEstimate: (21_000n * BigInt(gasPrice)).toString(),
    simulated: false,
  };
}

/* ---------- Solana (JSON-RPC) ---------- */

export async function observeSol(address: string, ep: TestnetEndpoints): Promise<ChainObservation> {
  const [finalized, processed, sigs] = await Promise.all([
    jsonRpc<{ value: number }>(ep.solana, "getBalance", [address, { commitment: "finalized" }]),
    jsonRpc<{ value: number }>(ep.solana, "getBalance", [address, { commitment: "processed" }]),
    jsonRpc<{ signature: string; blockTime: number | null; confirmationStatus: string; err: unknown }[]>(
      ep.solana,
      "getSignaturesForAddress",
      [address, { limit: 5 }],
    ),
  ]);
  const deposits: ObservedDeposit[] = [];
  for (const s of sigs.filter((x) => !x.err)) {
    const tx = await jsonRpc<{
      meta: { preBalances: number[]; postBalances: number[] } | null;
      transaction: { message: { accountKeys: { pubkey: string }[] } };
    } | null>(ep.solana, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    const i = tx?.transaction.message.accountKeys.findIndex((k) => k.pubkey === address) ?? -1;
    if (!tx?.meta || i < 0) continue;
    const delta = tx.meta.postBalances[i] - tx.meta.preBalances[i];
    // Only incoming value is a deposit; the vault's own withdrawals show up in its withdrawals list.
    if (delta <= 0 || i === 0) continue;
    deposits.push({
      txHash: s.signature,
      amount: String(delta),
      confirmed: s.confirmationStatus === "finalized",
      at: s.blockTime ? s.blockTime * 1000 : Date.now(),
      explorerUrl: EXPLORERS.tx.sol(s.signature),
    });
  }
  return {
    chain: "sol",
    address,
    confirmed: String(finalized.value),
    pending: String(Math.max(0, processed.value - finalized.value)),
    source: SOURCE_NAMES.sol,
    observedAt: Date.now(),
    explorerUrl: EXPLORERS.address.sol(address),
    deposits,
    feeEstimate: SOL_FEE_LAMPORTS.toString(),
    simulated: false,
  };
}
