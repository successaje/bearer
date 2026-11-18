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

/**
 * Copy for the standing-payments contract's errors. Several codes (ERR_NOT_DUE, ERR_NOT_GIVER,
 * ERR_INTERVAL, ERR_IN_PROGRESS) mean something else on the other escrows, so these come first.
 */
export function standingErrorCopy(error: unknown): string {
  if (error instanceof VaultError) return error.detail;
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("ERR_NOT_PAYEE")) return "Only the payee named in the plan can collect.";
  if (text.includes("ERR_NOT_DUE")) return "The next payment isn't due yet.";
  if (text.includes("ERR_ENDED")) return "These payments have ended.";
  if (text.includes("ERR_FEE_TOO_HIGH")) return "The network fee is above what the giver allowed. Try again when fees are lower.";
  if (text.includes("ERR_NOT_GIVER")) return "Only the person who set up the payments can do that.";
  if (text.includes("ERR_NOT_CANCELLABLE")) return "These payments were set up so that nobody can stop them.";
  if (text.includes("ERR_PLAN_BINDING")) return "These payments can't be stopped, so this waits until they end.";
  if (text.includes("ERR_VAULT_OPENED")) return "The first payment opened this vault, and opened vaults never change hands. Withdraw through the plan instead.";
  if (text.includes("ERR_VAULT_SEALED")) return "It's still sealed: take the vault back instead.";
  if (text.includes("ERR_IN_PROGRESS")) return "A payment or withdrawal is already settling. Try again in a moment.";
  if (text.includes("ERR_REFUSED")) return "Bearer refused it, so nothing was signed and the deposit went back. Check the vault's balance and try again.";
  if (text.includes("ERR_UNSETTLED")) return "Bearer's answer couldn't be read back yet. Nothing is lost; check again in a moment.";
  if (text.includes("ERR_PAYEE")) return "Name someone else to collect the payments.";
  if (text.includes("ERR_INTERVAL")) return "Choose a period between a minute and ten years.";
  if (text.includes("ERR_IRREVOCABLE_NEEDS_AN_END")) return "A plan nobody can stop needs a number of payments.";
  if (text.includes("ERR_NO_PLAN_DEPOSIT")) return "The plan deposit didn't arrive, so the vault came back. Try again.";
  if (text.includes("ERR_INSUFFICIENT_FUNDS")) return "The vault doesn't hold enough confirmed coins for this payment and its fee.";
  return errorCopy(error);
}

/** Plain-language copy for each contract error (brief 10.4). */
export function errorCopy(error: unknown): string {
  if (error instanceof VaultError) return error.detail;
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("ERR_NOT_OWNER")) return "Only the vault's current owner can do that.";
  if (text.includes("NotEnoughBalance")) return "This account doesn't have enough NEAR to pay this transaction's fee up front.";
  if (text.includes("ERR_VAULT_OPENED")) return "Opened vaults can't change hands.";
  if (text.includes("ERR_VAULT_SEALED")) return "Break the seal first. That's what makes withdrawals possible, and it can't be undone.";
  if (text.includes("ERR_WRONG_PRICE")) return "The price changed. Check the listing and try again.";
  if (text.includes("ERR_SALE_PENDING")) return "Someone is already buying this vault, or it's being delisted.";
  if (text.includes("ERR_NOT_LISTED")) return "This vault isn't for sale any more.";
  if (text.includes("ERR_OWN_LISTING")) return "You listed this vault. Delist it instead.";
  if (text.includes("ERR_NOT_SELLER")) return "Only the seller can delist this vault.";
  if (text.includes("ERR_PRICE")) return "The lowest price is 0.001 NEAR.";
  if (text.includes("ERR_TOO_EARLY")) return "It can't be handed over before its date.";
  if (text.includes("ERR_TOO_LATE")) return "The date has passed, so it can only be handed over now.";
  if (text.includes("ERR_NOT_CANCELLABLE")) return "This handover was scheduled so that nobody can cancel it.";
  if (text.includes("ERR_NOT_GIVER")) return "Only the person who scheduled it can cancel it.";
  if (text.includes("ERR_DATE_TOO_SOON")) return "Pick a time at least a minute from now.";
  if (text.includes("ERR_NO_LOAN_DEPOSIT")) return "The loan deposit didn't arrive, so the vault came back. Try again.";
  if (text.includes("ERR_NO_LOAN")) return "This vault isn't pledged for a loan any more.";
  if (text.includes("ERR_NOT_REQUESTED")) return "Someone has already lent against this vault, or its request was taken back.";
  if (text.includes("ERR_OWN_LOAN")) return "You asked for this loan, so you can't fund it yourself.";
  if (text.includes("ERR_WRONG_PRINCIPAL")) return "The loan amount changed. Check it and try again.";
  if (text.includes("ERR_TERMS_CHANGED")) return "The terms changed since you looked. Check them and try again.";
  if (text.includes("ERR_NOT_ACTIVE")) return "This loan isn't running: nobody has lent yet, or it's already settling.";
  if (text.includes("ERR_NOT_BORROWER")) return "Only the borrower can do that.";
  if (text.includes("ERR_NOT_LENDER")) return "Only the lender can take the vault.";
  if (text.includes("ERR_PAST_DUE")) return "The due date has passed, so only the lender can act now.";
  if (text.includes("ERR_NOT_DUE")) return "The borrower can still repay until the due date.";
  if (text.includes("ERR_WRONG_REPAYMENT")) return "The repayment must be exactly the amount agreed.";
  if (text.includes("ERR_PRINCIPAL")) return "The smallest loan is 0.001 NEAR.";
  if (text.includes("ERR_REPAYMENT")) return "The repayment can't be less than the loan.";
  if (text.includes("ERR_TERM")) return "The term must be between a minute and ten years.";
  if (text.includes("ERR_NO_SWITCH_DEPOSIT")) return "The switch deposit didn't arrive, so the vault came back. Try again.";
  if (text.includes("ERR_NO_SWITCH")) return "This vault isn't in a switch any more.";
  if (text.includes("ERR_NOT_SILENT")) return "Its owner checked in recently enough, so it can't be handed over yet.";
  if (text.includes("ERR_BENEFICIARY_MISSING")) return "That account doesn't exist on NEAR, so the vault stays in the switch.";
  if (text.includes("ERR_BENEFICIARY")) return "Name someone else: the vault goes to them if you go quiet.";
  if (text.includes("ERR_INTERVAL")) return "Choose a check-in interval between a minute and ten years.";
  if (text.includes("ERR_IN_PROGRESS")) return "A handover or cancellation is already settling. Try again in a moment.";
  if (text.includes("ERR_NAME_TAKEN")) return "That name is already rented. Pick another.";
  if (text.includes("ERR_ALREADY_NAMED")) return "This vault already has a name; a vault is named once.";
  if (text.includes("ERR_BAD_LABEL")) return "Use 3 to 32 lower-case letters, digits or inner hyphens.";
  if (text.includes("ERR_NAMING_REFUSED")) return "The name wasn't rented, so your deposit went back. Only the vault's holder can name it.";
  if (text.includes("ERR_WITHDRAWAL_REFUSED")) return "Nothing left the name. Only the holder of the opened vault can take NEAR out, and the account keeps what its storage needs.";
  if (text.includes("ERR_NOT_NAMED")) return "This vault has no name yet.";
  return text;
}
