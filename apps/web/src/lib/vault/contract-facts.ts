import { BEARER_CONTRACT, CODE_HASH, IS_SIMULATED, NEAR_RPC } from "@/lib/config";

/** What the chain says about the contract itself, for the seal panel's lock and code checks. */
export interface ContractFacts {
  /** `null` while unknown. */
  locked: boolean | null;
  fullAccessKeys: number | null;
  codeHash: string | null;
  /** True for the in-browser demo, where these are illustrative. */
  simulated: boolean;
}

export const SIMULATED_FACTS: ContractFacts = { locked: true, fullAccessKeys: 0, codeHash: CODE_HASH, simulated: true };

async function query<T>(params: Record<string, unknown>): Promise<T> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "facts", method: "query", params: { finality: "final", account_id: BEARER_CONTRACT, ...params } }),
  });
  const body = await res.json();
  if (body.error ?? body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error));
  return body.result as T;
}

export async function fetchContractFacts(): Promise<ContractFacts> {
  if (IS_SIMULATED) return SIMULATED_FACTS;
  const [keys, account] = await Promise.all([
    query<{ keys: { access_key: { permission: unknown } }[] }>({ request_type: "view_access_key_list" }),
    query<{ code_hash: string }>({ request_type: "view_account" }),
  ]);
  const full = keys.keys.filter((k) => k.access_key.permission === "FullAccess").length;
  return { locked: full === 0, fullAccessKeys: full, codeHash: account.code_hash, simulated: false };
}
