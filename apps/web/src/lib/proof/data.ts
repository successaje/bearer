/**
 * Evidence shown on /proof. Every number here was measured on testnet and comes from a report
 * committed in contracts/tests/spike/reports (named in `source`), or from docs/THREAT_MODEL.md.
 * Update both together; never round a number into something it wasn't.
 */

export const PROOF_CONTRACT = process.env.NEXT_PUBLIC_PROOF_CONTRACT || "v3a.bearer-1108-ffb3.testnet";
export const PROOF_SIGNER = "v1.signer-prod.testnet";
export const PROOF_RPC = process.env.NEXT_PUBLIC_NEAR_RPC || "https://test.rpc.fastnear.com";
export const MEASURED_ON = "2026-11-08";

const REPORTS = "contracts/tests/spike/reports";
const nearTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

export interface Run {
  ms: number;
  tgas: number;
  tx: string;
}

export interface Series {
  id: string;
  title: string;
  detail: string;
  /** What the time measures, in plain words. */
  measures: string;
  /** "repeats": N runs of the same request (median shown). "sweep": one run per setting (range shown). */
  kind: "repeats" | "sweep";
  runs: Run[];
  source: string;
}

export const LATENCY: Series[] = [
  {
    id: "evm",
    title: "Base withdrawal",
    detail: "withdraw_evm through the contract · secp256k1 (domain 0)",
    measures: "Submit → signed transaction visible in the contract's view",
    kind: "repeats",
    runs: [
      { ms: 8418, tgas: 16.694, tx: "https://testnet.nearblocks.io/txns/3NqsPt5FvNhEJ7ZgqupB1c8CnmG7qh5gP88fnP1uVNtp" },
      { ms: 7481, tgas: 14.462, tx: "https://testnet.nearblocks.io/txns/28PfdoKbNSod52LDDFhpSBzC1YQfdYfaJxoqvgWK99Ek" },
      { ms: 7703, tgas: 14.463, tx: "https://testnet.nearblocks.io/txns/G4Nxg98nPXRxSXPBdRpqMuyBcwwht2eUM6p36xdHW93c" },
      { ms: 7430, tgas: 14.465, tx: "https://testnet.nearblocks.io/txns/HfBWsc7WhmoEdwxk3z8X6FKx5Lpq9yDnH8bE86mAhS8P" },
      { ms: 7727, tgas: 14.463, tx: "https://testnet.nearblocks.io/txns/MNZsUQtdugTYJsuHCZCkntKfBdtF5qZC1xu2Z1Ex6Zk" },
    ],
    source: `${REPORTS}/testnet-sign-2026-11-08T21-40-03.590Z.json`,
  },
  {
    id: "ed25519",
    title: "Ed25519 signature",
    detail: "the signer's Solana domain (domain 1), called directly",
    measures: "Submit → final outcome with the signature",
    kind: "repeats",
    runs: [
      { ms: 8080, tgas: 8.516, tx: "https://testnet.nearblocks.io/txns/HtkD3MKKzUdEwrfNiuQth4jj214ntcBG6bim3KCr4k2e" },
      { ms: 7436, tgas: 8.515, tx: "https://testnet.nearblocks.io/txns/G411pET9LiiC8LziXtPiuuhV54bm1vnbA2WiY8ffEQzW" },
      { ms: 7700, tgas: 8.517, tx: "https://testnet.nearblocks.io/txns/EodpVbpktgVQqT4DBAejENKJjpJ6A3H7nNUBLHsovcqN" },
      { ms: 7978, tgas: 8.517, tx: "https://testnet.nearblocks.io/txns/9SRXw5Pieterc7tRu5eACv1mVwsJYYk9FhhapjsMVb1E" },
      { ms: 8017, tgas: 8.514, tx: "https://testnet.nearblocks.io/txns/Db3mg49xrRnQiVR7jTdmFBaMwsSi5CvDTqXYKrkjBJgG" },
    ],
    source: `${REPORTS}/testnet-sign-2026-11-08T21-40-03.590Z.json`,
  },
  {
    id: "btc",
    title: "Bitcoin withdrawal",
    detail: "withdraw_btc, 1 → 4 inputs joined into one callback",
    measures: "Submit → signed transaction visible in the contract's view",
    kind: "sweep",
    runs: [
      { ms: 8402, tgas: 15.051, tx: "https://testnet.nearblocks.io/txns/6sgHQHE1ZF7oyANs12vo51ZjBKAwbft4ZLdSod8DfBUg" },
      { ms: 6550, tgas: 24.224, tx: "https://testnet.nearblocks.io/txns/ERyCn7csjhWSHAFGW4e7R1628K9SkQxPCSsa6PivbsDp" },
      { ms: 7830, tgas: 33.387, tx: "https://testnet.nearblocks.io/txns/CcfMaWKDeUKCw2HYQ9Ku7yFU8gw5KHuSNkgTkidAhHWJ" },
      { ms: 7099, tgas: 42.599, tx: "https://testnet.nearblocks.io/txns/36qY45goGQa5ugznPh9ixF2ENVLshfY9ZnYcG23dkE3g" },
    ],
    source: `${REPORTS}/testnet-btc-joined-2026-11-08T22-26-24.540Z.json`,
  },
  {
    id: "sol",
    title: "Solana withdrawal",
    detail: "withdraw_sol through the contract · Ed25519 checked on-chain",
    measures: "Submit → signed transaction visible in the contract's view",
    kind: "repeats",
    runs: [
      { ms: 8287, tgas: 14.759, tx: "https://testnet.nearblocks.io/txns/AWiMXRvuX3sRdVEmbcQ76TfEJahjuRE3yZssj26hpsvu" },
    ],
    source: `${REPORTS}/testnet-sol-withdraw-2026-11-08T22-51-57.356Z.json`,
  },
];

/** Bitcoin callback gas: what the contract reserves vs what it used, per input count. */
export const BTC_CALLBACK = {
  reservedTgas: 30,
  used: [
    { inputs: 1, tgas: 2.802, total: 15.051, vbytes: 141 },
    { inputs: 2, tgas: 3.343, total: 24.224, vbytes: 209 },
    { inputs: 3, tgas: 3.883, total: 33.387, vbytes: 277 },
    { inputs: 4, tgas: 4.422, total: 42.599, vbytes: 345 },
  ],
  txLimitTgas: 300,
  source: `${REPORTS}/testnet-btc-joined-2026-11-08T22-26-24.540Z.json`,
};

export interface Landed {
  chain: "evm" | "btc" | "sol";
  title: string;
  status: "confirmed" | "signed" | "waiting";
  detail: string;
  href?: string;
  linkLabel?: string;
}

/** Withdrawals that left NEAR and reached the other chain. */
export const LANDED: Landed[] = [
  {
    chain: "evm",
    title: "Base Sepolia",
    status: "confirmed",
    detail: "Vault No. 0002 → itself, 0.000001 ETH · block 56,270,095 · receipt 2.0 s after broadcast",
    href: "https://sepolia.basescan.org/tx/0xb347d755df6105ef2deb58158533f31fa5687586992308ee2fed0e4622ee20e3",
    linkLabel: "0xb347…20e3",
  },
  {
    chain: "btc",
    title: "Bitcoin testnet4",
    status: "confirmed",
    detail: "Vault No. 0004, handed from alice to bob, opened and withdrawn in one NEAR transaction · signed in 6.5 s · block 159,948",
    href: "https://mempool.space/testnet4/tx/ce01f9fffdf0f362641a4f6882257295ae63de6146c5a3478704ef809bf958b6",
    linkLabel: "ce01f9ff…58b6",
  },
  {
    chain: "sol",
    title: "Solana devnet",
    status: "signed",
    detail: "Signed and verified; devnet's simulation passes signature checks. Broadcast waits for devnet SOL",
    href: nearTx("AWiMXRvuX3sRdVEmbcQ76TfEJahjuRE3yZssj26hpsvu"),
    linkLabel: "NEAR tx",
  },
];

export type ThreatStatus = "proven" | "partly" | "open" | "policy";

export interface Threat {
  id: string;
  attack: string;
  defence: string;
  tests: string[];
  status: ThreatStatus;
  /** Which chains the proof covers, when it is per chain. */
  chains?: string;
}

/** docs/THREAT_MODEL.md, rows T1–T17. */
export const THREATS: Threat[] = [
  {
    id: "T1",
    attack: "Former owner withdraws after transferring",
    defence: "withdraw_* and break_seal require the caller to be the owner",
    tests: ["alice_cannot_withdraw_after_transfer", "alice_cannot_break_seal_after_transfer", "alice_cannot_withdraw_btc_after_transfer", "alice_cannot_withdraw_sol_after_transfer"],
    status: "proven",
    chains: "Base, Bitcoin, Solana",
  },
  {
    id: "T2",
    attack: "Transfer an opened vault, by any path",
    defence: "One transfer gate, which refuses opened vaults; no other code changes the owner",
    tests: ["opened_vault_rejects_nft_transfer", "nft_transfer_call"],
    status: "proven",
  },
  {
    id: "T3",
    attack: "Keep a signature for a sealed vault",
    defence: "No signature can be requested while sealed; the signer sees no call",
    tests: ["sealed_vault_cannot_request_signature", "…_btc_signature", "…_sol_signature"],
    status: "proven",
  },
  {
    id: "T4",
    attack: "Race break_seal against a transfer",
    defence: "Receipts run one at a time; whichever runs first wins, the other fails cleanly",
    tests: ["race_break_then_transfer", "race_transfer_then_break"],
    status: "proven",
  },
  {
    id: "T5",
    attack: "Transfer while a withdrawal is being signed",
    defence: "A signature in flight means the vault is opened, which refuses transfers",
    tests: ["transfer_rejected_during_pending_signature"],
    status: "proven",
  },
  {
    id: "T6",
    attack: "Bypass the gate: approvals, the transfer_call return leg, a forgotten path",
    defence: "No approvals extension; the return leg uses the gate; a test fails if any other code writes the owner",
    tests: ["nft_approve_not_exposed", "single_owner_write_path", "resolve_keeps_opened_vault_with_receiver (to do)"],
    status: "partly",
  },
  {
    id: "T7",
    attack: "Make the contract sign arbitrary bytes",
    defence: "Typed withdrawals only, built in-contract: EVM native transfer, Bitcoin SIGHASH_ALL with change to the vault, Solana one system transfer with a recent blockhash",
    tests: ["rejects_calldata_shapes", "bip143_native_p2wpkh_vector", "rejects bad Bitcoin spends", "sol_single_transfer_only", "rejects bad Solana params"],
    status: "proven",
    chains: "Base, Bitcoin, Solana",
  },
  {
    id: "T8",
    attack: "Collide derivation paths to sign for another vault",
    defence: "Paths built only by the contract from sequential IDs and fixed chain tags",
    tests: ["paths_unique_per_vault_and_chain"],
    status: "proven",
  },
  {
    id: "T9",
    attack: "A signer timeout or error leaves the vault stuck",
    defence: "The callback never panics; the record fails, the vault stays opened, a retry works",
    tests: ["failed_signature_can_retry", "a failed Bitcoin signature fails the whole withdrawal", "a failed Ed25519 signature fails the withdrawal"],
    status: "proven",
    chains: "Base, Bitcoin, Solana",
  },
  {
    id: "T10",
    attack: "Two signatures exist after a retry",
    defence: "Both pay the same owner and spend the same coins or nonce; at most one confirms",
    tests: ["sim_double_signature_only_one_confirms (to do)"],
    status: "open",
  },
  {
    id: "T11",
    attack: "Admin or upgrade powers",
    defence: "No admin, upgrade or raw-sign methods; full-access keys deleted; code hash published",
    tests: ["no_privileged_methods", "lock-contract.sh (at the locked deploy)"],
    status: "partly",
  },
  {
    id: "T12",
    attack: "Drain storage to freeze the contract",
    defence: "Every state-growing call pays; the custody log is capped at 16",
    tests: ["create_deposit_covers_max_vault", "create_vault_requires_gas_for_keys"],
    status: "partly",
  },
  {
    id: "T13",
    attack: "A stale claim link after a transfer or opening",
    defence: "Only if claim links ship: every transfer and break_seal deletes the key",
    tests: [],
    status: "open",
  },
  {
    id: "T14",
    attack: "A seller takes payment and never transfers",
    defence: "Out of scope: Bearer guarantees what you receive, not that someone pays you. Said on the How page",
    tests: [],
    status: "policy",
  },
  {
    id: "T15",
    attack: "Wrong display data from an indexer",
    defence: "Balances are labelled observed, with source and time; the contract never relies on them",
    tests: [],
    status: "policy",
  },
  {
    id: "T16",
    attack: "Deposits on the wrong network",
    defence: "Warnings in the deposit flow; the contract signs only for Base Sepolia",
    tests: [],
    status: "policy",
  },
  {
    id: "T17",
    attack: "The signer returns a signature for the wrong key",
    defence: "The callback checks every signature against the vault's own key before storing anything",
    tests: ["rejects_signature_from_wrong_key", "wrong-key Bitcoin and Ed25519 cases"],
    status: "proven",
    chains: "Base, Bitcoin, Solana",
  },
];

export const RUN_IT = [
  { label: "Unit tests (vectors: BIP143, BIP173/350, RLP, low-S, Solana shortvec)", cmd: "cargo test --manifest-path contracts/Cargo.toml" },
  { label: "Sandbox tests (bitcoinjs-lib, noble and @solana/web3.js check every signature)", cmd: "pnpm test:contracts" },
  { label: "Testnet signing spike against the real MPC signer", cmd: "cd contracts/tests && pnpm spike:testnet run" },
];
