import type { AttackKind } from "@bearer/sdk";

/** A contract-style error. The message starts with the code so `errorCodeOf` finds it. */
export class VaultError extends Error {
  constructor(
    public code: string,
    public detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "VaultError";
  }
}

/** The sandbox test in `contracts/tests/vault.test.ts` that proves each attack fails. */
/** The sandbox test (contracts/tests/vault.test.ts) and threat-model row behind each attack. */
export const ATTACK_TESTS: Record<AttackKind, string> = {
  former_owner_withdraws: "alice_cannot_withdraw_after_transfer (T1)",
  former_owner_breaks_seal: "alice_cannot_break_seal_after_transfer (T1)",
  transfer_opened_vault: "opened_vault_rejects_nft_transfer (T2)",
  withdraw_sealed_vault: "sealed_vault_cannot_request_signature (T3)",
  sign_arbitrary_bytes: "no_privileged_methods (T11)",
};

/** Plain-language copy for each contract error (brief 10.4). */
export function errorCopy(error: unknown): string {
  if (error instanceof VaultError) return error.detail;
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("ERR_NOT_OWNER")) return "Only the vault's current owner can do that.";
  if (text.includes("ERR_VAULT_OPENED")) return "Opened vaults can't change hands.";
  if (text.includes("ERR_VAULT_SEALED")) return "Break the seal first. That's what makes withdrawals possible, and it can't be undone.";
  if (text.includes("ERR_WRONG_PRICE")) return "The price changed. Check the listing and try again.";
  if (text.includes("ERR_SALE_PENDING")) return "Someone is already buying this vault, or it's being delisted.";
  if (text.includes("ERR_NOT_LISTED")) return "This vault isn't for sale any more.";
  if (text.includes("ERR_OWN_LISTING")) return "You listed this vault. Delist it instead.";
  if (text.includes("ERR_NOT_SELLER")) return "Only the seller can delist this vault.";
  if (text.includes("ERR_PRICE")) return "The lowest price is 0.001 NEAR.";
  if (text.includes("ERR_VAULT_NEAR_BELOW_STORAGE")) return "Add a little NEAR to the vault first: each token or NFT it holds uses some for storage.";
  if (text.includes("ERR_TOO_MANY_TOKENS")) return "A vault holds at most 8 kinds of token.";
  if (text.includes("ERR_TOO_MANY_NFTS")) return "A vault holds at most 16 NFTs.";
  if (text.includes("ERR_NO_NESTED_VAULTS")) return "A vault can't hold another vault.";
  if (text.includes("ERR_AMOUNT")) return "Check the amount: it must be above zero and no more than the vault holds.";
  return text;
}
