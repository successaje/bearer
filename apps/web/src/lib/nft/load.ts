import type { VaultView } from "@bearer/sdk";
import { BEARER_CONTRACT, IS_SIMULATED } from "@/lib/config";

const NEAR_RPC = process.env.NEXT_PUBLIC_NEAR_RPC || "https://test.rpc.fastnear.com";

/**
 * A vault as the server sees it: from the contract on testnet, or from the seeded demo in mock
 * mode (the browser-only mock state isn't visible here, so only the demo vaults exist).
 */
export async function loadVault(id: string): Promise<VaultView | null> {
  if (!/^\d{1,9}$/.test(id)) return null;
  if (IS_SIMULATED) {
    const { seedState } = await import("@/lib/vault/mock-data");
    return seedState(Date.now()).vaults[id]?.view ?? null;
  }
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "nft",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: BEARER_CONTRACT,
        method_name: "vault",
        args_base64: Buffer.from(JSON.stringify({ token_id: id })).toString("base64"),
      },
    }),
    cache: "no-store",
  });
  const body = await res.json();
  if (body.error || body.result?.error) return null;
  return JSON.parse(Buffer.from(body.result.result).toString()) as VaultView | null;
}
