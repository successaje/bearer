import type { ChainTag, Finish, Holdings, MarketListing, ObservedDeposit, TokenInfo, VaultView, Withdrawal, WithdrawalParams } from "@bearer/sdk";
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
  version: 5;
  nextId: number;
  vaults: Record<string, MockVault>;
  accounts: string[];
  /** The simulated market's listings, by token. Their vaults are held by MOCK_MARKET. */
  listings: Record<string, MarketListing>;
  /** v2: NEAR, tokens and NFTs held for each vault. */
  holdings: Record<string, Holdings>;
  /** v2 staking, added on first use: the simulated pool position and each vault's stake. */
  staking?: MockStaking;
  stakes?: Record<string, MockStake>;
}

export interface MockStaking {
  poolStaked: string;
  totalShares: string;
  queued: string;
  batch: number;
  unbonding: string;
  unbondingEpoch: number;
  withdrawnThrough: number;
}

export interface MockStake {
  shares: string;
  unstaking: { amount: string; batch: number }[];
}

/** The simulated staking pool. Its epochs last a minute, so unlocking (4 epochs) can be watched. */
export const MOCK_POOL = "pool.mock.testnet";
export const MOCK_EPOCH_MS = 60_000;

/** Simulated token contracts the demo knows. Real ones are read from their own ft_metadata. */
export const MOCK_TOKENS: Record<string, TokenInfo> = {
  "usdt.mock.testnet": { contract: "usdt.mock.testnet", symbol: "USDT", name: "Tether USD (simulated)", decimals: 6 },
  "wnear.mock.testnet": { contract: "wnear.mock.testnet", symbol: "wNEAR", name: "Wrapped NEAR (simulated)", decimals: 24 },
};
/** A simulated NFT collection: any token id exists, titled "Ticket #id". */
export const MOCK_NFT_CONTRACT = "tickets.mock.testnet";
/** Storage the demo charges per held entry, from the vault's NEAR, like the contract (H6). */
export const MOCK_ENTRY_STORAGE = 10n ** 21n;

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
      view: mockView(id, "ada.testnet", created, addresses, { name: "For Mira", finish: "midnight" }),
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
    const view = mockView(id, "ada.testnet", created, addresses, { name: "Rent split", finish: "graphite" });
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

  const holdings: Record<string, Holdings> = {
    // 42 also holds NEAR, a token and an NFT (v2).
    "42": {
      near: (2n * 10n ** 24n - 3n * MOCK_ENTRY_STORAGE).toString(),
      tokens: [{ contract: "usdt.mock.testnet", amount: "250000000", pending: "0" }],
      nfts: [{ contract: MOCK_NFT_CONTRACT, token_id: "12", pending: false }],
    },
    // 29 is opened, so its owner can withdraw what it holds.
    "29": {
      near: (5n * 10n ** 23n - 2n * MOCK_ENTRY_STORAGE).toString(),
      tokens: [{ contract: "wnear.mock.testnet", amount: (15n * 10n ** 23n).toString(), pending: "0" }],
      nfts: [],
    },
  };

  return {
    version: 5,
    nextId: 64,
    vaults,
    accounts: ["ada.testnet", "mira.testnet", "tunde.testnet", "theo.testnet", "bob.testnet", ATTACKER, "near.testnet", MOCK_MARKET],
    listings,
    holdings,
  };
}
