import type { RecordedAttack } from "@bearer/sdk";
import { BEARER_CONTRACT } from "@/lib/config";
import { ATTACK_TESTS } from "./errors";

const ALICE = "alice.bearer-1108-ffb3.testnet";
const BOB = "bob.bearer-1108-ffb3.testnet";
const SENT_AT = "2026-11-09T12:34:55Z";

/**
 * The attack lab's attacks, sent to bearer.testnet as real transactions by the test accounts
 * (`pnpm spike:testnet attacks`; contracts/tests/spike/reports/testnet-attacks-2026-11-09T12-34-55.181Z.json).
 * Vault No. 0001 is opened and bob's; No. 0004 is sealed and bob's; alice held both before him.
 * Each was refused, and none reached the MPC signer.
 */
const BEARER_TESTNET_ATTACKS: RecordedAttack[] = [
  {
    kind: "former_owner_withdraws",
    actor: `${ALICE} (former owner)`,
    call: "withdraw_evm(vault 1)",
    expected: "ERR_NOT_OWNER",
    testName: ATTACK_TESTS.former_owner_withdraws,
    txHash: "F9X8pHP1m2dKZq1JqZixnC9uao9gLL9YusifzEeo8RHz",
    signerId: ALICE,
    sentAt: SENT_AT,
  },
  {
    kind: "former_owner_breaks_seal",
    actor: `${ALICE} (former owner)`,
    call: "break_seal(vault 4)",
    expected: "ERR_NOT_OWNER",
    testName: ATTACK_TESTS.former_owner_breaks_seal,
    txHash: "2BQmo5kJmdRxMyaRUbT8zvT56jGMsh3ZZCCexqCPA6Zm",
    signerId: ALICE,
    sentAt: SENT_AT,
  },
  {
    kind: "transfer_opened_vault",
    actor: `${BOB} (owner)`,
    call: "nft_transfer(vault 1, opened)",
    expected: "ERR_VAULT_OPENED",
    testName: ATTACK_TESTS.transfer_opened_vault,
    txHash: "6GutSDN8MNpS4vq1FGAHeusLehLSpgz7aS4f9VUpA7Ed",
    signerId: BOB,
    sentAt: SENT_AT,
  },
  {
    kind: "withdraw_sealed_vault",
    actor: `${BOB} (owner)`,
    call: "withdraw_evm(vault 4, sealed)",
    expected: "ERR_VAULT_SEALED",
    testName: ATTACK_TESTS.withdraw_sealed_vault,
    txHash: "44XdgiB2NDJYBrh5mx2PJZd5Z3hRfJR5gVPhXWFMKPP8",
    signerId: BOB,
    sentAt: SENT_AT,
  },
  {
    kind: "sign_arbitrary_bytes",
    actor: BOB,
    call: "sign(32 bytes)",
    expected: "MethodNotFound",
    testName: ATTACK_TESTS.sign_arbitrary_bytes,
    txHash: "4FA4AK5psEtSx1h8fW2P5DRM43HV5AnWYwMmhi88QLHv",
    signerId: BOB,
    sentAt: SENT_AT,
  },
];

/** Recorded attacks for the contract this site reads; none for other deployments. */
export const RECORDED_ATTACKS: RecordedAttack[] = BEARER_CONTRACT === "bearer.testnet" ? BEARER_TESTNET_ATTACKS : [];
