import type { VaultView } from "@bearer/sdk";
import { BEARER_CONTRACT, IS_SIMULATED } from "@/lib/config";

const NEAR_RPC = process.env.NEXT_PUBLIC_NEAR_RPC || "https://test.rpc.fastnear.com";

/**
 * The mainnet deployment: the same locked build as bearer.testnet, on a sub-account named at deploy
 * time (docs/features/mainnet.md). Its token media is `{base_uri}/{id}.svg` with base_uri
 * `https://bearer-near.vercel.app/nft/mainnet`, served by app/nft/mainnet/[file].
 */
export const MAINNET = {
  contract: process.env.MAINNET_BEARER_CONTRACT || null,
  rpc: process.env.NEAR_MAINNET_RPC || "https://rpc.mainnet.fastnear.com",
};

/**
 * A vault as the server sees it: from the contract on testnet, or from the seeded demo in mock
 * mode (the browser-only mock state isn't visible here, so only the demo vaults exist). With
 * `mainnet`, from the mainnet contract, whatever the site's own network.
 */
export async function loadVault(id: string, { mainnet = false }: { mainnet?: boolean } = {}): Promise<VaultView | null> {
  if (!/^\d{1,9}$/.test(id)) return null;
  if (mainnet && !MAINNET.contract) return null;
  if (IS_SIMULATED && !mainnet) {
    const { seedState } = await import("@/lib/vault/mock-data");
    return seedState(Date.now()).vaults[id]?.view ?? null;
  }
  const res = await fetch(mainnet ? MAINNET.rpc : NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "nft",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: mainnet ? MAINNET.contract : BEARER_CONTRACT,
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
