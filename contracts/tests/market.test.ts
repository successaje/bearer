/**
 * Sandbox tests for the market against the Bearer contract as deployed and locked
 * (contracts/res/bearer.wasm). Test names match docs/THREAT_MODEL.md (M1–M9).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as bitcoin from "bitcoinjs-lib";
import { Account } from "near-api-js";
import { DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, Sandbox } from "near-sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONTRACTS = join(import.meta.dirname, "..");
const NEAR = 10n ** 24n;
const MILLI = 10n ** 21n;
const CREATE_DEPOSIT = 50n * MILLI;
const LISTING_DEPOSIT = 10n * MILLI;
const ONE_YOCTO = 1n;
const TGAS = 10n ** 12n;

let sandbox: Sandbox;
let root: Account;
let bearer: Account;
let market: Account;
let alice: Account;
let bob: Account;
let carol: Account;
let eve: Account;

type Listing = {
  token_id: string;
  seller: string;
  price: string;
  deposit: string;
  state: { kind: "listed" } | { kind: "selling"; buyer: string } | { kind: "returning" };
};
type VaultView = {
  owner_id: string;
  state: { kind: string };
  signatures_requested: number;
  custody: { account_id: string }[];
};

async function subAccount(prefix: string, near: bigint) {
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: near * NEAR });
  return new Account(`${prefix}.${root.accountId}`, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
}

const view = async <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  (await root.provider.callFunction({ contractId, method, args })) as T;
const vault = (id: string) => view<VaultView>(bearer.accountId, "vault", { token_id: id });
const listing = (id: string) => view<Listing | null>(market.accountId, "listing", { token_id: id });
const total = async (a: Account) => (await a.getState()).balance.total;

/**
 * A balance once pending receipts have landed. NEAR charges prepaid gas up front at a pessimistic
 * price and refunds the unused part a few blocks later, so a read right after a transaction is
 * not final.
 */
async function settled(a: Account) {
  let last = await total(a);
  for (let stable = 0; stable < 3; ) {
    await new Promise((r) => setTimeout(r, 500));
    const now = await total(a);
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  return last;
}

async function expectPanic(p: Promise<unknown>, code: string) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, `expected ${code}`).toBeDefined();
  expect(`${String(err)} ${JSON.stringify(err, Object.getOwnPropertyNames(err as object))}`).toContain(code);
}

async function createVault(owner: Account) {
  return owner.callFunction<string>({
    contractId: bearer.accountId,
    methodName: "create_vault",
    args: { name: null, finish: "obsidian" },
    deposit: CREATE_DEPOSIT,
    gas: 100n * TGAS,
  });
}

const depositForListing = (who: Account, amount = LISTING_DEPOSIT) =>
  who.callFunction({ contractId: market.accountId, methodName: "deposit_for_listing", args: {}, deposit: amount, gas: 30n * TGAS });

/** The seller's side of listing: Bearer moves the vault here and calls `nft_on_transfer`. */
const sendToMarket = (who: Account, id: string, price: bigint) =>
  who.callFunction({
    contractId: bearer.accountId,
    methodName: "nft_transfer_call",
    args: { receiver_id: market.accountId, token_id: id, msg: JSON.stringify({ price: price.toString() }) },
    deposit: ONE_YOCTO,
    gas: 100n * TGAS,
  });

async function list(who: Account, price: bigint) {
  const id = await createVault(who);
  await depositForListing(who);
  await sendToMarket(who, id, price);
  return id;
}

const buy = (who: Account, id: string, price: bigint) =>
  who.callFunction({ contractId: market.accountId, methodName: "buy", args: { token_id: id }, deposit: price, gas: 100n * TGAS });

const delist = (who: Account, id: string) =>
  who.callFunction({ contractId: market.accountId, methodName: "delist", args: { token_id: id }, deposit: ONE_YOCTO, gas: 100n * TGAS });

/** Settlement finishes a few receipts after the transaction returns. */
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 30; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return read();
}

beforeAll(async () => {
  sandbox = await Sandbox.start({});
  root = new Account("sandbox", sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  const signer = await subAccount("signer", 20n);
  bearer = await subAccount("bearer", 50n);
  market = await subAccount("market", 20n);
  alice = await subAccount("alice", 50n);
  bob = await subAccount("bob", 50n);
  carol = await subAccount("carol", 20n);
  eve = await subAccount("eve", 50n);

  await signer.deployContract(readFileSync(join(CONTRACTS, "out", "mock_signer.wasm")));
  await signer.callFunction({ contractId: signer.accountId, methodName: "new", args: { seed: "market" } });
  await bearer.deployContract(readFileSync(join(CONTRACTS, "res", "bearer.wasm")));
  await bearer.callFunction({
    contractId: bearer.accountId,
    methodName: "new",
    args: {
      signer_id: signer.accountId,
      config: {
        evm_chain_ids: [84532],
        max_btc_inputs: 4,
        create_deposit: CREATE_DEPOSIT.toString(),
        withdraw_deposit: (10n * MILLI).toString(),
        mpc_sign_deposit: "1",
      },
      base_uri: null,
    },
  });
  await market.deployContract(readFileSync(join(CONTRACTS, "out", "market.wasm")));
  await market.callFunction({
    contractId: market.accountId,
    methodName: "new",
    args: { nft_contract: bearer.accountId, listing_deposit: LISTING_DEPOSIT.toString() },
  });
});

afterAll(async () => {
  await sandbox?.tearDown();
});

describe("listing", () => {
  it("holds a sealed vault in escrow, paid for by the listing deposit (M6)", async () => {
    const id = await createVault(alice);
    await depositForListing(alice);
    const storageBefore = (await market.getState()).storageUsage;
    await sendToMarket(alice, id, 2n * NEAR);

    const l = await listing(id);
    expect(l).toMatchObject({ seller: alice.accountId, price: (2n * NEAR).toString(), state: { kind: "listed" } });
    expect(BigInt(l!.deposit)).toBe(LISTING_DEPOSIT);
    const v = await vault(id);
    expect(v.owner_id).toBe(market.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(await view<string>(market.accountId, "deposit_of", { account_id: alice.accountId })).toBe("0");
    const used = BigInt((await market.getState()).storageUsage - storageBefore);
    expect(used * 10n ** 19n).toBeLessThanOrEqual(LISTING_DEPOSIT);
  });

  it("listing_without_deposit_returns_the_vault (M6)", async () => {
    const id = await createVault(alice);
    await sendToMarket(alice, id, NEAR);
    expect(await listing(id)).toBeNull();
    const v = await vault(id);
    expect(v.owner_id).toBe(alice.accountId);
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, market.accountId, alice.accountId]);
  });

  it("opened_vault_cannot_be_listed (M2)", async () => {
    const id = await createVault(alice);
    await alice.callFunction({ contractId: bearer.accountId, methodName: "break_seal", args: { token_id: id }, deposit: ONE_YOCTO, gas: 30n * TGAS });
    await depositForListing(alice);
    await expectPanic(sendToMarket(alice, id, NEAR), "ERR_VAULT_OPENED");
    expect(await listing(id)).toBeNull();
    await alice.callFunction({ contractId: market.accountId, methodName: "withdraw_deposit", args: {}, deposit: ONE_YOCTO, gas: 30n * TGAS });
  });

  it("only_bearer_can_list: a direct nft_on_transfer is refused (M1)", async () => {
    await depositForListing(eve);
    await expectPanic(
      eve.callFunction({
        contractId: market.accountId,
        methodName: "nft_on_transfer",
        args: { sender_id: eve.accountId, previous_owner_id: eve.accountId, token_id: "1", msg: JSON.stringify({ price: NEAR.toString() }) },
        gas: 30n * TGAS,
      }),
      "ERR_WRONG_NFT_CONTRACT",
    );
  });
});

describe("buying", () => {
  it("sold_vault_moves_first_then_seller_is_paid (M3)", async () => {
    const price = 2n * NEAR;
    const id = await list(alice, price);
    const aliceBefore = await settled(alice);

    await buy(bob, id, price);
    await until(() => listing(id), (l) => l === null);

    const v = await vault(id);
    expect(v.owner_id).toBe(bob.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(v.signatures_requested).toBe(0);
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, market.accountId, bob.accountId]);
    // The seller signs nothing in this transaction, so the change is exactly price + deposit.
    expect((await settled(alice)) - aliceBefore).toBe(price + LISTING_DEPOSIT);
  });

  it("buy_needs_the_exact_price, and sellers can't buy their own (M3)", async () => {
    const id = await list(alice, NEAR);
    await expectPanic(buy(bob, id, NEAR - 1n), "ERR_WRONG_PRICE");
    await expectPanic(buy(bob, id, NEAR + 1n), "ERR_WRONG_PRICE");
    await expectPanic(buy(alice, id, NEAR), "ERR_OWN_LISTING");
    expect((await listing(id))?.state).toEqual({ kind: "listed" });
    await delist(alice, id);
  });

  it("double_buy_race: one buyer gets the vault, the other keeps their money (M3)", async () => {
    const price = NEAR;
    const id = await list(alice, price);
    const before = { bob: await settled(bob), eve: await settled(eve) };

    const results = await Promise.allSettled([buy(bob, id, price), buy(eve, id, price)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await until(() => listing(id), (l) => l === null);

    const winner = (await vault(id)).owner_id === bob.accountId ? bob : eve;
    const loser = winner === bob ? eve : bob;
    expect([bob.accountId, eve.accountId]).toContain((await vault(id)).owner_id);
    // The loser paid gas only: far less than the price.
    expect(before[loser === bob ? "bob" : "eve"] - (await settled(loser))).toBeLessThan(5n * MILLI);
    expect(before[winner === bob ? "bob" : "eve"] - (await settled(winner))).toBeGreaterThanOrEqual(price);
  });

  it("failed_move_refunds_the_buyer and the listing stands (M3)", async () => {
    // The market can't send a vault to itself (Bearer refuses: current and next owner must
    // differ), so the market account buying its own listing exercises the refund path.
    const price = NEAR;
    const id = await list(alice, price);
    await buy(market, id, price);
    const l = await until(() => listing(id), (x) => x?.state.kind === "listed");
    expect(l?.state).toEqual({ kind: "listed" });
    expect((await vault(id)).owner_id).toBe(market.accountId);
    const owedToMarket = await view<string>(market.accountId, "claimable_of", { account_id: market.accountId });
    expect(owedToMarket).toBe("0");
    await delist(alice, id);
  });

  it("bounced_payout_becomes_claimable (M4)", async () => {
    const price = NEAR;
    const id = await list(carol, price);
    // The seller disappears before the sale settles.
    await carol.deleteAccount(root.accountId);

    await buy(bob, id, price);
    await until(() => listing(id), (l) => l === null);
    expect((await vault(id)).owner_id).toBe(bob.accountId);
    const owed = await until(
      () => view<string>(market.accountId, "claimable_of", { account_id: carol.accountId }),
      (c) => c !== "0",
    );
    expect(BigInt(owed)).toBe(price + LISTING_DEPOSIT);

    // Whoever controls the name again can claim it.
    carol = await subAccount("carol", 1n);
    const before = await settled(carol);
    await carol.callFunction({ contractId: market.accountId, methodName: "claim", args: {}, deposit: ONE_YOCTO, gas: 30n * TGAS });
    expect((await settled(carol)) - before).toBeGreaterThan(price);
    expect(await view<string>(market.accountId, "claimable_of", { account_id: carol.accountId })).toBe("0");
  });
});

describe("delisting", () => {
  it("only_the_seller_can_delist; it returns the vault and the deposit (M7)", async () => {
    const id = await list(alice, NEAR);
    await expectPanic(delist(eve, id), "ERR_NOT_SELLER");
    const before = await settled(alice);
    await delist(alice, id);
    await until(() => listing(id), (l) => l === null);
    expect((await vault(id)).owner_id).toBe(alice.accountId);
    // Alice signed the delist and paid its gas; the deposit must have come back.
    const delta = (await settled(alice)) - before;
    expect(delta).toBeGreaterThan(LISTING_DEPOSIT - 5n * MILLI);
    expect(delta).toBeLessThan(LISTING_DEPOSIT);
  });

  it("buy_after_delist is refused (M7)", async () => {
    const id = await list(alice, NEAR);
    await delist(alice, id);
    await until(() => listing(id), (l) => l === null);
    await expectPanic(buy(bob, id, NEAR), "ERR_NOT_LISTED");
  });

  it("return_unlisted sends a stray vault back to its sender (M8)", async () => {
    const id = await createVault(alice);
    await alice.callFunction({
      contractId: bearer.accountId,
      methodName: "nft_transfer",
      args: { receiver_id: market.accountId, token_id: id },
      deposit: ONE_YOCTO,
      gas: 30n * TGAS,
    });
    expect((await vault(id)).owner_id).toBe(market.accountId);
    await eve.callFunction({ contractId: market.accountId, methodName: "return_unlisted", args: { token_id: id }, gas: 100n * TGAS });
    expect((await until(() => vault(id), (v) => v.owner_id === alice.accountId)).owner_id).toBe(alice.accountId);
  });

  it("return_unlisted can't take a listed vault (M8)", async () => {
    const id = await list(alice, NEAR);
    await expectPanic(
      eve.callFunction({ contractId: market.accountId, methodName: "return_unlisted", args: { token_id: id }, gas: 100n * TGAS }),
      "ERR_LISTED",
    );
    expect((await vault(id)).owner_id).toBe(market.accountId);
    await delist(alice, id);
  });
});

/**
 * A vault as a receivables account: anyone can pay into its addresses at any time, and whatever
 * arrives belongs to whoever holds the vault when it's opened. The contract never sees a deposit; it
 * decides who may get a signature that spends one, and that is what these tests check.
 */
describe("payments into a vault that is for sale", () => {
  const WITHDRAW_DEPOSIT = 10n * MILLI;
  const BUYER_BTC = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
  /** A payment of 50,000 sats that lands at the vault's Bitcoin address while it's listed. */
  const PAYMENT = { txid: "d".repeat(64), vout: 1, value_sat: "50000" };
  const spendPayment = { inputs: [PAYMENT], to_address: BUYER_BTC, amount_sat: "49500", fee_sat: "500" };

  type Withdrawal = { status: "pending" | "signed" | "failed"; signed_raw_tx: string | null };
  const withdrawals = (id: string) => view<Withdrawal[]>(bearer.accountId, "withdrawals", { token_id: id });
  const breakSeal = (who: Account, id: string) =>
    who.callFunction({ contractId: bearer.accountId, methodName: "break_seal", args: { token_id: id }, deposit: ONE_YOCTO, gas: 30n * TGAS });
  const withdrawBtc = (who: Account, id: string) =>
    who.callFunction({
      contractId: bearer.accountId,
      methodName: "withdraw_btc",
      args: { token_id: id, params: spendPayment },
      deposit: WITHDRAW_DEPOSIT + ONE_YOCTO,
      gas: 150n * TGAS,
    });
  const withdrawEvm = (who: Account, id: string) =>
    who.callFunction({
      contractId: bearer.accountId,
      methodName: "withdraw_evm",
      args: {
        token_id: id,
        params: {
          chain_id: "84532",
          nonce: "0",
          to: "0x3fa2b1c47d9e0f5a6b8c2d4e6f80a1b3c519cd00",
          amount_wei: "800000000000000",
          gas_limit: "21000",
          max_fee_per_gas: "2000000000",
          max_priority_fee_per_gas: "1000000",
        },
      },
      deposit: WITHDRAW_DEPOSIT + ONE_YOCTO,
      gas: 150n * TGAS,
    });

  /** A refusal, whichever check the contract runs first: the caller isn't the owner, or the vault is sealed. */
  async function expectRefused(p: Promise<unknown>) {
    let err: unknown;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err, "expected a refusal").toBeDefined();
    expect(`${String(err)} ${JSON.stringify(err, Object.getOwnPropertyNames(err as object))}`).toMatch(/ERR_NOT_OWNER|ERR_VAULT_SEALED/);
  }

  async function sealedVaultWithKeys(owner: Account) {
    const id = await createVault(owner);
    await until(() => view<{ keys: unknown }>(bearer.accountId, "vault", { token_id: id }), (v) => v.keys !== null);
    return id;
  }

  it("a_deposit_during_a_pending_sale_belongs_to_the_buyer (M2, M3)", async () => {
    const price = NEAR;
    const id = await sealedVaultWithKeys(alice);
    await depositForListing(alice);
    await sendToMarket(alice, id, price);

    // The payment lands while the vault is listed. The seller can't get a signature that spends it.
    await expectRefused(withdrawBtc(alice, id));

    await buy(bob, id, price);
    await until(() => listing(id), (l) => l === null);
    expect((await vault(id)).owner_id).toBe(bob.accountId);

    // After the sale the seller still can't, and the buyer must break the seal first.
    await expectRefused(withdrawBtc(alice, id));
    await expectPanic(withdrawBtc(bob, id), "ERR_VAULT_SEALED");
    expect((await vault(id)).signatures_requested).toBe(0);

    await breakSeal(bob, id);
    await expectPanic(withdrawBtc(alice, id), "ERR_NOT_OWNER");
    await withdrawBtc(bob, id);

    // The one signature ever requested for this vault spends the payment, to the buyer.
    const [w] = await until(() => withdrawals(id), (ws) => ws[0]?.status === "signed");
    expect(w.status).toBe("signed");
    const tx = bitcoin.Transaction.fromHex(w.signed_raw_tx as string);
    expect(tx.ins.map((i) => [Buffer.from(i.hash).reverse().toString("hex"), i.index])).toEqual([[PAYMENT.txid, PAYMENT.vout]]);
    expect(bitcoin.address.fromOutputScript(tx.outs[0].script, bitcoin.networks.testnet)).toBe(BUYER_BTC);
    expect(tx.outs[0].value).toBe(49_500n);
    expect((await vault(id)).signatures_requested).toBe(1);
  });

  it("a_signature_in_flight_blocks_the_sale (M2)", async () => {
    const id = await sealedVaultWithKeys(alice);
    await breakSeal(alice, id);
    await depositForListing(alice);
    // Ask for a withdrawal and list at the same moment: the vault is opened, so the listing fails.
    const [, listed] = await Promise.allSettled([withdrawEvm(alice, id), sendToMarket(alice, id, NEAR)]);
    expect(listed.status).toBe("rejected");
    const reason = (listed as PromiseRejectedResult).reason;
    expect(`${String(reason)} ${JSON.stringify(reason, Object.getOwnPropertyNames(reason as object))}`).toContain("ERR_VAULT_OPENED");
    expect(await listing(id)).toBeNull();
    expect((await vault(id)).owner_id).toBe(alice.accountId);
    await alice.callFunction({ contractId: market.accountId, methodName: "withdraw_deposit", args: {}, deposit: ONE_YOCTO, gas: 30n * TGAS });
  });
});
