import type { BearerClient } from "@bearer/sdk";
import { NETWORK } from "@/lib/config";
import { VaultError } from "./errors";

const notReady = async (): Promise<never> => {
  throw new VaultError(
    "NOT_SUPPORTED",
    "Testnet mode needs the @bearer/sdk testnet adapter and a deployed contract. Run with NEXT_PUBLIC_NETWORK=mock for now.",
  );
};

/** Placeholder until the SDK's testnet adapter lands (brief 4.12). */
const testnetClient: BearerClient = {
  listVaults: notReady,
  getVault: notReady,
  getWithdrawals: notReady,
  observe: notReady,
  createVault: notReady,
  transfer: notReady,
  breakSealAndWithdraw: notReady,
  breakSeal: notReady,
  withdraw: notReady,
  trackWithdrawal: notReady,
  runAttack: notReady,
  accountExists: notReady,
};

let client: BearerClient | null = null;

export async function getVaultClient(): Promise<BearerClient> {
  if (client) return client;
  if (NETWORK === "mock") {
    const { MockBearerClient } = await import("./mock-client");
    client = new MockBearerClient();
  } else {
    client = testnetClient;
  }
  return client;
}
