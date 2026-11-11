import type { ChainTag, Finish, HandoverSchedule, MarketListing, ObservedDeposit, VaultLoan, VaultView, Withdrawal, WithdrawalParams } from "@bearer/sdk";
import { vaultPath } from "@bearer/sdk";

/** Simulated chain state for one vault: what an explorer would show at its addresses. */
export interface MockLedger {
  /** Confirmed balance in base units. */
  confirmed: string;
  deposits: ObservedDeposit[];
}

export interface MockProgress {
  /** ms since epoch when the withdrawal was requested. */
  createdAt: number;
  chainTxHash: string;
  /** Set once the confirmed withdrawal has been taken off the ledger. */
  settled?: boolean;
}

export interface MockVault {
  view: VaultView;
  addresses: Record<ChainTag, string>;
  ledger: Record<ChainTag, MockLedger>;
  withdrawals: Withdrawal[];
  progress: Record<number, MockProgress>;
  /** Keys "arrive" from the signer a moment after creation, like the real callback. */
  keysAt: number;
}

export interface MockState {
  version: 10;
  nextId: number;
  vaults: Record<string, MockVault>;
  accounts: string[];
  /** The simulated market's listings, by token. Their vaults are held by MOCK_MARKET. */
  listings: Record<string, MarketListing>;
  /** Scheduled handovers, by token. Their vaults are held by MOCK_SCHEDULE. */
  schedules: Record<string, HandoverSchedule>;
  /** Loans against vaults, by token. Their vaults are held by MOCK_LEND. */
  loans: Record<string, VaultLoan>;
  /** Market sales, for prices and payouts: on testnet these come from the index. */
  sales: MockSale[];
}

export interface MockSale {
  tokenId: string;
  seller: string;
  buyer: string;
  price: string;
  /** What the market sent the seller: the price plus the listing deposit back. */
  paid: string;
  atMs: number;
}

/** The simulated schedule contract (SCHEDULE_CONTRACT in mock mode). */
export const MOCK_SCHEDULE = "schedule.testnet";
/** 0.01 NEAR, as on the testnet schedule. */
export const MOCK_SCHEDULE_DEPOSIT = (10n ** 22n).toString();

/** The simulated lending contract (LEND_CONTRACT in mock mode). */
export const MOCK_LEND = "lend.testnet";
/** 0.01 NEAR, as on the testnet lending contract. */
export const MOCK_LOAN_DEPOSIT = (10n ** 22n).toString();

/** The simulated market contract (MARKET_CONTRACT in mock mode). */
export const MOCK_MARKET = "market.testnet";
/** 0.01 NEAR, as on the testnet market. */
export const MOCK_LISTING_DEPOSIT = (10n ** 22n).toString();

export const DEMO_ACCOUNTS = [
  { id: "ada.testnet", role: "Sender", note: "Holds 4 vaults" },
  { id: "mira.testnet", role: "Recipient", note: "Received a vault from tunde" },
  { id: "tunde.testnet", role: "Former owner", note: "Handed a vault to mira" },
] as const;

/** The account the attack lab "plays" when no former owner exists. */
export const ATTACKER = "eve.testnet";

export const FEES: Record<ChainTag, bigint> = {
  btc: 300n, // sats
  evm: 21_000n * 1_000_000_000n, // 21k gas at 1 gwei
  sol: 5_000n, // lamports
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Small deterministic PRNG so addresses, keys and hashes are stable across reloads.
function prng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

const pick = (alphabet: string, length: number, rand: () => number) =>
  Array.from({ length }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const HEX = "0123456789abcdef";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const mockHex = (seed: string, length = 64) => pick(HEX, length, prng(`hex:${seed}`));
export const mockBase58 = (seed: string, length = 44) => pick(BASE58, length, prng(`b58:${seed}`));

export function mockAddresses(seed: string): Record<ChainTag, string> {
  return {
    btc: `tb1q${pick(BECH32, 38, prng(`btc:${seed}`))}`,
    evm: `0x${mockHex(`evm:${seed}`, 40)}`,
    sol: mockBase58(`sol:${seed}`),
  };
}

export const ns = (ms: number) => (BigInt(Math.floor(ms)) * 1_000_000n).toString();

export function mockView(
  tokenId: string,
  owner: string,
  createdAt: number,
  addresses: Record<ChainTag, string>,
  opts: { name?: string; finish: Finish },
): VaultView {
  return {
    token_id: tokenId,
    owner_id: owner,
    state: { kind: "sealed" },
    signatures_requested: 0,
    withdrawal_count: 0,
    keys: {
      btc: `secp256k1:${mockBase58(`kb:${tokenId}`, 88)}`,
      evm: `secp256k1:${mockBase58(`ke:${tokenId}`, 88)}`,
      sol: `ed25519:${mockBase58(`ks:${tokenId}`, 44)}`,
    },
    btc_address: addresses.btc,
    evm_address: addresses.evm,
    sol_address: addresses.sol,
    paths: { btc: vaultPath(tokenId, "btc"), evm: vaultPath(tokenId, "evm"), sol: vaultPath(tokenId, "sol") },
    custody: [{ account_id: owner, since_ns: ns(createdAt) }],
    created_at_ns: ns(createdAt),
    name: opts.name ?? null,
    finish: opts.finish,
  };
}

function deposit(seed: string, amount: bigint, at: number, confirmed = true): ObservedDeposit {
  return { txHash: mockHex(`dep:${seed}`), amount: amount.toString(), confirmed, at, explorerUrl: null };
}

function ledger(entries: [bigint, ObservedDeposit[]]): MockLedger {
  return { confirmed: entries[0].toString(), deposits: entries[1] };
}

const sats = (btc: number) => BigInt(Math.round(btc * 1e8));
const wei = (eth: number) => BigInt(Math.round(eth * 1e9)) * 1_000_000_000n;
const lamports = (sol: number) => BigInt(Math.round(sol * 1e9));

export function withdrawalParams(
  chain: ChainTag,
  to: string,
  amount: bigint,
  nonce: number,
  seed: string,
): WithdrawalParams {
  switch (chain) {
    case "evm":
      return {
        chain: "evm",
        chain_id: "84532",
        nonce: String(nonce),
        to,
        amount_wei: amount.toString(),
        gas_limit: "21000",
        max_fee_per_gas: "1000000000",
        max_priority_fee_per_gas: "1000000",
      };
    case "btc":
      return {
        chain: "btc",
        inputs: [{ txid: mockHex(`in:${seed}`), vout: 0, value_sat: (amount + FEES.btc).toString() }],
        to_address: to,
        amount_sat: amount.toString(),
        fee_sat: FEES.btc.toString(),
      };
    case "sol":
      return { chain: "sol", recent_blockhash: mockBase58(`bh:${seed}`), to, lamports: amount.toString() };
  }
}

export function seedState(now: number): MockState {
  const vaults: Record<string, MockVault> = {};

  // 42: Ada's sealed, funded vault. The headline demo.
  {
    const id = "42";
    const created = now - 2 * DAY;
    const addresses = mockAddresses(id);
    vaults[id] = {
      view: mockView(id, "ada.testnet", created, addresses, { name: "Theo's birthday", finish: "obsidian" }),
      addresses,
      ledger: {
        btc: ledger([sats(0.00041), [deposit("42b", sats(0.00041), now - 2 * DAY + 2 * HOUR)]]),
        evm: ledger([wei(0.0042), [deposit("42e", wei(0.0042), now - DAY - 3 * HOUR)]]),
        sol: ledger([lamports(0.032), [deposit("42s", lamports(0.032), now - DAY)]]),
      },
      withdrawals: [],
      progress: {},
      keysAt: created,
    };
  }

  // 17: handed from tunde to mira. Sealed. Tunde is the "former owner" in the attack lab.
  {
    const id = "17";
    const created = now - 10 * DAY;
    const addresses = mockAddresses(id);
    const view = mockView(id, "mira.testnet", created, addresses, { name: "OTC · Desk 7", finish: "champagne" });
    view.custody = [
      { account_id: "tunde.testnet", since_ns: ns(created) },
      { account_id: "mira.testnet", since_ns: ns(now - 5 * HOUR) },
    ];
    vaults[id] = {
      view,
      addresses,
      ledger: {
        btc: ledger([sats(0.0034), [deposit("17b", sats(0.0034), now - 9 * DAY)]]),
        evm: ledger([wei(0.025), [deposit("17e", wei(0.025), now - 8 * DAY)]]),
        sol: ledger([lamports(0.248), [deposit("17s", lamports(0.248), now - 7 * DAY)]]),
      },
      withdrawals: [],
      progress: {},
      keysAt: created,
    };
  }

  // 29: Ada opened it two days ago and withdrew Bitcoin; one Base attempt failed, the retry worked.
  {
    const id = "29";
    const created = now - 20 * DAY;
    const opened = now - 2 * DAY;
    const addresses = mockAddresses(id);
    const view = mockView(id, "ada.testnet", created, addresses, { name: "Savings jar", finish: "sage" });
    view.state = { kind: "opened", at_ns: ns(opened), by: "ada.testnet" };
    const dest = { btc: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", evm: "0x3fa2b1c47d9e0f5a6b8c2d4e6f80a1b3c519cd00" };
    const withdrawals: Withdrawal[] = [
      {
        index: 0,
        params: withdrawalParams("btc", dest.btc, sats(0.001), 0, "29-0"),
        path: view.paths.btc,
        payload_hashes: [mockHex("29-0-h")],
        signed_raw_tx: mockHex("29-0-raw", 380),
        status: "signed",
        error: null,
        requested_at_ns: ns(opened),
      },
      {
        index: 1,
        params: withdrawalParams("evm", dest.evm, wei(0.01), 4, "29-1"),
        path: view.paths.evm,
        payload_hashes: [mockHex("29-1-h")],
        signed_raw_tx: null,
        status: "failed",
        error: "ERR_SIGNER_FAILED",
        requested_at_ns: ns(opened + 10 * MIN),
      },
      {
        index: 2,
        params: withdrawalParams("evm", dest.evm, wei(0.01), 4, "29-2"),
        path: view.paths.evm,
        payload_hashes: [mockHex("29-2-h")],
        signed_raw_tx: mockHex("29-2-raw", 230),
        status: "signed",
        error: null,
        requested_at_ns: ns(opened + 14 * MIN),
      },
    ];
    view.withdrawal_count = withdrawals.length;
    view.signatures_requested = withdrawals.length;
    vaults[id] = {
      view,
      addresses,
      ledger: {
        btc: ledger([sats(0.003), [deposit("29b", sats(0.004), now - 19 * DAY)]]),
        evm: ledger([wei(0.0326), [deposit("29e", wei(0.0426), now - 18 * DAY)]]),
        sol: ledger([0n, []]),
      },
      withdrawals,
      progress: {
        0: { createdAt: opened, chainTxHash: mockHex("29-0-tx"), settled: true },
        2: { createdAt: opened + 14 * MIN, chainTxHash: mockHex("29-2-tx"), settled: true },
      },
      keysAt: created,
    };
  }

  // 63: sealed, with a Bitcoin deposit still unconfirmed.
  {
    const id = "63";
    const created = now - DAY;
    const addresses = mockAddresses(id);
    vaults[id] = {
      view: mockView(id, "ada.testnet", created, addresses, { name: "💌 For Mira", finish: "midnight" }),
      addresses,
      ledger: {
        btc: ledger([0n, [deposit("63b", sats(0.0001), now - 4 * MIN, false)]]),
        evm: ledger([0n, []]),
        sol: ledger([lamports(0.1), [deposit("63s", lamports(0.1), now - 20 * HOUR)]]),
      },
      withdrawals: [],
      progress: {},
      keysAt: created,
    };
  }

  // 51: opened and fully withdrawn on Base. Shows the "empty" state.
  {
    const id = "51";
    const created = now - 4 * DAY;
    const opened = now - 3 * DAY;
    const addresses = mockAddresses(id);
    const view = mockView(id, "ada.testnet", created, addresses, { name: "🍕 Pizza money", finish: "graphite" });
    view.state = { kind: "opened", at_ns: ns(opened), by: "ada.testnet" };
    const w: Withdrawal = {
      index: 0,
      params: withdrawalParams("evm", "0x8ba1f109551bd432803012645ac136ddd64dba72", wei(0.042) - FEES.evm, 0, "51-0"),
      path: view.paths.evm,
      payload_hashes: [mockHex("51-0-h")],
      signed_raw_tx: mockHex("51-0-raw", 230),
      status: "signed",
      error: null,
      requested_at_ns: ns(opened),
    };
    view.withdrawal_count = 1;
    view.signatures_requested = 1;
    vaults[id] = {
      view,
      addresses,
      ledger: { btc: ledger([0n, []]), evm: ledger([0n, [deposit("51e", wei(0.042), now - 4 * DAY)]]), sol: ledger([0n, []]) },
      withdrawals: [w],
      progress: { 0: { createdAt: opened, chainTxHash: mockHex("51-0-tx"), settled: true } },
      keysAt: created,
    };
  }

  // 8: theo listed it on the market for 12 NEAR. Sealed and funded; the market holds it.
  const listings: Record<string, MarketListing> = {};
  {
    const id = "8";
    const created = now - 6 * DAY;
    const listed = now - 7 * HOUR;
    const addresses = mockAddresses(id);
    const view = mockView(id, MOCK_MARKET, created, addresses, { name: "Prize · Round 3", finish: "champagne" });
    view.custody = [
      { account_id: "theo.testnet", since_ns: ns(created) },
      { account_id: MOCK_MARKET, since_ns: ns(listed) },
    ];
    vaults[id] = {
      view,
      addresses,
      ledger: {
        btc: ledger([sats(0.0012), [deposit("8b", sats(0.0012), now - 5 * DAY)]]),
        evm: ledger([0n, []]),
        sol: ledger([lamports(0.25), [deposit("8s", lamports(0.25), now - 5 * DAY + 3 * HOUR)]]),
      },
      withdrawals: [],
      progress: {},
      keysAt: created,
    };
    listings[id] = {
      token_id: id,
      seller: "theo.testnet",
      price: (12n * 10n ** 24n).toString(),
      deposit: MOCK_LISTING_DEPOSIT,
      listed_at_ns: ns(listed),
      state: { kind: "listed" },
    };
  }

  // 34: ada listed it for 1.5 NEAR and mira bought it two hours ago: the demo's sale notification.
  const sales: MockSale[] = [];
  {
    const id = "34";
    const created = now - 4 * DAY;
    const listed = now - 1 * DAY;
    const sold = now - 2 * HOUR;
    const addresses = mockAddresses(id);
    const view = mockView(id, "mira.testnet", created, addresses, { name: "Prize · Round 2", finish: "sage" });
    view.custody = [
      { account_id: "ada.testnet", since_ns: ns(created) },
      { account_id: MOCK_MARKET, since_ns: ns(listed) },
      { account_id: "mira.testnet", since_ns: ns(sold) },
    ];
    vaults[id] = {
      view,
      addresses,
      ledger: {
        btc: ledger([sats(0.0009), [deposit("34b", sats(0.0009), now - 3 * DAY)]]),
        evm: ledger([0n, []]),
        sol: ledger([0n, []]),
      },
      withdrawals: [],
      progress: {},
      keysAt: created,
    };
    const price = 15n * 10n ** 23n;
    sales.push({ tokenId: id, seller: "ada.testnet", buyer: "mira.testnet", price: price.toString(), paid: (price + BigInt(MOCK_LISTING_DEPOSIT)).toString(), atMs: sold });
  }

  // 21: ada's gift for theo, handed over in six months. Can't be cancelled.
  const schedules: Record<string, HandoverSchedule> = {};
  {
    const id = "21";
    const created = now - 3 * DAY;
    const addresses = mockAddresses(id);
    const view = mockView(id, MOCK_SCHEDULE, created, addresses, { name: "⏳ For your next chapter", finish: "ivory" });
    view.custody = [
      { account_id: "ada.testnet", since_ns: ns(created) },
      { account_id: MOCK_SCHEDULE, since_ns: ns(now - 2 * DAY) },
    ];
    vaults[id] = {
      view,
      addresses,
      ledger: {
        btc: ledger([sats(0.0025), [deposit("21b", sats(0.0025), now - 3 * DAY + 4 * HOUR)]]),
        evm: ledger([0n, []]),
        sol: ledger([lamports(0.5), [deposit("21s", lamports(0.5), now - DAY)]]),
      },
      withdrawals: [],
      progress: {},
      keysAt: created,
    };
    schedules[id] = {
      token_id: id,
      giver: "ada.testnet",
      recipient: "theo.testnet",
      release_at_ns: ns(now + 182 * DAY),
      cancellable: false,
      scheduled_at_ns: ns(now - 2 * DAY),
      deposit: MOCK_SCHEDULE_DEPOSIT,
      state: { kind: "waiting" },
    };
  }

  // Loans. 12: mira asks 40 NEAR against her vault, nobody has lent yet. 55: ada borrowed 25 NEAR
  // from tunde and has 12 days left to repay. 47: tunde borrowed 10 NEAR from ada, a day overdue.
  const loans: Record<string, VaultLoan> = {};
  const NEAR = 10n ** 24n;
  const pledged: {
    id: string;
    name: string;
    finish: Finish;
    borrower: string;
    lender: string | null;
    principal: bigint;
    repayment: bigint;
    termDays: number;
    requestedAgo: number;
    fundedAgo: number | null;
    btc: number;
    sol: number;
  }[] = [
    { id: "12", name: "Mining payout", finish: "graphite", borrower: "mira.testnet", lender: null, principal: 40n * NEAR, repayment: 42n * NEAR, termDays: 30, requestedAgo: 3 * HOUR, fundedAgo: null, btc: 0.004, sol: 0 },
    { id: "55", name: "Rent float", finish: "midnight", borrower: "ada.testnet", lender: "tunde.testnet", principal: 25n * NEAR, repayment: 26n * NEAR, termDays: 30, requestedAgo: 19 * DAY, fundedAgo: 18 * DAY, btc: 0.0035, sol: 1 },
    { id: "47", name: "Desk collateral", finish: "champagne", borrower: "tunde.testnet", lender: "ada.testnet", principal: 10n * NEAR, repayment: (105n * NEAR) / 10n, termDays: 7, requestedAgo: 9 * DAY, fundedAgo: 8 * DAY, btc: 0.0011, sol: 0 },
  ];
  for (const p of pledged) {
    const created = now - p.requestedAgo - DAY;
    const addresses = mockAddresses(p.id);
    const view = mockView(p.id, MOCK_LEND, created, addresses, { name: p.name, finish: p.finish });
    view.custody = [
      { account_id: p.borrower, since_ns: ns(created) },
      { account_id: MOCK_LEND, since_ns: ns(now - p.requestedAgo) },
    ];
    vaults[p.id] = {
      view,
      addresses,
      ledger: {
        btc: ledger([sats(p.btc), [deposit(`${p.id}b`, sats(p.btc), created + HOUR)]]),
        evm: ledger([0n, []]),
        sol: p.sol ? ledger([lamports(p.sol), [deposit(`${p.id}s`, lamports(p.sol), created + 2 * HOUR)]]) : ledger([0n, []]),
      },
      withdrawals: [],
      progress: {},
      keysAt: created,
    };
    loans[p.id] = {
      token_id: p.id,
      borrower: p.borrower,
      principal: p.principal.toString(),
      repayment: p.repayment.toString(),
      term_ns: ns(p.termDays * DAY),
      deposit: MOCK_LOAN_DEPOSIT,
      requested_at_ns: ns(now - p.requestedAgo),
      state:
        p.lender && p.fundedAgo !== null
          ? { kind: "active", lender: p.lender, due_at_ns: ns(now - p.fundedAgo + p.termDays * DAY) }
          : { kind: "requested" },
    };
  }

  return {
    version: 10,
    nextId: 64,
    vaults,
    accounts: ["ada.testnet", "mira.testnet", "tunde.testnet", "theo.testnet", "bob.testnet", ATTACKER, "near.testnet", MOCK_MARKET, MOCK_SCHEDULE, MOCK_LEND],
    listings,
    schedules,
    loans,
    sales,
  };
}
