/**
 * Sandbox tests for the scheduled handover against the Bearer contract as deployed and locked
 * (contracts/res/bearer.wasm). Test names match docs/THREAT_MODEL.md (S1–S10).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Account } from "near-api-js";
import { DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, Sandbox } from "near-sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONTRACTS = join(import.meta.dirname, "..");
const NEAR = 10n ** 24n;
const MILLI = 10n ** 21n;
const CREATE_DEPOSIT = 50n * MILLI;
const SCHEDULE_DEPOSIT = 10n * MILLI;
const ONE_YOCTO = 1n;
const TGAS = 10n ** 12n;
const SECOND = 1_000_000_000n;

let sandbox: Sandbox;
let root: Account;
let bearer: Account;
let schedule: Account;
let alice: Account;
let bob: Account;
let carol: Account;

type Schedule = {
  token_id: string;
  giver: string;
  recipient: string;
  release_at_ns: string;
  cancellable: boolean;
  state: { kind: "waiting" | "releasing" | "cancelling" };
};
type VaultView = { owner_id: string; state: { kind: string }; signatures_requested: number; custody: { account_id: string }[] };

async function subAccount(prefix: string, near: bigint) {
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: near * NEAR });
  return new Account(`${prefix}.${root.accountId}`, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
}

const view = async <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  (await root.provider.callFunction({ contractId, method, args })) as T;
const vault = (id: string) => view<VaultView>(bearer.accountId, "vault", { token_id: id });
const scheduleOf = (id: string) => view<Schedule | null>(schedule.accountId, "schedule", { token_id: id });
const total = async (a: Account) => (await a.getState()).balance.total;

/** A balance once pending receipts (gas refunds, payouts) have landed. */
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

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 30; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return read();
}

const call = (who: Account, contractId: string, methodName: string, args: object, deposit = 0n, gas = 100n * TGAS) =>
  who.callFunction({ contractId, methodName, args, deposit, gas });

const createVault = (who: Account) =>
  who.callFunction<string>({ contractId: bearer.accountId, methodName: "create_vault", args: { name: null, finish: "obsidian" }, deposit: CREATE_DEPOSIT, gas: 100n * TGAS });

/** The block clock, which `release` compares against. */
async function chainNow() {
  const b = (await root.provider.viewBlock({ finality: "final" })) as unknown as { header: { timestamp_nanosec: string } };
  return BigInt(b.header.timestamp_nanosec);
}

const sendToSchedule = (who: Account, id: string, recipient: string, at: bigint, cancellable: boolean) =>
  call(
    who,
    bearer.accountId,
    "nft_transfer_call",
    { receiver_id: schedule.accountId, token_id: id, msg: JSON.stringify({ recipient, release_at_ns: at.toString(), cancellable }) },
    ONE_YOCTO,
  );

/** A vault of alice's, scheduled for `recipient` at `at`. */
async function scheduled(recipient: string, at: bigint, cancellable: boolean) {
  const id = await createVault(alice);
  await call(alice, schedule.accountId, "deposit_for_schedule", {}, SCHEDULE_DEPOSIT, 30n * TGAS);
  await sendToSchedule(alice, id, recipient, at, cancellable);
  return id;
}

const release = (who: Account, id: string) => call(who, schedule.accountId, "release", { token_id: id });
const cancel = (who: Account, id: string) => call(who, schedule.accountId, "cancel", { token_id: id }, ONE_YOCTO);

beforeAll(async () => {
  sandbox = await Sandbox.start({});
  root = new Account("sandbox", sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  const signer = await subAccount("signer", 20n);
  bearer = await subAccount("bearer", 50n);
  schedule = await subAccount("schedule", 20n);
  alice = await subAccount("alice", 50n);
  bob = await subAccount("bob", 20n);
  carol = await subAccount("carol", 20n);

  await signer.deployContract(readFileSync(join(CONTRACTS, "out", "mock_signer.wasm")));
  await signer.callFunction({ contractId: signer.accountId, methodName: "new", args: { seed: "schedule" } });
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
  await schedule.deployContract(readFileSync(join(CONTRACTS, "out", "schedule.wasm")));
  await schedule.callFunction({
    contractId: schedule.accountId,
    methodName: "new",
    args: { nft_contract: bearer.accountId, schedule_deposit: SCHEDULE_DEPOSIT.toString() },
  });
});

afterAll(async () => {
  await sandbox?.tearDown();
});

describe("scheduling", () => {
  it("holds a sealed vault until the date, paid for by the schedule deposit (S7)", async () => {
    const at = (await chainNow()) + 3600n * SECOND;
    const storageBefore = (await schedule.getState()).storageUsage;
    const id = await scheduled(bob.accountId, at, true);
    expect(await scheduleOf(id)).toMatchObject({ giver: alice.accountId, recipient: bob.accountId, release_at_ns: at.toString(), cancellable: true, state: { kind: "waiting" } });
    const v = await vault(id);
    expect(v.owner_id).toBe(schedule.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    const used = BigInt((await schedule.getState()).storageUsage - storageBefore);
    expect(used * 10n ** 19n).toBeLessThanOrEqual(SCHEDULE_DEPOSIT);
  });

  it("giver_cannot_withdraw_while_scheduled (S6)", async () => {
    const id = await scheduled(bob.accountId, (await chainNow()) + 3600n * SECOND, true);
    await expectPanic(call(alice, bearer.accountId, "break_seal", { token_id: id }, ONE_YOCTO, 30n * TGAS), "ERR_NOT_OWNER");
    expect((await vault(id)).state).toEqual({ kind: "sealed" });
  });

  it("scheduling_without_deposit_returns_the_vault (S7)", async () => {
    const id = await createVault(alice);
    await sendToSchedule(alice, id, bob.accountId, (await chainNow()) + 3600n * SECOND, true);
    expect(await scheduleOf(id)).toBeNull();
    expect((await vault(id)).owner_id).toBe(alice.accountId);
  });

  it("opened_vault_cannot_be_scheduled (S6)", async () => {
    const id = await createVault(alice);
    await call(alice, bearer.accountId, "break_seal", { token_id: id }, ONE_YOCTO, 30n * TGAS);
    await call(alice, schedule.accountId, "deposit_for_schedule", {}, SCHEDULE_DEPOSIT, 30n * TGAS);
    await expectPanic(sendToSchedule(alice, id, bob.accountId, (await chainNow()) + 3600n * SECOND, true), "ERR_VAULT_OPENED");
    await call(alice, schedule.accountId, "withdraw_deposit", {}, ONE_YOCTO, 30n * TGAS);
  });

  it("only_bearer_can_schedule: a direct nft_on_transfer is refused (S1)", async () => {
    await expectPanic(
      call(carol, schedule.accountId, "nft_on_transfer", {
        sender_id: carol.accountId,
        previous_owner_id: carol.accountId,
        token_id: "1",
        msg: JSON.stringify({ recipient: carol.accountId, release_at_ns: "99999999999999999999", cancellable: false }),
      }),
      "ERR_WRONG_NFT_CONTRACT",
    );
  });

  it("release_waits_for_the_date (S2)", async () => {
    const id = await scheduled(bob.accountId, (await chainNow()) + 3600n * SECOND, false);
    await expectPanic(release(carol, id), "ERR_TOO_EARLY");
    await expectPanic(release(bob, id), "ERR_TOO_EARLY");
  });
});

describe("cancelling", () => {
  it("the giver can cancel a cancellable schedule before the date, and gets the deposit back (S4)", async () => {
    const id = await scheduled(bob.accountId, (await chainNow()) + 3600n * SECOND, true);
    await expectPanic(cancel(bob, id), "ERR_NOT_GIVER");
    const before = await settled(alice);
    await cancel(alice, id);
    await until(() => scheduleOf(id), (s) => s === null);
    expect((await vault(id)).owner_id).toBe(alice.accountId);
    // alice signed the cancel and paid its gas; the deposit must have come back.
    const delta = (await settled(alice)) - before;
    expect(delta).toBeGreaterThan(SCHEDULE_DEPOSIT - 5n * MILLI);
  });

  it("irrevocable_schedule_cannot_be_cancelled (S4)", async () => {
    const id = await scheduled(bob.accountId, (await chainNow()) + 3600n * SECOND, false);
    await expectPanic(cancel(alice, id), "ERR_NOT_CANCELLABLE");
    expect((await vault(id)).owner_id).toBe(schedule.accountId);
  });
});

describe("releasing on the date", () => {
  // These share one wait: each vault is scheduled about 65 s ahead (the minimum lead is 60 s).
  let toBob: string;
  let toNobody: string;
  let cancellable: string;
  const nobody = () => `nobody.${root.accountId}`;

  beforeAll(async () => {
    // Create and pay for all three first, so the shared date stays more than the minimum lead
    // (60 s) ahead while they're scheduled.
    [toBob, toNobody, cancellable] = [await createVault(alice), await createVault(alice), await createVault(alice)];
    await call(alice, schedule.accountId, "deposit_for_schedule", {}, 3n * SCHEDULE_DEPOSIT, 30n * TGAS);
    const at = (await chainNow()) + 70n * SECOND;
    await sendToSchedule(alice, toBob, bob.accountId, at, false);
    await sendToSchedule(alice, toNobody, nobody(), at, false);
    await sendToSchedule(alice, cancellable, bob.accountId, at, true);
    expect(await view<string>(schedule.accountId, "schedule_count")).toBeGreaterThanOrEqual(3);
    for (let now = await chainNow(); now < at; now = await chainNow()) await new Promise((r) => setTimeout(r, 1000));
  }, 180_000);

  it("anyone_can_release_on_the_date; the vault arrives sealed and the giver gets the deposit back (S2, S3)", async () => {
    const aliceBefore = await settled(alice);
    await release(carol, toBob); // carol is neither giver nor recipient
    await until(() => scheduleOf(toBob), (s) => s === null);
    const v = await vault(toBob);
    expect(v.owner_id).toBe(bob.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(v.signatures_requested).toBe(0);
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, schedule.accountId, bob.accountId]);
    // alice signs nothing here, so her balance changes by exactly the deposit.
    expect((await settled(alice)) - aliceBefore).toBe(SCHEDULE_DEPOSIT);
  });

  it("missing_recipient_keeps_the_vault (S5), until the account exists", async () => {
    await release(carol, toNobody);
    const s = await until(() => scheduleOf(toNobody), (x) => x?.state.kind === "waiting");
    expect(s?.state).toEqual({ kind: "waiting" });
    expect((await vault(toNobody)).owner_id).toBe(schedule.accountId);

    await subAccount("nobody", 1n);
    await release(carol, toNobody);
    await until(() => scheduleOf(toNobody), (x) => x === null);
    expect((await vault(toNobody)).owner_id).toBe(nobody());
  });

  it("no_cancelling_after_the_date (S4)", async () => {
    await expectPanic(cancel(alice, cancellable), "ERR_TOO_LATE");
    await release(bob, cancellable);
    await until(() => scheduleOf(cancellable), (x) => x === null);
    expect((await vault(cancellable)).owner_id).toBe(bob.accountId);
  });
});

describe("strays", () => {
  it("return_unscheduled sends a vault sent without a schedule back (S9)", async () => {
    const id = await createVault(alice);
    await call(alice, bearer.accountId, "nft_transfer", { receiver_id: schedule.accountId, token_id: id }, ONE_YOCTO, 30n * TGAS);
    await call(carol, schedule.accountId, "return_unscheduled", { token_id: id });
    expect((await until(() => vault(id), (v) => v.owner_id === alice.accountId)).owner_id).toBe(alice.accountId);
  });

  it("return_unscheduled can't take a scheduled vault (S9)", async () => {
    const id = await scheduled(bob.accountId, (await chainNow()) + 3600n * SECOND, true);
    await expectPanic(call(carol, schedule.accountId, "return_unscheduled", { token_id: id }), "ERR_SCHEDULED");
  });
});
