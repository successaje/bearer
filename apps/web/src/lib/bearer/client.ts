import { NETWORK } from "@/lib/config";
import {
  BearerError,
  type Card,
  type ClaimLookup,
  type Finish,
  type OpenInput,
  type OpenRequest,
} from "./types";

/**
 * Everything the web app needs from Bearer. The mock implementation runs in the browser;
 * the testnet implementation will wrap @bearer/sdk once it exists (brief 4.9).
 */
export interface BearerClient {
  listCards(owner: string): Promise<Card[]>;
  getCard(id: string): Promise<Card | null>;
  createCard(input: { name: string; finish: Finish }, signer: string): Promise<Card>;

  handOver(id: string, receiver: string, signer: string): Promise<Card>;
  createClaimLink(id: string, signer: string): Promise<{ key: string }>;
  cancelClaimLink(id: string, signer: string): Promise<Card>;
  getClaim(key: string): Promise<ClaimLookup>;
  claim(key: string, receiver: string): Promise<Card>;
  createAccountAndClaim(key: string, newAccountId: string): Promise<Card>;

  list(id: string, priceNear: string, signer: string): Promise<Card>;
  delist(id: string, signer: string): Promise<Card>;
  buy(id: string, buyer: string, expectedLogVersion: number): Promise<Card>;

  open(id: string, input: OpenInput, signer: string): Promise<OpenRequest>;
  getRequest(requestId: string): Promise<OpenRequest | null>;
  proveEvmSettled(id: string): Promise<Card>;
  expirePending(id: string, idx: number): Promise<Card>;

  accountExists(accountId: string): Promise<boolean>;

  /** Mock only: pretend a deposit arrived. */
  simulateDeposit?(id: string, chain: "btc" | "evm" | "sol"): Promise<Card>;
  /** Mock only: restore the seeded demo cards. */
  reset?(): void;
}

class UnconfiguredTestnetClient implements BearerClient {
  private fail(): never {
    throw new BearerError(
      "NOT_SUPPORTED",
      "Testnet mode needs @bearer/sdk and a deployed contract. Run with NEXT_PUBLIC_NETWORK=mock for now.",
    );
  }
  listCards = async () => this.fail();
  getCard = async () => this.fail();
  createCard = async () => this.fail();
  handOver = async () => this.fail();
  createClaimLink = async () => this.fail();
  cancelClaimLink = async () => this.fail();
  getClaim = async () => this.fail();
  claim = async () => this.fail();
  createAccountAndClaim = async () => this.fail();
  list = async () => this.fail();
  delist = async () => this.fail();
  buy = async () => this.fail();
  open = async () => this.fail();
  getRequest = async () => this.fail();
  proveEvmSettled = async () => this.fail();
  expirePending = async () => this.fail();
  accountExists = async () => this.fail();
}

let client: BearerClient | null = null;

export async function getBearerClient(): Promise<BearerClient> {
  if (client) return client;
  if (NETWORK === "mock") {
    const { MockBearerClient } = await import("./mock-client");
    client = new MockBearerClient();
  } else {
    client = new UnconfiguredTestnetClient();
  }
  return client;
}
