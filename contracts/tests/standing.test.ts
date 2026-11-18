/**
 * Sandbox tests for standing payments against the Bearer contract as deployed and locked
 * (contracts/res/bearer.wasm) and the mock MPC signer. Test names match docs/THREAT_MODEL.md
 * (P1–P12).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SystemInstruction, Transaction as SolTransaction } from "@solana/web3.js";
import * as bitcoin from "bitcoinjs-lib";
import { Account } from "near-api-js";
import { DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, Sandbox } from "near-sandbox";
import { parseTransaction, recoverTransactionAddress, type TransactionSerializedEIP1559 } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONTRACTS = join(import.meta.dirname, "..");
const NEAR = 10n ** 24n;
const MILLI = 10n ** 21n;
const CREATE_DEPOSIT = 50n * MILLI;
const WITHDRAW_DEPOSIT = 10n * MILLI;
const PLAN_DEPOSIT = 10n * MILLI;
const ONE_YOCTO = 1n;
const TGAS = 10n ** 12n;
const SECOND = 1_000_000_000n;
const DAY = 86_400n * SECOND;
const BASE_SEPOLIA = 84532;

const BTC_TO = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const EVM_TO = "0x3fa2b1c47d9e0f5a6b8c2d4e6f80a1b3c519cd00";
const SOL_TO = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOL_BLOCKHASH = "3SPUWvuNQALMPKUaABs4CjQ3X8H8TfRWcb8gcXd7nUoE";

let sandbox: Sandbox;
let root: Account;
let bearer: Account;
let signer: Account;
let standing: Account;
let alice: Account;
let bob: Account;
let eve: Account;

type Plan = {
  token_id: string;
  giver: string;
  payee: string;
  payments: number;
  withdrawals: number;
  opened: boolean;
  stopped_at_ns: string | null;
  state: { kind: string };
};
type VaultView = {
  owner_id: string;
  state: { kind: string; by?: string };
  btc_address: string | null;
  evm_address: string | null;
  sol_address: string | null;
};
type Withdrawal = { index: number; status: string; signed_raw_tx: string | null; error: string | null };

async function subAccount(prefix: string, near: bigint) {
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: near * NEAR });
  return new Account(`${prefix}.${root.accountId}`, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
}

const view = async <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  (await root.provider.callFunction({ contractId, method, args })) as T;
const vault = (id: string) => view<VaultView>(bearer.accountId, "vault", { token_id: id });
const planOf = (id: string) => view<Plan | null>(standing.accountId, "plan", { token_id: id });
const withdrawals = (id: string) => view<Withdrawal[]>(bearer.accountId, "withdrawals", { token_id: id });

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

const call = (who: Account, contractId: string, methodName: string, args: object, deposit = 0n, gas = 100n * TGAS) =>
  who.callFunction({ contractId, methodName, args, deposit, gas });

const createVault = (who: Account) =>
  who.callFunction<string>({ contractId: bearer.accountId, methodName: "create_vault", args: { name: null, finish: "obsidian" }, deposit: CREATE_DEPOSIT, gas: 100n * TGAS });

async function chainNow() {
  const b = (await root.provider.viewBlock({ finality: "final" })) as unknown as { header: { timestamp_nanosec: string } };
  return BigInt(b.header.timestamp_nanosec);
}

type Terms = {
  chain: "btc" | "evm" | "sol";
  to: string;
  chain_id?: string;
  amount: string;
  max_fee: string;
  interval_ns?: bigint;
  first_due_ns?: bigint;
  max_payments?: number;
  cancellable: boolean;
};

const sendToPlan = (who: Account, id: string, terms: Terms, payee = bob.accountId) =>
  call(
    who,
    bearer.accountId,
    "nft_transfer_call",
    {
      receiver_id: standing.accountId,
      token_id: id,
      msg: JSON.stringify({
        payee,
        ...terms,
        interval_ns: String(terms.interval_ns ?? DAY),
        first_due_ns: String(terms.first_due_ns ?? 0n),
        max_payments: terms.max_payments ?? null,
      }),
    },
    ONE_YOCTO,
  );

/** A vault of alice's, planned with `terms`, payee bob. */
async function planned(terms: Terms) {
  const id = await createVault(alice);
  await call(alice, standing.accountId, "deposit_for_plan", {}, PLAN_DEPOSIT, 30n * TGAS);
  await sendToPlan(alice, id, terms);
  expect((await planOf(id))?.giver).toBe(alice.accountId);
  return id;
}

const BTC_PLAN: Terms = { chain: "btc", to: BTC_TO, amount: "10000", max_fee: "1000", cancellable: true };

const btcCollect = (fee = 500, value = 50_000, n = 1) => ({
  chain: "btc",
  inputs: Array.from({ length: n }, (_, i) => ({ txid: (i + 7).toString(16).padStart(64, "0"), vout: 0, value_sat: String(value) })),
  fee_sat: String(fee),
});

/** Bearer's deposit per signature, plus a yoctoNEAR for the seal. */
const collect = (who: Account, id: string, params: object, deposit = WITHDRAW_DEPOSIT + 2n) =>
  call(who, standing.accountId, "collect", { token_id: id, params }, deposit, 300n * TGAS);

const settledPlan = (id: string) => until(() => planOf(id), (p) => p?.state.kind === "waiting");

const setSignerMode = (mode: "ok" | "error") =>
  root.callFunction({ contractId: signer.accountId, methodName: "set_mode", args: { mode } });

beforeAll(async () => {
  sandbox = await Sandbox.start({});
  root = new Account("sandbox", sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  signer = await subAccount("signer", 20n);
  bearer = await subAccount("bearer", 50n);
  standing = await subAccount("standing", 20n);
  alice = await subAccount("alice", 50n);
  bob = await subAccount("bob", 20n);
  eve = await subAccount("eve", 20n);

  await signer.deployContract(readFileSync(join(CONTRACTS, "out", "mock_signer.wasm")));
  await signer.callFunction({ contractId: signer.accountId, methodName: "new", args: { seed: "standing" } });
  await bearer.deployContract(readFileSync(join(CONTRACTS, "res", "bearer.wasm")));
  await bearer.callFunction({
    contractId: bearer.accountId,
    methodName: "new",
    args: {
      signer_id: signer.accountId,
      config: {
        evm_chain_ids: [BASE_SEPOLIA],
        max_btc_inputs: 4,
        create_deposit: CREATE_DEPOSIT.toString(),
        withdraw_deposit: WITHDRAW_DEPOSIT.toString(),
        mpc_sign_deposit: "1",
      },
      base_uri: null,
    },
  });
  await standing.deployContract(readFileSync(join(CONTRACTS, "out", "standing.wasm")));
  await standing.callFunction({
    contractId: standing.accountId,
    methodName: "new",
    args: { nft_contract: bearer.accountId, plan_deposit: PLAN_DEPOSIT.toString() },
  });
});

afterAll(async () => {
  await sandbox?.tearDown();
});

describe("planning", () => {
  it("only_bearer_can_plan (P1)", async () => {
    await expectPanic(
      call(eve, standing.accountId, "nft_on_transfer", {
        sender_id: eve.accountId,
        previous_owner_id: eve.accountId,
        token_id: "1",
        msg: JSON.stringify({ payee: bob.accountId, ...BTC_PLAN, interval_ns: String(DAY), first_due_ns: "0" }),
      }),
      "ERR_WRONG_NFT_CONTRACT",
    );
  });

  it("planning_without_deposit_returns_the_vault (P9)", async () => {
    const id = await createVault(alice);
    await sendToPlan(alice, id, BTC_PLAN);
    const v = await until(() => vault(id), (x) => x.owner_id === alice.accountId);
    expect(v.owner_id).toBe(alice.accountId);
    expect(v.state.kind).toBe("sealed");
    expect(await planOf(id)).toBeNull();
  });

  it("bad_terms_return_the_vault (P8)", async () => {
    const id = await createVault(alice);
    await call(alice, standing.accountId, "deposit_for_plan", {}, PLAN_DEPOSIT, 30n * TGAS);
    await sendToPlan(alice, id, { ...BTC_PLAN, cancellable: false });
    expect((await vault(id)).owner_id).toBe(alice.accountId);
    expect(await planOf(id)).toBeNull();
    await call(alice, standing.accountId, "withdraw_deposit", {}, ONE_YOCTO);
  });
});

describe("a Bitcoin plan", () => {
  let id: string;

  it("first_payment_opens_the_vault_and_pays_exactly_the_plan (P2, P3)", async () => {
    id = await planned(BTC_PLAN);
    await collect(bob, id, btcCollect(500));
    const p = await settledPlan(id);
    expect([p?.payments, p?.withdrawals, p?.opened]).toEqual([1, 1, true]);

    const v = await vault(id);
    expect(v.owner_id).toBe(standing.accountId);
    expect(v.state).toMatchObject({ kind: "opened", by: standing.accountId });

    const [w] = await withdrawals(id);
    expect(w.status).toBe("signed");
    const tx = bitcoin.Transaction.fromHex(w.signed_raw_tx as string);
    const net = bitcoin.networks.testnet;
    expect(tx.outs[0].value).toBe(10_000n);
    expect(Buffer.from(tx.outs[0].script).equals(Buffer.from(bitcoin.address.toOutputScript(BTC_TO, net)))).toBe(true);
    // Change back to the vault, less the payee's fee.
    expect(tx.outs[1].value).toBe(39_500n);
    expect(Buffer.from(tx.outs[1].script).equals(Buffer.from(bitcoin.address.toOutputScript(v.btc_address as string, net)))).toBe(true);
  });

  it("one_payment_per_period (P2)", async () => {
    await expectPanic(collect(bob, id, btcCollect(500)), "ERR_NOT_DUE");
  });

  it("only_the_payee_collects, within the fee cap (P2, P3)", async () => {
    await expectPanic(collect(eve, id, btcCollect(500)), "ERR_NOT_PAYEE");
    await expectPanic(collect(bob, id, btcCollect(1_001)), "ERR_FEE_TOO_HIGH");
    await expectPanic(collect(bob, id, { chain: "sol", recent_blockhash: SOL_BLOCKHASH }), "ERR_WRONG_CHAIN");
  });

  it("the_giver_withdraws_through_the_plan_and_the_payee_cannot (P5)", async () => {
    const params = { chain: "btc", inputs: btcCollect(300, 39_500).inputs, to_address: BTC_TO, amount_sat: "20000", fee_sat: "300" };
    await expectPanic(call(bob, standing.accountId, "withdraw", { token_id: id, params }, WITHDRAW_DEPOSIT + 1n, 300n * TGAS), "ERR_NOT_GIVER");
    await call(alice, standing.accountId, "withdraw", { token_id: id, params }, WITHDRAW_DEPOSIT + 1n, 300n * TGAS);
    const p = await settledPlan(id);
    expect([p?.payments, p?.withdrawals]).toEqual([1, 2]);
    const all = await withdrawals(id);
    expect(all.map((w) => w.status)).toEqual(["signed", "signed"]);
  });

  it("an_opened_vault_stays_and_stop_ends_the_payments (P5, P6)", async () => {
    await expectPanic(call(alice, standing.accountId, "take_back", { token_id: id }, ONE_YOCTO), "ERR_VAULT_OPENED");
    await expectPanic(call(bob, standing.accountId, "stop", { token_id: id }, ONE_YOCTO), "ERR_NOT_GIVER");
    await call(alice, standing.accountId, "stop", { token_id: id }, ONE_YOCTO);
    expect((await planOf(id))?.stopped_at_ns).not.toBeNull();
    await expectPanic(collect(bob, id, btcCollect(500)), "ERR_ENDED");
    // Bearer still refuses to move an opened vault, whoever asks.
    await expectPanic(
      call(alice, bearer.accountId, "nft_transfer", { receiver_id: alice.accountId, token_id: id }, ONE_YOCTO),
      "ERR_VAULT_OPENED",
    );
  });
});

describe("settlement (P4)", () => {
  it("a_refused_first_payment_leaves_the_vault_sealed", async () => {
    const id = await planned(BTC_PLAN);
    // Two yoctoNEAR: one for the seal, one for Bearer, which wants 0.01 NEAR and refuses.
    await collect(bob, id, btcCollect(500), 2n);
    const p = await settledPlan(id);
    expect([p?.payments, p?.withdrawals, p?.opened]).toEqual([0, 0, false]);
    expect((await vault(id)).state.kind).toBe("sealed");
    expect(await withdrawals(id)).toEqual([]);
  });

  it("an_unsigned_payment_counts_nothing_and_the_payee_can_try_again", async () => {
    const id = await planned(BTC_PLAN);
    await setSignerMode("error");
    try {
      await collect(bob, id, btcCollect(500));
    } finally {
      await setSignerMode("ok");
    }
    let p = await settledPlan(id);
    expect([p?.payments, p?.withdrawals, p?.opened]).toEqual([0, 1, true]);
    expect((await withdrawals(id))[0].status).toBe("failed");

    await collect(bob, id, btcCollect(500));
    p = await settledPlan(id);
    expect([p?.payments, p?.withdrawals]).toEqual([1, 2]);
    expect((await withdrawals(id)).map((w) => w.status)).toEqual(["failed", "signed"]);
  });
});

describe("an irrevocable Base Sepolia plan", () => {
  it("pays_exactly_the_plan_and_binds_the_giver (P3, P5)", async () => {
    const id = await planned({
      chain: "evm",
      to: EVM_TO.toUpperCase().replace("0X", "0x"),
      chain_id: String(BASE_SEPOLIA),
      amount: "1000000000000000",
      max_fee: String(21_000n * 2_000_000_000n),
      max_payments: 2,
      cancellable: false,
    });
    await expectPanic(call(alice, standing.accountId, "take_back", { token_id: id }, ONE_YOCTO), "ERR_PLAN_BINDING");
    await expectPanic(call(alice, standing.accountId, "stop", { token_id: id }, ONE_YOCTO), "ERR_NOT_CANCELLABLE");

    const gas = { nonce: "0", gas_limit: "21000", max_priority_fee_per_gas: "1000000" };
    await expectPanic(collect(bob, id, { chain: "evm", ...gas, max_fee_per_gas: "2000000001" }), "ERR_FEE_TOO_HIGH");
    await collect(bob, id, { chain: "evm", ...gas, max_fee_per_gas: "2000000000" });
    const p = await settledPlan(id);
    expect(p?.payments).toBe(1);

    const [w] = await withdrawals(id);
    const raw = `0x${w.signed_raw_tx}` as TransactionSerializedEIP1559;
    const tx = parseTransaction(raw);
    expect([tx.chainId, tx.to, tx.value]).toEqual([BASE_SEPOLIA, EVM_TO, 1_000_000_000_000_000n]);
    expect((await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase()).toBe((await vault(id)).evm_address);

    const params = { chain: "evm", chain_id: String(BASE_SEPOLIA), to: EVM_TO, amount_wei: "1", ...gas, nonce: "1", max_fee_per_gas: "2000000000" };
    await expectPanic(call(alice, standing.accountId, "withdraw", { token_id: id, params }, WITHDRAW_DEPOSIT + 1n, 300n * TGAS), "ERR_PLAN_BINDING");
  });
});

describe("a Solana plan", () => {
  it("pays_exactly_the_plan (P3)", async () => {
    const id = await planned({ chain: "sol", to: SOL_TO, amount: "1500000", max_fee: "0", cancellable: true });
    await collect(bob, id, { chain: "sol", recent_blockhash: SOL_BLOCKHASH });
    expect((await settledPlan(id))?.payments).toBe(1);
    const [w] = await withdrawals(id);
    const tx = SolTransaction.from(Buffer.from(w.signed_raw_tx as string, "hex"));
    expect(tx.verifySignatures()).toBe(true);
    const t = SystemInstruction.decodeTransfer(tx.instructions[0]);
    expect([t.fromPubkey.toBase58(), t.toPubkey.toBase58(), t.lamports]).toEqual([(await vault(id)).sol_address, SOL_TO, 1_500_000n]);
  });
});

describe("the giver's way out before the first payment (P6)", () => {
  it("a_cancellable_sealed_vault_goes_back_with_its_deposit", async () => {
    const id = await planned({ ...BTC_PLAN, first_due_ns: (await chainNow()) + DAY });
    await expectPanic(collect(bob, id, btcCollect(500)), "ERR_NOT_DUE");
    await call(alice, standing.accountId, "take_back", { token_id: id }, ONE_YOCTO);
    const v = await until(() => vault(id), (x) => x.owner_id === alice.accountId);
    expect(v.owner_id).toBe(alice.accountId);
    expect(v.state.kind).toBe("sealed");
    expect(await planOf(id)).toBeNull();
  });
});

describe("return_unplanned (P10)", () => {
  it("sends_a_vault_that_arrived_without_a_plan_back", async () => {
    const id = await createVault(alice);
    await call(alice, bearer.accountId, "nft_transfer", { receiver_id: standing.accountId, token_id: id }, ONE_YOCTO);
    expect((await vault(id)).owner_id).toBe(standing.accountId);
    await call(eve, standing.accountId, "return_unplanned", { token_id: id });
    const v = await until(() => vault(id), (x) => x.owner_id === alice.accountId);
    expect(v.owner_id).toBe(alice.accountId);
  });
});

describe("the next period (P2)", () => {
  it("pays_again_once_a_whole_period_has_passed", async () => {
    const interval = 60n * SECOND;
    const id = await planned({ ...BTC_PLAN, interval_ns: interval });
    await collect(bob, id, btcCollect(500));
    expect((await settledPlan(id))?.payments).toBe(1);
    await expectPanic(collect(bob, id, btcCollect(500)), "ERR_NOT_DUE");

    // The sandbox's clock runs in real time; wait out the minute.
    const due = BigInt((await view<string>(standing.accountId, "next_due", { token_id: id })));
    await until(chainNow, (now) => now >= due + SECOND);
    for (let i = 0; i < 300 && (await chainNow()) < due + SECOND; i++) await new Promise((r) => setTimeout(r, 500));
    expect(await view<number>(standing.accountId, "owed", { token_id: id })).toBe(1);

    await collect(bob, id, btcCollect(500, 39_500));
    const p = await settledPlan(id);
    expect([p?.payments, p?.withdrawals]).toEqual([2, 2]);
  });
});
