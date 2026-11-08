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
  return text;
}
