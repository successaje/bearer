import type { ActivityItem, Card, ChainTag, Finish, OpenRequest } from "./types";

export interface MockRequest extends OpenRequest {
  /** Never progresses; used to demo the "stuck request" state. */
  stuck?: boolean;
  signedApplied?: boolean;
  confirmApplied?: boolean;
  spendsCoins?: string[];
}

export interface MockClaimLink {
  cardId: string;
  from: string;
  status: "active" | "claimed" | "cancelled";
}

export interface MockState {
  version: 2;
  nextId: number;
  cards: Record<string, Card>;
  requests: Record<string, MockRequest>;
  claimLinks: Record<string, MockClaimLink>;
  accounts: string[];
}

export const DEMO_ACCOUNTS = [
  { id: "ada.testnet", role: "Gift-giver", note: "Owns 4 cards" },
  { id: "tunde.testnet", role: "OTC trader", note: "Has a card listed for sale" },
  { id: "mira.testnet", role: "Buyer", note: "No cards yet" },
] as const;

/** A claim link seeded on card 63 so the claim flow can be tried straight away. */
export const DEMO_CLAIM_KEY = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKiM";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Small deterministic PRNG so seeded addresses and hashes are stable across reloads.
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

function pick(alphabet: string, length: number, rand: () => number) {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const HEX = "0123456789abcdef";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function mockAddress(chain: ChainTag, seed: string) {
  const rand = prng(`${chain}:${seed}`);
  switch (chain) {
    case "btc":
      return `tb1q${pick(BECH32, 38, rand)}`;
    case "evm": {
      const raw = pick(HEX, 40, rand);
      // Mixed case so it reads like a checksummed address.
      const mixed = raw
        .split("")
        .map((c) => (/[a-f]/.test(c) && rand() > 0.5 ? c.toUpperCase() : c))
        .join("");
      return `0x${mixed}`;
    }
    case "sol":
      return pick(BASE58, 44, rand);
  }
}

export function mockHash(seed: string, length = 64) {
  return pick(HEX, length, prng(`hash:${seed}`));
}

export function mockNearHash(seed: string) {
  return pick(BASE58, 44, prng(`near:${seed}`));
}

function act(
  cardId: string,
  n: number,
  partial: Omit<ActivityItem, "id">,
): ActivityItem {
  return { id: `${cardId}-${n}`, ...partial };
}

function baseCard(
  id: string,
  name: string,
  finish: Finish,
  owner: string,
  createdAt: number,
): Card {
  return {
    id,
    name,
    finish,
    owner,
    createdAt,
    epoch: 0,
    slots: {
      btc: { chain: "btc", address: mockAddress("btc", id), coins: [] },
      evm: {
        chain: "evm",
        address: mockAddress("evm", id),
        balance: 0,
        maxSignedNonce: null,
        provenFloor: 0,
      },
      sol: { chain: "sol", address: mockAddress("sol", id), balance: 0, lastSignedAt: null },
    },
    pending: [],
    listing: null,
    claimLink: null,
    logVersion: 1,
    activity: [],
  };
}

export function seedState(now: number): MockState {
  const theo = baseCard("42", "Theo's birthday", "obsidian", "ada.testnet", now - 2 * DAY);
  theo.slots.btc.coins = [{ outpoint: `${mockHash("42-c1")}:0`, amount: 41_000, encumbered: false }];
  theo.slots.evm = { ...theo.slots.evm, balance: 4_200_000, maxSignedNonce: 0, provenFloor: 1 };
  theo.slots.sol.balance = 32_000_000;
  theo.logVersion = 3;
  theo.activity = [
    act("42", 6, { kind: "proven", chain: "evm", title: "Base withdrawal proven", detail: "Nonce 0 used on Base Sepolia. Checked on NEAR by MPC Read RPC at Safe finality.", at: now - 2 * HOUR }),
    act("42", 5, { kind: "signed", chain: "evm", title: "Opened 0.0008 ETH on Base", detail: "Signed by NEAR's MPC network and sent to 0x3fA2…19Cd.", at: now - 2 * HOUR - 4 * MIN }),
    act("42", 4, { kind: "deposit", chain: "sol", title: "Deposit on Solana", detail: "+0.032 SOL, confirmed.", at: now - 1 * DAY }),
    act("42", 3, { kind: "deposit", chain: "evm", title: "Deposit on Base", detail: "+0.005 ETH, confirmed.", at: now - 1 * DAY - 3 * HOUR }),
    act("42", 2, { kind: "deposit", chain: "btc", title: "Deposit on Bitcoin", detail: "+0.00041 tBTC, 3 confirmations.", at: now - 2 * DAY + 2 * HOUR }),
    act("42", 1, { kind: "created", title: "Card created", detail: "By ada.testnet, with a 0.05 NEAR storage deposit.", at: now - 2 * DAY }),
  ];

  const otc = baseCard("17", "OTC · Desk 7", "champagne", "tunde.testnet", now - 10 * DAY);
  otc.slots.btc.coins = [
    { outpoint: `${mockHash("17-c1")}:0`, amount: 300_000, encumbered: false },
    { outpoint: `a3f19e07${mockHash("17-c2", 48)}9c02:1`, amount: 40_000, encumbered: true, signedAt: now - 8 * DAY },
  ];
  otc.slots.evm = { ...otc.slots.evm, balance: 25_000_000, maxSignedNonce: 2, provenFloor: 3 };
  otc.slots.sol = { ...otc.slots.sol, balance: 248_000_000, lastSignedAt: now - 2 * DAY };
  otc.listing = { priceNear: "120", listedAt: now - 5 * HOUR };
  otc.logVersion = 7;
  otc.activity = [
    act("17", 5, { kind: "listed", title: "Listed for 120 NEAR", detail: "Withdrawals are locked while the card is listed.", at: now - 5 * HOUR }),
    act("17", 4, { kind: "signed", chain: "sol", title: "Opened 0.05 SOL on Solana", detail: "Signed by NEAR's MPC network.", at: now - 2 * DAY }),
    act("17", 3, { kind: "proven", chain: "evm", title: "Base withdrawals proven", detail: "Nonces 0–2 used on Base Sepolia.", at: now - 3 * DAY }),
    act("17", 2, { kind: "signed", chain: "btc", title: "Bitcoin withdrawal signed", detail: "Spends coin a3f19e07…9c02:1. Excluded from the sealed value.", at: now - 8 * DAY }),
    act("17", 1, { kind: "created", title: "Card created", detail: "By tunde.testnet.", at: now - 10 * DAY }),
  ];

  const rent = baseCard("51", "Rent split", "graphite", "ada.testnet", now - 4 * DAY);
  rent.slots.evm = { ...rent.slots.evm, balance: 42_000_000, maxSignedNonce: 0, provenFloor: 0 };
  rent.pending = [
    {
      idx: 0,
      requestId: "req-seed-51",
      chain: "evm",
      requestedAt: now - 12 * MIN,
      summary: "Open 0.0008 ETH on Base · nonce 0",
    },
  ];
  rent.logVersion = 2;
  rent.activity = [
    act("51", 3, { kind: "signed", chain: "evm", title: "Signature requested", detail: "Open 0.0008 ETH on Base. NEAR's MPC network hasn't answered.", at: now - 12 * MIN }),
    act("51", 2, { kind: "deposit", chain: "evm", title: "Deposit on Base", detail: "+0.042 ETH, confirmed.", at: now - 3 * DAY }),
    act("51", 1, { kind: "created", title: "Card created", detail: "By ada.testnet.", at: now - 4 * DAY }),
  ];

  const mira = baseCard("63", "For Mira", "midnight", "ada.testnet", now - 1 * DAY);
  mira.slots.btc.coins = [{ outpoint: `${mockHash("63-c1")}:1`, amount: 10_000, encumbered: false }];
  mira.slots.sol.balance = 100_000_000;
  mira.claimLink = { createdAt: now - 3 * HOUR };
  mira.activity = [
    act("63", 4, { kind: "claim_created", title: "Claim link created", detail: "Anyone with the link can claim this card.", at: now - 3 * HOUR }),
    act("63", 3, { kind: "deposit", chain: "sol", title: "Deposit on Solana", detail: "+0.1 SOL, confirmed.", at: now - 20 * HOUR }),
    act("63", 2, { kind: "deposit", chain: "btc", title: "Deposit on Bitcoin", detail: "+0.0001 tBTC, 2 confirmations.", at: now - 22 * HOUR }),
    act("63", 1, { kind: "created", title: "Card created", detail: "By ada.testnet.", at: now - 1 * DAY }),
  ];

  const jar = baseCard("29", "Savings jar", "sage", "ada.testnet", now - 20 * DAY);
  jar.slots.btc.coins = [
    { outpoint: `${mockHash("29-c1")}:0`, amount: 250_000, encumbered: false },
    { outpoint: `${mockHash("29-c2")}:2`, amount: 150_000, encumbered: false },
  ];
  jar.slots.evm = { ...jar.slots.evm, balance: 42_600_000, maxSignedNonce: 3, provenFloor: 3 };
  jar.logVersion = 9;
  jar.activity = [
    act("29", 4, { kind: "signed", chain: "evm", title: "Opened 0.01 ETH on Base", detail: "Nonce 3. Not proven on NEAR yet.", at: now - 40 * MIN }),
    act("29", 3, { kind: "proven", chain: "evm", title: "Base withdrawals proven", detail: "Nonces 0–2 used on Base Sepolia.", at: now - 6 * DAY }),
    act("29", 2, { kind: "deposit", chain: "btc", title: "Deposit on Bitcoin", detail: "+0.004 tBTC, confirmed.", at: now - 19 * DAY }),
    act("29", 1, { kind: "created", title: "Card created", detail: "By ada.testnet.", at: now - 20 * DAY }),
  ];

  const stuck: MockRequest = {
    id: "req-seed-51",
    cardId: "51",
    chain: "evm",
    to: "0x3fA2b1C47d9e0F5a6B8c2D4e6F80a1B3c519Cd00",
    amount: 800_000,
    fee: 21_000,
    stage: "signing",
    createdAt: now - 12 * MIN,
    nearTxHash: mockNearHash("req-seed-51"),
    stuck: true,
  };

  return {
    version: 2,
    nextId: 64,
    cards: { "42": theo, "17": otc, "51": rent, "63": mira, "29": jar },
    requests: { [stuck.id]: stuck },
    claimLinks: { [DEMO_CLAIM_KEY]: { cardId: "63", from: "ada.testnet", status: "active" } },
    accounts: [
      "ada.testnet",
      "tunde.testnet",
      "mira.testnet",
      "theo.testnet",
      "near.testnet",
      "bearer-v1.testnet",
    ],
  };
}

export const RECOVERY_WORDS = [
  "orbit", "velvet", "canyon", "hollow", "ember", "glide", "pioneer", "lunar", "margin",
  "staple", "quiet", "harvest", "anchor", "breeze", "copper", "dawn", "fabric", "garden",
  "island", "jacket", "kettle", "lantern", "meadow", "noble", "oyster", "pepper", "ribbon",
  "saddle", "timber", "walnut", "willow", "zephyr",
];
