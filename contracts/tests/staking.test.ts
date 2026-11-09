/**
 * v2: staking a vault's NEAR with the one staking pool fixed at creation. Sandbox tests against
 * the mock MPC signer and a mock staking pool with the standard pool's rules (contracts/mock-pool).
 * Short epochs so unlocking can be waited for. Names match docs/THREAT_MODEL.md (Y1–Y9).
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
const UNLOCK_EPOCHS = 4;
const EPOCH_LENGTH = 60; // the shortest the sandbox starts with (10 does not)

let sandbox: Sandbox;
let root: Account;
let bearer: Account;
let pool: Account;
let alice: Account;
let bob: Account;
let eve: Account;

type Staking = { pool: string | null; total_shares: string; queued: string; batch: number; unbonding: string; unbonding_epoch: number; withdrawn_through: number; busy: boolean };
type StakeView = { shares: string; staked_estimate: string; queued: string; unbonding: string; unlocks_at_epoch: number | null; ready: string };
type PoolAccount = { unstaked_balance: string; staked_balance: string; can_withdraw: boolean };

async function subAccount(prefix: string, near: bigint) {
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: near * NEAR });
  return new Account(`${prefix}.${root.accountId}`, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
}

const view = async <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  (await root.provider.callFunction({ contractId, method, args })) as T;
const staking = () => view<Staking>(bearer.accountId, "staking");
const stakeOf = (id: string) => view<StakeView | null>(bearer.accountId, "stake_of", { token_id: id });
const vaultNear = async (id: string) => BigInt((await view<{ near: string }>(bearer.accountId, "holdings", { token_id: id })).near);
const poolAccount = () => view<PoolAccount>(pool.accountId, "get_account", { account_id: bearer.accountId });
const poolStaked = async () => BigInt((await poolAccount()).staked_balance);

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(sandbox.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await res.json()) as { result: T; error?: unknown };
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
const epochHeight = async () => (await rpc<{ epoch_height: number }>("validators", [null])).epoch_height;
async function untilEpoch(target: number) {
  while ((await epochHeight()) < target) await rpc("sandbox_fast_forward", { delta_height: EPOCH_LENGTH });
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

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 40; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return read();
}
const idle = () => until(staking, (s) => !s.busy);

const call = (who: Account, contractId: string, methodName: string, args: object, deposit = 0n, gas = 100n * TGAS) =>
  who.callFunction({ contractId, methodName, args, deposit, gas });

async function vaultWith(who: Account, near: bigint) {
  const id = await who.callFunction<string>({ contractId: bearer.accountId, methodName: "create_vault", args: { name: null, finish: "obsidian" }, deposit: CREATE_DEPOSIT, gas: 100n * TGAS });
  await call(who, bearer.accountId, "deposit_near", { token_id: id }, near);
  return id;
}
const stake = async (who: Account, id: string, amount: bigint) => {
  await call(who, bearer.accountId, "stake", { token_id: id, amount: amount.toString() }, ONE_YOCTO, 300n * TGAS);
  await idle();
};
const unstake = async (who: Account, id: string, amount: bigint | null) => {
  await call(who, bearer.accountId, "unstake", { token_id: id, amount: amount?.toString() ?? null }, ONE_YOCTO, 300n * TGAS);
  await idle();
};
const processUnstaking = async (who: Account) => {
  await call(who, bearer.accountId, "process_unstaking", {}, 0n, 300n * TGAS);
  await idle();
};
const transfer = (who: Account, id: string, to: Account) => call(who, bearer.accountId, "nft_transfer", { receiver_id: to.accountId, token_id: id }, ONE_YOCTO, 30n * TGAS);
const breakSeal = (who: Account, id: string) => call(who, bearer.accountId, "break_seal", { token_id: id }, ONE_YOCTO, 30n * TGAS);
const withdrawNear = (who: Account, id: string, to: Account, amount: bigint) =>
  call(who, bearer.accountId, "withdraw_near", { token_id: id, receiver_id: to.accountId, amount: amount.toString() }, ONE_YOCTO);

/** What a vault's shares are worth now, the way the site computes it from the pool's own view. */
async function worth(id: string) {
  const [s, mine, staked] = await Promise.all([staking(), stakeOf(id), poolStaked()]);
  if (!mine || s.total_shares === "0") return 0n;
  return (BigInt(mine.shares) * (staked - BigInt(s.queued))) / BigInt(s.total_shares);
}

beforeAll(async () => {
  sandbox = await Sandbox.start({ config: { additionalGenesis: { epoch_length: EPOCH_LENGTH } } });
  root = new Account("sandbox", sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  const signer = await subAccount("signer", 20n);
  bearer = await subAccount("bearer", 50n);
  pool = await subAccount("pool", 20n);
  alice = await subAccount("alice", 50n);
  bob = await subAccount("bob", 50n);
  eve = await subAccount("eve", 50n);

  await signer.deployContract(readFileSync(join(OUT, "mock_signer.wasm")));
  await signer.callFunction({ contractId: signer.accountId, methodName: "new", args: { seed: "staking" } });
  await pool.deployContract(readFileSync(join(OUT, "mock_pool.wasm")));
  await pool.callFunction({ contractId: pool.accountId, methodName: "new", args: {} });
  await bearer.deployContract(readFileSync(join(OUT, "bearer.wasm")));
  await bearer.callFunction({
    contractId: bearer.accountId,
    methodName: "new",
    args: {
      signer_id: signer.accountId,
      config: { evm_chain_ids: [84532], max_btc_inputs: 4, create_deposit: CREATE_DEPOSIT.toString(), withdraw_deposit: (10n * MILLI).toString(), mpc_sign_deposit: "1" },
      base_uri: null,
      staking_pool: pool.accountId,
    },
  });
});

afterAll(async () => {
  await sandbox?.tearDown();
});

describe("staking a vault's NEAR", () => {
  let first: string;

  it("stakes from a sealed vault, and the stake moves with the vault (Y3)", async () => {
    first = await vaultWith(alice, 3n * NEAR);
    const before = await vaultNear(first);
    await stake(alice, first, 2n * NEAR);
    expect(await poolStaked()).toBe(2n * NEAR);
    expect((await stakeOf(first))?.shares).toBe((2n * NEAR).toString());
    // Two NEAR left the vault's NEAR for the pool, plus the staking record's storage.
    const after = await vaultNear(first);
    expect(after).toBeLessThan(before - 2n * NEAR);
    expect(after).toBeGreaterThan(before - 2n * NEAR - 5n * MILLI);
    const v = await view<{ state: { kind: string }; signatures_requested: number }>(bearer.accountId, "vault", { token_id: first });
    expect(v.state).toEqual({ kind: "sealed" });
    expect(v.signatures_requested).toBe(0);

    await transfer(alice, first, bob);
    await expectPanic(call(alice, bearer.accountId, "unstake", { token_id: first, amount: null }, ONE_YOCTO, 300n * TGAS), "ERR_NOT_OWNER");
    expect((await stakeOf(first))?.shares).toBe((2n * NEAR).toString());
  });

  it("only_owner_can_stake (Y2)", async () => {
    const id = await vaultWith(alice, 2n * NEAR);
    await expectPanic(call(eve, bearer.accountId, "stake", { token_id: id, amount: NEAR.toString() }, ONE_YOCTO, 300n * TGAS), "ERR_NOT_OWNER");
    await expectPanic(call(alice, bearer.accountId, "stake", { token_id: id, amount: (5n * NEAR).toString() }, ONE_YOCTO, 300n * TGAS), "ERR_AMOUNT");
    expect(await stakeOf(id)).toBeNull();
  });

  it("the pool is the one fixed at creation, and nobody else can migrate (Y1)", async () => {
    expect((await staking()).pool).toBe(pool.accountId);
    await expectPanic(call(eve, bearer.accountId, "migrate_add_staking", { staking_pool: eve.accountId }), "Method migrate_add_staking is private");
    expect((await staking()).pool).toBe(pool.accountId);
  });

  it("rewards stay with the vaults that earned them (Y5)", async () => {
    const early = await vaultWith(alice, 2n * NEAR);
    await stake(alice, early, NEAR);
    const earlyBefore = await worth(early);
    const firstBefore = await worth(first);
    // The pool pays 0.3 NEAR in rewards, shared by the 3 NEAR staked so far.
    await call(root, pool.accountId, "add_reward", {}, 300n * MILLI);
    const late = await vaultWith(alice, 2n * NEAR);
    await stake(alice, late, NEAR);

    expect(await worth(early)).toBeGreaterThanOrEqual(earlyBefore + 100n * MILLI - 1n);
    expect(await worth(first)).toBeGreaterThanOrEqual(firstBefore + 200n * MILLI - 1n);
    // The late stake bought in at the new price: it got none of the earlier rewards.
    const lateWorth = await worth(late);
    expect(lateWorth).toBeLessThanOrEqual(NEAR);
    expect(lateWorth).toBeGreaterThan(NEAR - 10n);
  });

  it("failed_stake_keeps_the_near (Y7)", async () => {
    const id = await vaultWith(alice, 2n * NEAR);
    const before = await vaultNear(id);
    await call(root, pool.accountId, "set_failing", { method: "deposit_and_stake", on: true });
    await stake(alice, id, NEAR);
    await call(root, pool.accountId, "set_failing", { method: "deposit_and_stake", on: false });
    expect(await until(() => vaultNear(id), (n) => n === before)).toBe(before);
    expect(await stakeOf(id)).toBeNull();
    expect((await staking()).busy).toBe(false);
  });
});

describe("unstaking", () => {
  let bobs: string;
  let later: string;

  it("batches requests so one vault can't keep restarting everyone's unlock (Y6)", async () => {
    // bob holds the first vault (2 NEAR staked, plus its rewards).
    bobs = (await view<{ token_id: string }[]>(bearer.accountId, "nft_tokens_for_owner", { account_id: bob.accountId }))[0].token_id;
    const owed = await worth(bobs);
    await unstake(bob, bobs, null);
    const s = await staking();
    const unlockAt = s.unbonding_epoch + UNLOCK_EPOCHS;
    expect(BigInt(s.unbonding)).toBe(owed);
    expect((await stakeOf(bobs))?.unlocks_at_epoch).toBe(unlockAt);
    const atPool = await poolAccount();
    expect(BigInt(atPool.unstaked_balance)).toBeGreaterThanOrEqual(owed);
    expect(atPool.can_withdraw).toBe(false);

    // Another vault asks while that batch unlocks: it queues; the pool isn't asked again.
    later = await vaultWith(alice, 2n * NEAR);
    await stake(alice, later, NEAR);
    // Staking can leave a yoctoNEAR of rounding dust unstaked at the pool, so read it after.
    const beforeAsk = await poolAccount();
    await untilEpoch(s.unbonding_epoch + 1);
    await unstake(alice, later, 500n * MILLI);
    expect((await stakeOf(later))?.queued).toBe((500n * MILLI).toString());
    expect((await poolAccount()).unstaked_balance).toBe(beforeAsk.unstaked_balance);
    expect((await staking()).unbonding_epoch).toBe(s.unbonding_epoch);

    await expectPanic(call(eve, bearer.accountId, "process_unstaking", {}, 0n, 300n * TGAS), "ERR_NOT_UNLOCKED");
  });

  it("anyone moves it along once unlocked; the NEAR comes back into the vault (Y4)", async () => {
    const s = await staking();
    const owed = BigInt(s.unbonding);
    const before = await vaultNear(bobs);
    await untilEpoch(s.unbonding_epoch + UNLOCK_EPOCHS);
    await processUnstaking(eve);

    const after = await staking();
    expect(after.withdrawn_through).toBe(s.batch - 1);
    // The queued request became the next unlocking batch.
    expect(after.unbonding).toBe((500n * MILLI).toString());
    expect(after.queued).toBe("0");
    expect(await vaultNear(bobs)).toBe(before + owed);
    expect((await stakeOf(later))?.unbonding).toBe((500n * MILLI).toString());
  });

  it("unstaked NEAR still needs an opened vault to leave it (Y4)", async () => {
    const amount = await vaultNear(bobs);
    await expectPanic(withdrawNear(bob, bobs, bob, amount), "ERR_VAULT_SEALED");
    await breakSeal(bob, bobs);
    const before = (await bob.getState()).balance.total;
    await withdrawNear(bob, bobs, bob, amount);
    const after = await until(async () => (await bob.getState()).balance.total, (b) => b > before + amount - 5n * MILLI);
    expect(after).toBeGreaterThan(before + amount - 5n * MILLI);
    // Fully unstaked and settled: the record is gone, and only its refunded storage is left.
    expect(await stakeOf(bobs)).toBeNull();
    expect(await vaultNear(bobs)).toBeGreaterThan(0n);
    expect(await vaultNear(bobs)).toBeLessThan(2n * MILLI);
  });
});
