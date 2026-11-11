/**
 * Sandbox tests for borrowing against a vault, against the Bearer contract as deployed and locked
 * (contracts/res/bearer.wasm). Test names match docs/THREAT_MODEL.md (L1–L11).
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
const LOAN_DEPOSIT = 10n * MILLI;
const ONE_YOCTO = 1n;
const TGAS = 10n ** 12n;
const SECOND = 1_000_000_000n;
const DAY = 24n * 3600n * SECOND;
/** alice borrows 2 NEAR and pays back 2.1 within 30 days, unless a test says otherwise. */
const PRINCIPAL = 2n * NEAR;
const REPAYMENT = (21n * NEAR) / 10n;
const TERM = 30n * DAY;

let sandbox: Sandbox;
let root: Account;
let bearer: Account;
let lend: Account;
let alice: Account;
let bob: Account;
let carol: Account;
let eve: Account;

type LoanState =
  | { kind: "requested" | "cancelling" }
  | { kind: "active" | "repaying" | "foreclosing"; lender: string; due_at_ns: string };
type Loan = {
  token_id: string;
  borrower: string;
  principal: string;
  repayment: string;
  term_ns: string;
  deposit: string;
  state: LoanState;
};
type VaultView = { owner_id: string; state: { kind: string }; signatures_requested: number; custody: { account_id: string }[] };

async function subAccount(prefix: string, near: bigint) {
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: near * NEAR });
  return new Account(`${prefix}.${root.accountId}`, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
}

const view = async <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  (await root.provider.callFunction({ contractId, method, args })) as T;
const vault = (id: string) => view<VaultView>(bearer.accountId, "vault", { token_id: id });
const loan = (id: string) => view<Loan | null>(lend.accountId, "loan", { token_id: id });
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

/** The block clock, which `repay` and `foreclose` compare against. */
async function chainNow() {
  const b = (await root.provider.viewBlock({ finality: "final" })) as unknown as { header: { timestamp_nanosec: string } };
  return BigInt(b.header.timestamp_nanosec);
}

const depositForLoan = (who: Account, amount = LOAN_DEPOSIT) => call(who, lend.accountId, "deposit_for_loan", {}, amount, 30n * TGAS);

/** The borrower's side of asking: Bearer moves the vault here and calls `nft_on_transfer`. */
const sendToLend = (who: Account, id: string, principal = PRINCIPAL, repayment = REPAYMENT, term = TERM) =>
  call(
    who,
    bearer.accountId,
    "nft_transfer_call",
    {
      receiver_id: lend.accountId,
      token_id: id,
      msg: JSON.stringify({ principal: principal.toString(), repayment: repayment.toString(), term_ns: term.toString() }),
    },
    ONE_YOCTO,
  );

/** A fresh vault of `who`'s, pledged for a loan nobody has funded yet. */
async function requested(who: Account, term = TERM) {
  const id = await createVault(who);
  await depositForLoan(who);
  await sendToLend(who, id, PRINCIPAL, REPAYMENT, term);
  return id;
}

const fund = (who: Account, id: string, principal = PRINCIPAL, repayment = REPAYMENT, term = TERM) =>
  call(who, lend.accountId, "fund", { token_id: id, repayment: repayment.toString(), term_ns: term.toString() }, principal);
const repay = (who: Account, id: string, amount = REPAYMENT) => call(who, lend.accountId, "repay", { token_id: id }, amount);
const foreclose = (who: Account, id: string) => call(who, lend.accountId, "foreclose", { token_id: id }, ONE_YOCTO);
const cancelRequest = (who: Account, id: string) => call(who, lend.accountId, "cancel_request", { token_id: id }, ONE_YOCTO);

beforeAll(async () => {
  sandbox = await Sandbox.start({});
  root = new Account("sandbox", sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  const signer = await subAccount("signer", 20n);
  bearer = await subAccount("bearer", 50n);
  lend = await subAccount("lend", 20n);
  alice = await subAccount("alice", 50n);
  bob = await subAccount("bob", 50n);
  carol = await subAccount("carol", 20n);
  eve = await subAccount("eve", 20n);

  await signer.deployContract(readFileSync(join(CONTRACTS, "out", "mock_signer.wasm")));
  await signer.callFunction({ contractId: signer.accountId, methodName: "new", args: { seed: "lend" } });
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
  await lend.deployContract(readFileSync(join(CONTRACTS, "out", "lend.wasm")));
  await lend.callFunction({
    contractId: lend.accountId,
    methodName: "new",
    args: { nft_contract: bearer.accountId, loan_deposit: LOAN_DEPOSIT.toString() },
  });
});

afterAll(async () => {
  await sandbox?.tearDown();
});

describe("asking for a loan", () => {
  it("holds a sealed vault in escrow, paid for by the loan deposit (L6)", async () => {
    const id = await createVault(alice);
    await depositForLoan(alice);
    const storageBefore = (await lend.getState()).storageUsage;
    await sendToLend(alice, id);

    const l = await loan(id);
    expect(l).toMatchObject({
      borrower: alice.accountId,
      principal: PRINCIPAL.toString(),
      repayment: REPAYMENT.toString(),
      term_ns: TERM.toString(),
      state: { kind: "requested" },
    });
    expect(BigInt(l!.deposit)).toBe(LOAN_DEPOSIT);
    const v = await vault(id);
    expect(v.owner_id).toBe(lend.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(await view<string>(lend.accountId, "deposit_of", { account_id: alice.accountId })).toBe("0");
    const used = BigInt((await lend.getState()).storageUsage - storageBefore);
    expect(used * 10n ** 19n).toBeLessThanOrEqual(LOAN_DEPOSIT);
    await cancelRequest(alice, id);
  });

  it("request_without_deposit_returns_the_vault (L6)", async () => {
    const id = await createVault(alice);
    await sendToLend(alice, id);
    expect(await loan(id)).toBeNull();
    const v = await vault(id);
    expect(v.owner_id).toBe(alice.accountId);
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, lend.accountId, alice.accountId]);
  });

  it("bad_terms_return_the_vault: repaying less than the loan (L6)", async () => {
    const id = await createVault(alice);
    await depositForLoan(alice);
    await sendToLend(alice, id, PRINCIPAL, PRINCIPAL - 1n);
    expect(await loan(id)).toBeNull();
    expect((await vault(id)).owner_id).toBe(alice.accountId);
    await call(alice, lend.accountId, "withdraw_deposit", {}, ONE_YOCTO, 30n * TGAS);
  });

  it("opened_vault_cannot_be_pledged (L2)", async () => {
    const id = await createVault(alice);
    await call(alice, bearer.accountId, "break_seal", { token_id: id }, ONE_YOCTO, 30n * TGAS);
    await depositForLoan(alice);
    await expectPanic(sendToLend(alice, id), "ERR_VAULT_OPENED");
    expect(await loan(id)).toBeNull();
    await call(alice, lend.accountId, "withdraw_deposit", {}, ONE_YOCTO, 30n * TGAS);
  });

  it("only_bearer_can_request: a direct nft_on_transfer is refused (L1)", async () => {
    await depositForLoan(eve);
    await expectPanic(
      call(
        eve,
        lend.accountId,
        "nft_on_transfer",
        {
          sender_id: eve.accountId,
          previous_owner_id: eve.accountId,
          token_id: "1",
          msg: JSON.stringify({ principal: PRINCIPAL.toString(), repayment: REPAYMENT.toString(), term_ns: TERM.toString() }),
        },
        0n,
        30n * TGAS,
      ),
      "ERR_WRONG_NFT_CONTRACT",
    );
  });
});

describe("funding", () => {
  it("fund_pays_the_borrower; the vault stays here, sealed (L2, L3)", async () => {
    const id = await requested(alice);
    const aliceBefore = await settled(alice);
    const at = await chainNow();
    await fund(bob, id);

    const l = await loan(id);
    expect(l?.state).toMatchObject({ kind: "active", lender: bob.accountId });
    const due = BigInt((l!.state as { due_at_ns: string }).due_at_ns);
    expect(due - at).toBeGreaterThanOrEqual(TERM);
    expect(due - at).toBeLessThan(TERM + 60n * SECOND);
    // alice signs nothing here, so her balance changes by exactly the principal.
    expect((await settled(alice)) - aliceBefore).toBe(PRINCIPAL);
    const v = await vault(id);
    expect(v.owner_id).toBe(lend.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(v.signatures_requested).toBe(0);
  });

  it("fund_refuses_changed_terms, a wrong amount, and the borrower's own money (L7)", async () => {
    const id = await requested(alice);
    await expectPanic(fund(bob, id, PRINCIPAL, REPAYMENT + 1n), "ERR_TERMS_CHANGED");
    await expectPanic(fund(bob, id, PRINCIPAL, REPAYMENT, TERM + 1n), "ERR_TERMS_CHANGED");
    await expectPanic(fund(bob, id, PRINCIPAL - 1n), "ERR_WRONG_PRINCIPAL");
    await expectPanic(fund(alice, id), "ERR_OWN_LOAN");
    expect((await loan(id))?.state).toEqual({ kind: "requested" });
    await cancelRequest(alice, id);
  });

  it("borrower_cannot_open_a_pledged_vault, or take it back once funded (L2, L8)", async () => {
    const id = await requested(alice);
    await fund(bob, id);
    await expectPanic(call(alice, bearer.accountId, "break_seal", { token_id: id }, ONE_YOCTO, 30n * TGAS), "ERR_NOT_OWNER");
    await expectPanic(cancelRequest(alice, id), "ERR_NOT_REQUESTED");
    await expectPanic(fund(carol, id), "ERR_NOT_REQUESTED");
    await expectPanic(foreclose(bob, id), "ERR_NOT_DUE");
    expect((await vault(id)).state).toEqual({ kind: "sealed" });
  });
});

describe("repaying", () => {
  it("repaid_vault_moves_first_then_lender_is_paid (L3)", async () => {
    const id = await requested(alice);
    await fund(bob, id);
    const bobBefore = await settled(bob);

    await repay(alice, id);
    await until(() => loan(id), (l) => l === null);

    const v = await vault(id);
    expect(v.owner_id).toBe(alice.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(v.signatures_requested).toBe(0);
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, lend.accountId, alice.accountId]);
    // bob signs nothing here, so his balance changes by exactly the repayment.
    expect((await settled(bob)) - bobBefore).toBe(REPAYMENT);
  });

  it("repay_needs_the_exact_amount, and only the borrower repays (L8)", async () => {
    const id = await requested(alice);
    await fund(bob, id);
    await expectPanic(repay(alice, id, REPAYMENT - 1n), "ERR_WRONG_REPAYMENT");
    await expectPanic(repay(carol, id), "ERR_NOT_BORROWER");
    expect((await loan(id))?.state).toMatchObject({ kind: "active" });
    await repay(alice, id);
    await until(() => loan(id), (l) => l === null);
  });
});

describe("cancelling", () => {
  it("only_the_borrower_can_cancel; it returns the vault and the deposit (L8)", async () => {
    const id = await requested(alice);
    await expectPanic(cancelRequest(eve, id), "ERR_NOT_BORROWER");
    const before = await settled(alice);
    await cancelRequest(alice, id);
    await until(() => loan(id), (l) => l === null);
    expect((await vault(id)).owner_id).toBe(alice.accountId);
    // alice signed the cancel and paid its gas; the deposit must have come back.
    const delta = (await settled(alice)) - before;
    expect(delta).toBeGreaterThan(LOAN_DEPOSIT - 5n * MILLI);
    expect(delta).toBeLessThan(LOAN_DEPOSIT);
    await expectPanic(fund(bob, id), "ERR_NO_LOAN");
  });
});

describe("past the due date", () => {
  // These share one wait: both loans run for 61 s (the shortest term is 60 s).
  const SHORT = 61n * SECOND;
  let first: string;
  let second: string;

  beforeAll(async () => {
    [first, second] = [await requested(alice, SHORT), await requested(alice, SHORT)];
    await fund(bob, first, PRINCIPAL, REPAYMENT, SHORT);
    await fund(bob, second, PRINCIPAL, REPAYMENT, SHORT);
    const due = BigInt(((await loan(second))!.state as { due_at_ns: string }).due_at_ns);
    for (let now = await chainNow(); now < due; now = await chainNow()) await new Promise((r) => setTimeout(r, 1000));
  }, 180_000);

  it("no_repaying_after_the_due_date (L8)", async () => {
    await expectPanic(repay(alice, first), "ERR_PAST_DUE");
    expect((await loan(first))?.state).toMatchObject({ kind: "active" });
  });

  it("only_the_lender_can_foreclose (L8)", async () => {
    await expectPanic(foreclose(carol, first), "ERR_NOT_LENDER");
    await expectPanic(foreclose(alice, first), "ERR_NOT_LENDER");
  });

  it("foreclosed_vault_goes_to_the_lender_sealed; the borrower gets the deposit back (L3, L8)", async () => {
    const aliceBefore = await settled(alice);
    for (const id of [first, second]) {
      await foreclose(bob, id);
      await until(() => loan(id), (l) => l === null);
      const v = await vault(id);
      expect(v.owner_id).toBe(bob.accountId);
      expect(v.state).toEqual({ kind: "sealed" });
      expect(v.signatures_requested).toBe(0);
      expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, lend.accountId, bob.accountId]);
    }
    // alice signs nothing here, so her balance changes by exactly the two deposits.
    expect((await settled(alice)) - aliceBefore).toBe(2n * LOAN_DEPOSIT);
  });
});

describe("strays", () => {
  it("return_unrequested sends a stray vault back to its sender (L9)", async () => {
    const id = await createVault(alice);
    await call(alice, bearer.accountId, "nft_transfer", { receiver_id: lend.accountId, token_id: id }, ONE_YOCTO, 30n * TGAS);
    expect((await vault(id)).owner_id).toBe(lend.accountId);
    await call(eve, lend.accountId, "return_unrequested", { token_id: id });
    expect((await until(() => vault(id), (v) => v.owner_id === alice.accountId)).owner_id).toBe(alice.accountId);
  });

  it("return_unrequested can't take a pledged vault (L9)", async () => {
    const id = await requested(alice);
    await expectPanic(call(eve, lend.accountId, "return_unrequested", { token_id: id }), "ERR_PLEDGED");
    expect((await vault(id)).owner_id).toBe(lend.accountId);
    await cancelRequest(alice, id);
  });
});
