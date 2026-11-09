/**
 * v2: NEAR, NEP-141 tokens and NEP-171 NFTs held in a vault. Sandbox tests against the mock MPC
 * signer and a mock token/NFT contract (contracts/mock-assets). Names match docs/THREAT_MODEL.md (H1–H8).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Account } from "near-api-js";
import { DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, Sandbox } from "near-sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OUT = join(import.meta.dirname, "..", "out");
const NEAR = 10n ** 24n;
const MILLI = 10n ** 21n;
const CREATE_DEPOSIT = 50n * MILLI;
const ONE_YOCTO = 1n;
const TGAS = 10n ** 12n;

let sandbox: Sandbox;
let root: Account;
let bearer: Account;
let assets: Account;
let alice: Account;
let bob: Account;
let eve: Account;

type Holdings = {
  near: string;
  tokens: { contract: string; amount: string; pending: string }[];
  nfts: { contract: string; token_id: string; pending: boolean }[];
};

async function subAccount(prefix: string, near: bigint) {
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: near * NEAR });
  return new Account(`${prefix}.${root.accountId}`, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
}

const view = async <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  (await root.provider.callFunction({ contractId, method, args })) as T;
const holdings = (id: string) => view<Holdings>(bearer.accountId, "holdings", { token_id: id });
const owner = async (id: string) => (await view<{ owner_id: string }>(bearer.accountId, "vault", { token_id: id })).owner_id;
const ftBalance = async (a: Account) => BigInt(await view<string>(assets.accountId, "ft_balance_of", { account_id: a.accountId }));
const nftOwner = async (id: string) => (await view<{ owner_id: string } | null>(assets.accountId, "nft_token", { token_id: id }))?.owner_id;

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

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 30; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return read();
}

async function createVault(who: Account) {
  const id = await who.callFunction<string>({
    contractId: bearer.accountId,
    methodName: "create_vault",
    args: { name: null, finish: "obsidian" },
    deposit: CREATE_DEPOSIT,
    gas: 100n * TGAS,
  });
  return id;
}

const call = (who: Account, contractId: string, methodName: string, args: object, deposit = 0n, gas = 100n * TGAS) =>
  who.callFunction({ contractId, methodName, args, deposit, gas });

const depositNear = (who: Account, id: string, amount: bigint) => call(who, bearer.accountId, "deposit_near", { token_id: id }, amount);
const loadTokens = (who: Account, id: string, amount: bigint) =>
  call(who, assets.accountId, "ft_transfer_call", { receiver_id: bearer.accountId, amount: amount.toString(), msg: id }, ONE_YOCTO);
const loadNft = (who: Account, id: string, nft: string) =>
  call(who, assets.accountId, "nft_transfer_call", { receiver_id: bearer.accountId, token_id: nft, msg: id }, ONE_YOCTO);
const mintNft = (who: Account, nft: string) => call(who, assets.accountId, "nft_mint", { token_id: nft, receiver_id: who.accountId }, 100n * MILLI);
const breakSeal = (who: Account, id: string) => call(who, bearer.accountId, "break_seal", { token_id: id }, ONE_YOCTO, 30n * TGAS);
const transfer = (who: Account, id: string, to: Account) =>
  call(who, bearer.accountId, "nft_transfer", { receiver_id: to.accountId, token_id: id }, ONE_YOCTO, 30n * TGAS);
const withdrawToken = (who: Account, id: string, to: Account, amount: bigint) =>
  call(who, bearer.accountId, "withdraw_token", { token_id: id, token_contract: assets.accountId, receiver_id: to.accountId, amount: amount.toString() }, ONE_YOCTO);
const withdrawNft = (who: Account, id: string, nft: string, to: Account) =>
  call(who, bearer.accountId, "withdraw_nft", { token_id: id, nft_contract: assets.accountId, nft_token_id: nft, receiver_id: to.accountId }, ONE_YOCTO);
const withdrawNear = (who: Account, id: string, to: Account, amount: bigint) =>
  call(who, bearer.accountId, "withdraw_near", { token_id: id, receiver_id: to.accountId, amount: amount.toString() }, ONE_YOCTO);

/** A sealed vault of alice's holding 0.05 NEAR, 600 tokens and NFT `nft`. */
async function loadedVault(nft: string) {
  const id = await createVault(alice);
  await depositNear(alice, id, 50n * MILLI);
  await loadTokens(alice, id, 600n);
  await mintNft(alice, nft);
  await loadNft(alice, id, nft);
  return id;
}

beforeAll(async () => {
  sandbox = await Sandbox.start({});
  root = new Account("sandbox", sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  const signer = await subAccount("signer", 20n);
  bearer = await subAccount("bearer", 50n);
  assets = await subAccount("assets", 20n);
  alice = await subAccount("alice", 50n);
  bob = await subAccount("bob", 50n);
  eve = await subAccount("eve", 50n);

  await signer.deployContract(readFileSync(join(OUT, "mock_signer.wasm")));
  await signer.callFunction({ contractId: signer.accountId, methodName: "new", args: { seed: "holdings" } });
  await bearer.deployContract(readFileSync(join(OUT, "bearer.wasm")));
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
  await assets.deployContract(readFileSync(join(OUT, "mock_assets.wasm")));
  await assets.callFunction({ contractId: assets.accountId, methodName: "new", args: {} });
  // Token balances: alice and eve hold some; bearer and bob are registered to receive.
  for (const [a, amount] of [
    [alice, 10_000n],
    [eve, 1_000n],
    [bearer, 0n],
    [bob, 0n],
  ] as const) {
    await call(root, assets.accountId, "ft_mint", { account_id: a.accountId, amount: amount.toString() });
  }
});

afterAll(async () => {
  await sandbox?.tearDown();
});

describe("loading a vault", () => {
  it("holds NEAR, tokens and an NFT, and they move with the sealed vault", async () => {
    const id = await loadedVault("n1");
    const h = await holdings(id);
    expect(h.tokens).toEqual([{ contract: assets.accountId, amount: "600", pending: "0" }]);
    expect(h.nfts).toEqual([{ contract: assets.accountId, token_id: "n1", pending: false }]);
    // Storage for the record and both entries came out of the vault's 0.05 NEAR.
    expect(BigInt(h.near)).toBeLessThan(50n * MILLI);
    expect(BigInt(h.near)).toBeGreaterThan(40n * MILLI);
    expect(await nftOwner("n1")).toBe(bearer.accountId);

    await transfer(alice, id, bob);
    expect(await owner(id)).toBe(bob.accountId);
    expect(await holdings(id)).toEqual(h);
  });

  it("only_owner_can_load_tokens_and_nfts (H1)", async () => {
    const id = await createVault(alice);
    await depositNear(alice, id, 20n * MILLI);
    const eveBefore = await ftBalance(eve);
    await loadTokens(eve, id, 100n); // refunded by the token's own resolve
    expect(await until(() => ftBalance(eve), (b) => b === eveBefore)).toBe(eveBefore);
    await mintNft(eve, "spam");
    await loadNft(eve, id, "spam");
    expect(await until(() => nftOwner("spam"), (o) => o === eve.accountId)).toBe(eve.accountId);
    const h = await holdings(id);
    expect(h.tokens).toEqual([]);
    expect(h.nfts).toEqual([]);
  });

  it("anyone may add NEAR; it can only help the holder", async () => {
    const id = await createVault(alice);
    await depositNear(eve, id, 20n * MILLI);
    expect(BigInt((await holdings(id)).near)).toBeGreaterThan(10n * MILLI);
  });

  it("storage_paid_from_vault_near (H6): no NEAR in the vault, no tokens", async () => {
    const id = await createVault(alice);
    const before = await ftBalance(alice);
    await loadTokens(alice, id, 50n);
    expect(await until(() => ftBalance(alice), (b) => b === before)).toBe(before);
    expect((await holdings(id)).tokens).toEqual([]);
  });

  it("no_nested_vaults (H5)", async () => {
    const outer = await createVault(alice);
    const inner = await createVault(alice);
    await depositNear(alice, outer, 20n * MILLI);
    await call(alice, bearer.accountId, "nft_transfer_call", { receiver_id: bearer.accountId, token_id: inner, msg: outer }, ONE_YOCTO);
    expect(await until(() => owner(inner), (o) => o === alice.accountId)).toBe(alice.accountId);
    expect((await holdings(outer)).nfts).toEqual([]);
  });
});

describe("withdrawing", () => {
  it("nothing_leaves_a_sealed_vault (H2)", async () => {
    const id = await loadedVault("n2");
    await expectPanic(withdrawNear(alice, id, alice, 10n * MILLI), "ERR_VAULT_SEALED");
    await expectPanic(withdrawToken(alice, id, alice, 100n), "ERR_VAULT_SEALED");
    await expectPanic(withdrawNft(alice, id, "n2", alice), "ERR_VAULT_SEALED");
  });

  it("former_owner_cannot_withdraw_holdings (H3), the owner can", async () => {
    const id = await loadedVault("n3");
    await transfer(alice, id, bob);
    await breakSeal(bob, id);
    await expectPanic(withdrawToken(alice, id, alice, 100n), "ERR_NOT_OWNER");
    await expectPanic(withdrawNft(alice, id, "n3", alice), "ERR_NOT_OWNER");
    await expectPanic(withdrawNear(alice, id, alice, 10n * MILLI), "ERR_NOT_OWNER");

    const nearBefore = BigInt((await holdings(id)).near);
    const bobTokens = await ftBalance(bob);
    await withdrawToken(bob, id, bob, 600n);
    expect(await until(() => ftBalance(bob), (b) => b === bobTokens + 600n)).toBe(bobTokens + 600n);
    await withdrawNft(bob, id, "n3", bob);
    expect(await until(() => nftOwner("n3"), (o) => o === bob.accountId)).toBe(bob.accountId);
    await withdrawNear(bob, id, bob, 10n * MILLI);

    const h = await until(() => holdings(id), (x) => x.tokens.length === 0 && x.nfts.length === 0);
    expect(h.tokens).toEqual([]);
    expect(h.nfts).toEqual([]);
    // Emptied entries refund their storage to the vault's NEAR.
    expect(BigInt(h.near)).toBeGreaterThan(nearBefore - 10n * MILLI);
  });

  it("failed_withdrawal_keeps_the_asset (H4)", async () => {
    const id = await loadedVault("n4");
    await breakSeal(alice, id);
    // A fresh account isn't registered with the token contract, so the transfer to it fails.
    const stranger = await subAccount("stranger", 1n);
    await withdrawToken(alice, id, stranger, 250n);
    const h = await until(() => holdings(id), (x) => x.tokens[0]?.pending === "0");
    expect(h.tokens).toEqual([{ contract: assets.accountId, amount: "600", pending: "0" }]);
    expect(await ftBalance(stranger)).toBe(0n);
  });

  it("double_withdrawal (H8): the second can't take what the first has in flight", async () => {
    const id = await loadedVault("n5");
    await breakSeal(alice, id);
    const results = await Promise.allSettled([withdrawToken(alice, id, bob, 600n), withdrawToken(alice, id, bob, 600n)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const h = await until(() => holdings(id), (x) => x.tokens.length === 0);
    expect(h.tokens).toEqual([]);
  });
});
