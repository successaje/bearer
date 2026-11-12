/**
 * Sandbox tests for the dead man's switch, against the Bearer contract as deployed and locked
 * (contracts/res/bearer.wasm). Test names match docs/THREAT_MODEL.md (D1–D11).
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
const SWITCH_DEPOSIT = 10n * MILLI;
const ONE_YOCTO = 1n;
const TGAS = 10n ** 12n;
const SECOND = 1_000_000_000n;
const YEAR = 365n * 24n * 3600n * SECOND;

let sandbox: Sandbox;
let root: Account;
let bearer: Account;
let sw: Account;
let alice: Account;
let bob: Account;
let carol: Account;
let eve: Account;

type Switch = {
  token_id: string;
  owner: string;
  beneficiary: string;
  interval_ns: string;
  last_check_in_ns: string;
  deposit: string;
  state: { kind: "armed" | "taking_back" | "releasing" };
};
type VaultView = { owner_id: string; state: { kind: string }; signatures_requested: number; custody: { account_id: string }[] };

async function subAccount(prefix: string, near: bigint) {
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: near * NEAR });
  return new Account(`${prefix}.${root.accountId}`, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
}

const view = async <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  (await root.provider.callFunction({ contractId, method, args })) as T;
const vault = (id: string) => view<VaultView>(bearer.accountId, "vault", { token_id: id });
const switchFor = (id: string) => view<Switch | null>(sw.accountId, "switch_for", { token_id: id });
const total = async (a: Account) => (await a.getState()).balance.total;
const dueOf = (s: Switch) => BigInt(s.last_check_in_ns) + BigInt(s.interval_ns);

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

/** Settlement finishes a few receipts after the transaction returns. */
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

const depositForSwitch = (who: Account, amount = SWITCH_DEPOSIT) => call(who, sw.accountId, "deposit_for_switch", {}, amount, 30n * TGAS);

/** The owner's side of arming: Bearer moves the vault here and calls `nft_on_transfer`. */
const sendToSwitch = (who: Account, id: string, beneficiary: string, interval = YEAR) =>
  call(
    who,
    bearer.accountId,
    "nft_transfer_call",
    { receiver_id: sw.accountId, token_id: id, msg: JSON.stringify({ beneficiary, interval_ns: interval.toString() }) },
    ONE_YOCTO,
  );

/** A fresh vault of `who`'s, armed for `beneficiary`. */
async function armed(who: Account, beneficiary: string, interval = YEAR) {
  const id = await createVault(who);
  await depositForSwitch(who);
  await sendToSwitch(who, id, beneficiary, interval);
  return id;
}

const checkIn = (who: Account, id: string) => call(who, sw.accountId, "check_in", { token_id: id }, ONE_YOCTO, 30n * TGAS);
const update = (who: Account, id: string, beneficiary: string | null, interval: bigint | null = null) =>
  call(who, sw.accountId, "update", { token_id: id, beneficiary, interval_ns: interval?.toString() ?? null }, ONE_YOCTO, 30n * TGAS);
const takeBack = (who: Account, id: string) => call(who, sw.accountId, "take_back", { token_id: id }, ONE_YOCTO);
const release = (who: Account, id: string) => call(who, sw.accountId, "release", { token_id: id }, 0n, 150n * TGAS);

beforeAll(async () => {
  sandbox = await Sandbox.start({});
  root = new Account("sandbox", sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  const signer = await subAccount("signer", 20n);
  bearer = await subAccount("bearer", 50n);
  sw = await subAccount("switch", 20n);
  alice = await subAccount("alice", 50n);
  bob = await subAccount("bob", 20n);
  carol = await subAccount("carol", 20n);
  eve = await subAccount("eve", 20n);

  await signer.deployContract(readFileSync(join(CONTRACTS, "out", "mock_signer.wasm")));
  await signer.callFunction({ contractId: signer.accountId, methodName: "new", args: { seed: "switch" } });
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
  await sw.deployContract(readFileSync(join(CONTRACTS, "out", "switch.wasm")));
  await sw.callFunction({
    contractId: sw.accountId,
    methodName: "new",
    args: { nft_contract: bearer.accountId, switch_deposit: SWITCH_DEPOSIT.toString() },
  });
});

afterAll(async () => {
  await sandbox?.tearDown();
});

describe("arming", () => {
  it("holds a sealed vault in escrow, paid for by the switch deposit (D6)", async () => {
    const id = await createVault(alice);
    await depositForSwitch(alice);
    const storageBefore = (await sw.getState()).storageUsage;
    const at = await chainNow();
    await sendToSwitch(alice, id, bob.accountId);

    const s = await switchFor(id);
    expect(s).toMatchObject({ owner: alice.accountId, beneficiary: bob.accountId, interval_ns: YEAR.toString(), state: { kind: "armed" } });
    expect(BigInt(s!.deposit)).toBe(SWITCH_DEPOSIT);
    expect(dueOf(s!) - at).toBeGreaterThanOrEqual(YEAR);
    expect(dueOf(s!) - at).toBeLessThan(YEAR + 60n * SECOND);
    const v = await vault(id);
    expect(v.owner_id).toBe(sw.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(await view<string>(sw.accountId, "deposit_of", { account_id: alice.accountId })).toBe("0");
    // Room for the longest beneficiary an update could name, too.
    const used = BigInt((await sw.getState()).storageUsage - storageBefore) + BigInt(64 - bob.accountId.length);
    expect(used * 10n ** 19n).toBeLessThanOrEqual(SWITCH_DEPOSIT);
    await takeBack(alice, id);
    await until(() => switchFor(id), (x) => x === null);
  });

  it("arming_without_deposit_returns_the_vault (D6)", async () => {
    const id = await createVault(alice);
    await sendToSwitch(alice, id, bob.accountId);
    expect(await switchFor(id)).toBeNull();
    const v = await vault(id);
    expect(v.owner_id).toBe(alice.accountId);
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, sw.accountId, alice.accountId]);
  });

  it("bad_terms_return_the_vault: naming yourself, or too short an interval (D7)", async () => {
    const id = await createVault(alice);
    await depositForSwitch(alice);
    await sendToSwitch(alice, id, alice.accountId);
    expect(await switchFor(id)).toBeNull();
    await sendToSwitch(alice, id, bob.accountId, 59n * SECOND);
    expect(await switchFor(id)).toBeNull();
    expect((await vault(id)).owner_id).toBe(alice.accountId);
    await call(alice, sw.accountId, "withdraw_deposit", {}, ONE_YOCTO, 30n * TGAS);
  });

  it("opened_vault_cannot_be_armed (D2)", async () => {
    const id = await createVault(alice);
    await call(alice, bearer.accountId, "break_seal", { token_id: id }, ONE_YOCTO, 30n * TGAS);
    await depositForSwitch(alice);
    await expectPanic(sendToSwitch(alice, id, bob.accountId), "ERR_VAULT_OPENED");
    expect(await switchFor(id)).toBeNull();
    await call(alice, sw.accountId, "withdraw_deposit", {}, ONE_YOCTO, 30n * TGAS);
  });

  it("only_bearer_can_arm: a direct nft_on_transfer is refused (D1)", async () => {
    await expectPanic(
      call(
        eve,
        sw.accountId,
        "nft_on_transfer",
        { sender_id: eve.accountId, previous_owner_id: eve.accountId, token_id: "1", msg: JSON.stringify({ beneficiary: eve.accountId, interval_ns: YEAR.toString() }) },
        0n,
        30n * TGAS,
      ),
      "ERR_WRONG_NFT_CONTRACT",
    );
  });
});

describe("while the owner checks in", () => {
  it("owner_cannot_open_an_armed_vault, and nobody can release it early (D2, D4)", async () => {
    const id = await armed(alice, bob.accountId);
    await expectPanic(call(alice, bearer.accountId, "break_seal", { token_id: id }, ONE_YOCTO, 30n * TGAS), "ERR_NOT_OWNER");
    await expectPanic(release(eve, id), "ERR_NOT_SILENT");
    await expectPanic(release(bob, id), "ERR_NOT_SILENT");
    const v = await vault(id);
    expect(v.owner_id).toBe(sw.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(v.signatures_requested).toBe(0);
    await takeBack(alice, id);
    await until(() => switchFor(id), (x) => x === null);
  });

  it("only_the_owner_checks_in, updates or takes back (D3)", async () => {
    const id = await armed(alice, bob.accountId);
    await expectPanic(checkIn(eve, id), "ERR_NOT_OWNER");
    await expectPanic(checkIn(bob, id), "ERR_NOT_OWNER");
    await expectPanic(update(bob, id, bob.accountId, 60n * SECOND), "ERR_NOT_OWNER");
    await expectPanic(takeBack(eve, id), "ERR_NOT_OWNER");

    const before = dueOf((await switchFor(id))!);
    await checkIn(alice, id);
    expect(dueOf((await switchFor(id))!)).toBeGreaterThan(before);
    await update(alice, id, carol.accountId);
    expect((await switchFor(id))?.beneficiary).toBe(carol.accountId);
    await expectPanic(update(alice, id, alice.accountId), "ERR_BENEFICIARY");
    await takeBack(alice, id);
    await until(() => switchFor(id), (x) => x === null);
  });

  it("take_back returns the vault and the deposit (D3)", async () => {
    const id = await armed(alice, bob.accountId);
    const before = await settled(alice);
    await takeBack(alice, id);
    await until(() => switchFor(id), (x) => x === null);
    const v = await vault(id);
    expect(v.owner_id).toBe(alice.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, sw.accountId, alice.accountId]);
    // alice signed take_back and paid its gas; the deposit must have come back.
    const delta = (await settled(alice)) - before;
    expect(delta).toBeGreaterThan(SWITCH_DEPOSIT - 5n * MILLI);
    expect(delta).toBeLessThan(SWITCH_DEPOSIT);
  });
});

describe("after a silence", () => {
  // These share one wait: each switch has a 61 s interval (the shortest is 60 s).
  const SHORT = 61n * SECOND;
  let toBob: string;
  let toNobody: string;
  let lateCheckIn: string;
  let nobody: string;

  beforeAll(async () => {
    nobody = `nobody.${root.accountId}`;
    toBob = await armed(alice, bob.accountId, SHORT);
    toNobody = await armed(alice, nobody, SHORT);
    lateCheckIn = await armed(alice, bob.accountId, SHORT);
    const due = dueOf((await switchFor(lateCheckIn))!);
    for (let now = await chainNow(); now < due; now = await chainNow()) await new Promise((r) => setTimeout(r, 1000));
  }, 180_000);

  it("released_vault_goes_to_the_beneficiary_only, sealed; the owner gets the deposit back (D4, D5)", async () => {
    const aliceBefore = await settled(alice);
    // eve, a stranger, triggers it; the vault still goes to bob.
    await release(eve, toBob);
    await until(() => switchFor(toBob), (x) => x === null);
    const v = await vault(toBob);
    expect(v.owner_id).toBe(bob.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(v.signatures_requested).toBe(0);
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, sw.accountId, bob.accountId]);
    // alice signs nothing here, so her balance changes by exactly the deposit.
    expect((await settled(alice)) - aliceBefore).toBe(SWITCH_DEPOSIT);
  });

  it("missing_beneficiary_keeps_the_vault armed, and the owner can fix it (D7)", async () => {
    await release(eve, toNobody);
    const s = await until(() => switchFor(toNobody), (x) => x?.state.kind === "armed");
    expect(s?.state).toEqual({ kind: "armed" });
    expect((await vault(toNobody)).owner_id).toBe(sw.accountId);
    // Naming someone who exists counts as a check-in, so it isn't due any more.
    await update(alice, toNobody, carol.accountId);
    await expectPanic(release(eve, toNobody), "ERR_NOT_SILENT");
    await takeBack(alice, toNobody);
    await until(() => switchFor(toNobody), (x) => x === null);
  });

  it("a_late_check_in_still_counts until someone releases it (D10)", async () => {
    await checkIn(alice, lateCheckIn);
    await expectPanic(release(eve, lateCheckIn), "ERR_NOT_SILENT");
    expect((await vault(lateCheckIn)).owner_id).toBe(sw.accountId);
    await takeBack(alice, lateCheckIn);
    await until(() => switchFor(lateCheckIn), (x) => x === null);
  });
});

describe("strays", () => {
  it("return_unarmed sends a stray vault back to its sender (D8)", async () => {
    const id = await createVault(alice);
    await call(alice, bearer.accountId, "nft_transfer", { receiver_id: sw.accountId, token_id: id }, ONE_YOCTO, 30n * TGAS);
    expect((await vault(id)).owner_id).toBe(sw.accountId);
    await call(eve, sw.accountId, "return_unarmed", { token_id: id });
    expect((await until(() => vault(id), (v) => v.owner_id === alice.accountId)).owner_id).toBe(alice.accountId);
  });

  it("return_unarmed can't take an armed vault (D8)", async () => {
    const id = await armed(alice, bob.accountId);
    await expectPanic(call(eve, sw.accountId, "return_unarmed", { token_id: id }), "ERR_ARMED");
    expect((await vault(id)).owner_id).toBe(sw.accountId);
    await takeBack(alice, id);
  });
});
