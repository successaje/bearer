"use client";

import { useQuery } from "@tanstack/react-query";
import { LOCKED_CONTRACTS, PROOF_CONTRACT, PROOF_RPC, PROOF_SIGNER, TLA_FLEET } from "./data";

/** One JSON-RPC query, straight from the browser to a public NEAR RPC: no Bearer server involved. */
async function query<T>(params: Record<string, unknown>): Promise<T> {
  let res: Response;
  // Public RPCs rate-limit bursts; the all-contracts table asks a few dozen questions at once.
  for (let attempt = 0; ; attempt++) {
    res = await fetch(PROOF_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "proof", method: "query", params: { finality: "final", ...params } }),
    });
    if (res.status !== 429 || attempt >= 3) break;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  const body = await res.json();
  const err = body.error ?? body.result?.error;
  if (err) throw new Error(typeof err === "string" ? err : JSON.stringify(err));
  return body.result as T;
}

async function view<T>(account: string, method: string, args: object = {}): Promise<T> {
  const r = await query<{ result: number[] }>({
    request_type: "call_function",
    account_id: account,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

export interface LiveChecks {
  codeHash: string;
  storageBytes: number;
  fullAccessKeys: number;
  functionCallKeys: number;
  signerVersion: string;
  vaults: string;
  config: {
    evm_chain_ids: number[];
    max_btc_inputs: number;
    create_deposit: string;
    withdraw_deposit: string;
  };
  blockHeight: number;
  checkedAt: number;
}

async function runChecks(): Promise<LiveChecks> {
  const [account, keys, signerVersion, vaults, config] = await Promise.all([
    query<{ code_hash: string; storage_usage: number; block_height: number }>({ request_type: "view_account", account_id: PROOF_CONTRACT }),
    query<{ keys: { access_key: { permission: unknown } }[] }>({ request_type: "view_access_key_list", account_id: PROOF_CONTRACT }),
    view<string>(PROOF_SIGNER, "version"),
    view<string>(PROOF_CONTRACT, "nft_total_supply"),
    view<LiveChecks["config"]>(PROOF_CONTRACT, "get_config"),
  ]);
  const full = keys.keys.filter((k) => k.access_key.permission === "FullAccess").length;
  return {
    codeHash: account.code_hash,
    storageBytes: account.storage_usage,
    fullAccessKeys: full,
    functionCallKeys: keys.keys.length - full,
    signerVersion,
    vaults,
    config,
    blockHeight: account.block_height,
    checkedAt: Date.now(),
  };
}

export function useLiveChecks() {
  return useQuery({ queryKey: ["proof", PROOF_CONTRACT], queryFn: runChecks, staleTime: 30_000, retry: 1 });
}

/** The same check as a command anyone can paste into a terminal. */
export function curlFor(requestType: string, extra: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "query",
    params: { request_type: requestType, finality: "final", account_id: PROOF_CONTRACT, ...extra },
  });
  return `curl -s ${PROOF_RPC} -H 'content-type: application/json' -d '${body}'`;
}

/** One locked contract as the chain describes it now. */
export interface ContractLive {
  account: string;
  codeHash: string;
  keys: number;
  fullAccessKeys: number;
  /** From the contract's own NEP-330 source metadata: the commit and image it says it was built from. */
  rev: string | null;
  link: string | null;
  image: string | null;
}

export interface FleetLive {
  accounts: { account: string; codeHash: string; keys: number }[];
  tlaLifecycle: string;
  tlaExpiresAtNs: string;
  /** When the registry's NEAR/USD rate goes stale; after that nothing can be renewed. */
  rateStaleAtNs: string;
  /** House of Stake's shared wallet account: theirs, so its keys stay. */
  walletImplKeys: number;
}

export interface LockedLive {
  contracts: ContractLive[];
  fleet: FleetLive;
  blockHeight: number;
  checkedAt: number;
}

async function keysOf(account: string) {
  const r = await query<{ keys: { access_key: { permission: unknown } }[]; block_height: number }>({ request_type: "view_access_key_list", account_id: account });
  return { keys: r.keys.length, fullAccessKeys: r.keys.filter((k) => k.access_key.permission === "FullAccess").length, blockHeight: r.block_height };
}

const codeHashOf = async (account: string) => (await query<{ code_hash: string }>({ request_type: "view_account", account_id: account })).code_hash;

/** Runs `tasks` a few at a time, so one page load doesn't burst a public RPC. */
async function inBatches<T>(tasks: (() => Promise<T>)[], size = 6): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += size) out.push(...(await Promise.all(tasks.slice(i, i + size).map((t) => t()))));
  return out;
}

async function contractLive(account: string): Promise<{ live: ContractLive; blockHeight: number }> {
  const [codeHash, keys, meta] = await Promise.all([
    codeHashOf(account),
    keysOf(account),
    view<{ link?: string; build_info?: { build_environment?: string; source_code_snapshot?: string } }>(account, "contract_source_metadata").catch(() => null),
  ]);
  const live: ContractLive = {
    account,
    codeHash,
    keys: keys.keys,
    fullAccessKeys: keys.fullAccessKeys,
    rev: meta?.build_info?.source_code_snapshot?.match(/rev=([0-9a-f]{40})/)?.[1] ?? null,
    link: meta?.link ?? null,
    image: meta?.build_info?.build_environment?.split("@")[0] ?? null,
  };
  return { live, blockHeight: keys.blockHeight };
}

async function runLocked(): Promise<LockedLive> {
  const contracts = await inBatches(LOCKED_CONTRACTS.map((c) => () => contractLive(c.account)), 3);
  const accounts = await inBatches(
    TLA_FLEET.accounts.map((a) => async () => {
      const [codeHash, k] = await Promise.all([codeHashOf(a.account), keysOf(a.account)]);
      return { account: a.account, codeHash, keys: k.keys };
    }),
    3,
  );
  const [tla, rate, fees, wallet] = await Promise.all([
    view<{ lifecycle: string; expires_at: string }>(TLA_FLEET.registry, "get_tla", { tla_id: TLA_FLEET.root }),
    view<{ updated_at: string }>(TLA_FLEET.registry, "get_rate_meta"),
    view<{ max_rate_age_ns: string }>(TLA_FLEET.registry, "get_fee_config"),
    keysOf(TLA_FLEET.walletImpl),
  ]);
  return {
    contracts: contracts.map((c) => c.live),
    fleet: {
      accounts,
      tlaLifecycle: tla.lifecycle,
      tlaExpiresAtNs: tla.expires_at,
      rateStaleAtNs: (BigInt(rate.updated_at) + BigInt(fees.max_rate_age_ns)).toString(),
      walletImplKeys: wallet.keys,
    },
    blockHeight: Math.max(...contracts.map((c) => c.blockHeight)),
    checkedAt: Date.now(),
  };
}

/** Every locked contract and the TLA fleet, read live from the reader's browser. */
export function useLockedContracts() {
  return useQuery({ queryKey: ["proof", "locked"], queryFn: runLocked, staleTime: 30_000, retry: 1 });
}
