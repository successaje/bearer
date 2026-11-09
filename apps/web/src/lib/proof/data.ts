/**
 * Evidence shown on /proof. Every number here was measured on testnet and comes from a report
 * committed in contracts/tests/spike/reports (named in `source`), or from docs/THREAT_MODEL.md.
 * Update both together; never round a number into something it wasn't.
 */

/** The locked, reproducibly built contract the live checks read. */
export const PROOF_CONTRACT = process.env.NEXT_PUBLIC_PROOF_CONTRACT || "bearer.testnet";
/** Where the measured runs and landed withdrawals happened (8–9 Nov), before the final contract was locked. */
export const SPIKE_CONTRACT = "v3a.bearer-1108-ffb3.testnet";
export const PROOF_SIGNER = "v1.signer-prod.testnet";
export const PROOF_RPC = process.env.NEXT_PUBLIC_NEAR_RPC || "https://test.rpc.fastnear.com";
export const MEASURED_ON = "8–9 Nov 2026";

const REPORTS = "contracts/tests/spike/reports";

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
  source: string | string[];
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
      { ms: 7747, tgas: 14.703, tx: "https://testnet.nearblocks.io/txns/7K7pbrjU9h7vXZHzuJkjTgVoga53NvMrFnjgAsFW3bBt" },
    ],
    source: [`${REPORTS}/testnet-sol-withdraw-2026-11-08T22-51-57.356Z.json`, `${REPORTS}/testnet-sol-withdraw-2026-11-09T05-43-03.639Z.json`],
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

/**
 * The market's first sale on testnet, against the locked contract
 * (contracts/tests/spike/reports/testnet-market-sale-2026-11-09T12-21-46.716Z.json).
 */
export const MARKET_SALE = {
  tokenId: "4",
  price: "0.1 NEAR",
  seller: "alice",
  buyer: "bob",
  detail: "Listed by alice, bought by bob; the vault moved first and stayed sealed with 0 signatures, then alice received exactly 0.11 NEAR (price + listing deposit)",
  gas: "8.9 Tgas to list, 11.5 Tgas to buy",
  listTx: "https://testnet.nearblocks.io/txns/75Gdpx1BKNyi2qWGn7XuGVmQ9yH1mkYi3K3B4QRPoGk8",
  buyTx: "https://testnet.nearblocks.io/txns/GCuy9zAFHGeN8ZsjgvUyaF8Uzz4xvW4UvNessKMMYv6F",
  source: `${REPORTS}/testnet-market-sale-2026-11-09T12-21-46.716Z.json`,
};

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
    status: "confirmed",
    detail: "Vault No. 0002 → itself, 1,000 lamports · signed in 7.7 s · finalized in slot 520,280,234",
    href: "https://explorer.solana.com/tx/jQCk6nNLGvbAfkrxGizGhvqiUpnUZeA4b58tU3SEFdNA3La2g5PqTY6uod3zWMJk7yB9wfvZebVzFa73oEdgrmt?cluster=devnet",
    linkLabel: "jQCk6nNL…grmt",
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

/** docs/THREAT_MODEL.md: rows T1–T17, the market's M1–M10, then the schedule's S1–S10. */
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
    tests: ["pnpm demo:dry step 7 (a simulated ledger accepts one of two spends; not yet on real chains)"],
    status: "partly",
  },
  {
    id: "T11",
    attack: "Admin or upgrade powers",
    defence: "No admin, upgrade or raw-sign methods; full-access keys deleted; code hash published",
    tests: ["no_privileged_methods", "spike:testnet lock (bearer.testnet: 0 keys, 9 Nov)"],
    status: "proven",
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
  // The market (contracts/market), rows M1–M10.
  {
    id: "M1",
    attack: "Fake a listing by calling the market's nft_on_transfer directly",
    defence: "Only the Bearer contract may call it",
    tests: ["only_bearer_can_list"],
    status: "proven",
  },
  {
    id: "M2",
    attack: "Sell an opened vault, or one the seller no longer holds",
    defence: "The vault arrives through Bearer's sealed-only gate and stays in escrow; the gate checks again as it moves to the buyer",
    tests: ["opened_vault_cannot_be_listed"],
    status: "proven",
  },
  {
    id: "M3",
    attack: "Buyer pays and gets nothing, pays a different price, or races another buyer",
    defence: "Exact price; a sale in flight locks the listing; the vault moves before any money; a vault that didn't move refunds the buyer",
    tests: ["sold_vault_moves_first_then_seller_is_paid", "buy_needs_the_exact_price", "double_buy_race", "failed_move_refunds_the_buyer"],
    status: "proven",
  },
  {
    id: "M4",
    attack: "A payout bounces and the money is lost",
    defence: "Kept as a claimable balance for whoever holds the account name",
    tests: ["bounced_payout_becomes_claimable"],
    status: "proven",
  },
  {
    id: "M5",
    attack: "Settlement stops halfway",
    defence: "Buying and delisting refuse under 60 Tgas; the callbacks never panic",
    tests: ["buy_needs_gas_for_the_whole_settlement", "failed_move_restores_the_listing"],
    status: "proven",
  },
  {
    id: "M6",
    attack: "Fill the market's storage for free",
    defence: "Each listing holds a 0.01 NEAR deposit checked against its storage, returned on sale or delisting",
    tests: ["listing_holds_the_deposit_and_covers_its_storage", "listing_without_deposit_returns_the_vault"],
    status: "proven",
  },
  {
    id: "M7",
    attack: "Someone else delists, or a delisted vault is bought",
    defence: "Only the seller delists; delisting removes the listing",
    tests: ["only_the_seller_can_delist", "buy_after_delist"],
    status: "proven",
  },
  {
    id: "M8",
    attack: "A vault sent to the market without a listing is stuck there",
    defence: "return_unlisted sends it to the holder before the market, read from the custody log; never a listed vault",
    tests: ["return_unlisted sends a stray vault back", "return_unlisted can't take a listed vault"],
    status: "proven",
  },
  {
    id: "M9",
    attack: "The market account's key holder acts as the owner of a listed vault",
    defence: "No admin or upgrade methods; full-access keys deleted at the locked deploy; until then the site shows the key count",
    tests: ["spike:market lock (bearer-market.testnet: 0 keys, 9 Nov)"],
    status: "proven",
  },
  // The scheduled handover (contracts/schedule), rows S1–S10.
  { id: "S1", attack: "Fake a schedule by calling the schedule's nft_on_transfer directly", defence: "Only the Bearer contract may call it", tests: ["only_bearer_can_schedule"], status: "proven" },
  { id: "S2", attack: "Release a scheduled vault before its date", defence: "release refuses until the block time reaches the date", tests: ["release_waits_for_the_date"], status: "proven" },
  { id: "S3", attack: "Release it to someone other than the recipient", defence: "The recipient is fixed when scheduling; release takes no recipient", tests: ["anyone_can_release_on_the_date"], status: "proven" },
  { id: "S4", attack: "Cancel what was promised", defence: "Only the giver, only if cancellable, only before the date", tests: ["irrevocable_schedule_cannot_be_cancelled", "only_the_giver_can_cancel", "no_cancelling_after_the_date"], status: "proven" },
  { id: "S5", attack: "The recipient's name isn't registered, so a squatter gets the vault", defence: "release checks the account exists first; otherwise the vault stays", tests: ["missing_recipient_keeps_the_vault"], status: "proven" },
  { id: "S6", attack: "The giver withdraws while the vault is scheduled", defence: "The schedule holds the vault and never breaks seals", tests: ["giver_cannot_withdraw_while_scheduled", "opened_vault_cannot_be_scheduled"], status: "proven" },
  { id: "S7", attack: "Fill the schedule's storage for free", defence: "Each schedule holds a 0.01 NEAR deposit, checked against its storage", tests: ["schedule_holds_the_deposit_and_covers_its_storage", "scheduling_without_deposit_returns_the_vault"], status: "proven" },
  { id: "S8", attack: "A handover stops halfway", defence: "Gas floors; callbacks never panic and put the schedule back to waiting", tests: ["failed_move_keeps_the_schedule"], status: "proven" },
  { id: "S9", attack: "A vault sent without a schedule is stuck", defence: "return_unscheduled sends it back to the holder before the schedule", tests: ["return_unscheduled tests"], status: "proven" },
  { id: "S10", attack: "Admin or upgrade powers over the schedule", defence: "No admin or upgrade methods; keys deleted at the locked deploy", tests: ["lock not yet run"], status: "partly" },
  {
    id: "M10",
    attack: "A buyer reads an observed balance as a guaranteed value",
    defence: "Listings show balances as observations, with source, time and confirmation status",
    tests: ["UI review"],
    status: "policy",
  },
];

export const RUN_IT = [
  { label: "Unit tests (vectors: BIP143, BIP173/350, RLP, low-S, Solana shortvec)", cmd: "cargo test --manifest-path contracts/Cargo.toml" },
  { label: "Sandbox tests (bitcoinjs-lib, noble and @solana/web3.js check every signature)", cmd: "pnpm test:contracts" },
  { label: "Testnet signing spike against the real MPC signer", cmd: "cd contracts/tests && pnpm spike:testnet run" },
];
