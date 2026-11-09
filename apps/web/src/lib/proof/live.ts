"use client";

import { useQuery } from "@tanstack/react-query";
import { PROOF_CONTRACT, PROOF_RPC, PROOF_SIGNER } from "./data";

/** One JSON-RPC query, straight from the browser to a public NEAR RPC: no Bearer server involved. */
async function query<T>(params: Record<string, unknown>): Promise<T> {
  const res = await fetch(PROOF_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "proof", method: "query", params: { finality: "final", ...params } }),
  });
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
