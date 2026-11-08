/**
 * Sandbox integration tests for the Bearer contract against the mock MPC signer.
 * Test names match docs/THREAT_MODEL.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Account, actions } from "near-api-js";
import { DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, Sandbox } from "near-sandbox";
import { getAddress, keccak256, recoverTransactionAddress, serializeTransaction, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OUT = join(import.meta.dirname, "..", "out");
const NEAR = 10n ** 24n;
const CREATE_DEPOSIT = 5n * 10n ** 22n; // 0.05 NEAR
const WITHDRAW_DEPOSIT = 10n ** 22n; // 0.01 NEAR
const ONE_YOCTO = 1n;
const TGAS = 10n ** 12n;
const BASE_SEPOLIA = 84532;

let sandbox: Sandbox;
let root: Account;
let bearer: Account;
let signer: Account;
let alice: Account;
let bob: Account;
let eve: Account;

async function subAccount(prefix: string, near: bigint) {
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: near * NEAR });
  return new Account(`${prefix}.${root.accountId}`, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
}

type VaultView = {
  token_id: string;
  owner_id: string;
  state: { kind: "sealed" } | { kind: "opened"; at_ns: string; by: string };
  signatures_requested: number;
  withdrawal_count: number;
  keys: { btc: string; evm: string; sol: string } | null;
  evm_address: string | null;
  custody: { account_id: string; since_ns: string }[];
};

type Withdrawal = {
  index: number;
  status: "pending" | "signed" | "failed";
  payload_hashes: string[];
  signed_raw_tx: string | null;
  error: string | null;
};

async function view<T>(method: string, args: Record<string, unknown>, contractId = bearer.accountId): Promise<T> {
  return (await root.provider.callFunction({ contractId, method, args })) as T;
}

const vault = (id: string) => view<VaultView>("vault", { token_id: id });
const withdrawals = (id: string) => view<Withdrawal[]>("withdrawals", { token_id: id });
const signCalls = () => view<number>("sign_calls", {}, signer.accountId);

async function expectPanic(p: Promise<unknown>, code: string) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, `expected ${code}`).toBeDefined();
  const text = `${String(err)} ${JSON.stringify(err, Object.getOwnPropertyNames(err as object))}`;
  expect(text).toContain(code);
}

async function createVault(owner: Account, name?: string): Promise<string> {
  const id = await owner.callFunction<string>({
    contractId: bearer.accountId,
    methodName: "create_vault",
    args: { name: name ?? null, finish: "obsidian" },
    deposit: CREATE_DEPOSIT,
    gas: 100n * TGAS,
  });
  // Derived keys arrive in a callback a block or two later.
  for (let i = 0; i < 20; i++) {
    const v = await vault(id);
    if (v.keys) return id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`keys never arrived for vault ${id}`);
}

const transfer = (from: Account, id: string, to: Account) =>
  from.callFunction({
    contractId: bearer.accountId,
    methodName: "nft_transfer",
    args: { receiver_id: to.accountId, token_id: id },
    deposit: ONE_YOCTO,
    gas: 30n * TGAS,
  });

const breakSeal = (who: Account, id: string) =>
  who.callFunction({
    contractId: bearer.accountId,
    methodName: "break_seal",
    args: { token_id: id },
    deposit: ONE_YOCTO,
    gas: 30n * TGAS,
  });

function evmParams(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    chain_id: String(BASE_SEPOLIA),
    nonce: "0",
    to: "0x3fa2b1c47d9e0f5a6b8c2d4e6f80a1b3c519cd00",
    amount_wei: "800000000000000",
    gas_limit: "21000",
    max_fee_per_gas: "2000000000",
    max_priority_fee_per_gas: "1000000",
    ...overrides,
  };
}

const withdrawEvm = (who: Account, id: string, params = evmParams()) =>
  who.callFunction({
    contractId: bearer.accountId,
    methodName: "withdraw_evm",
    args: { token_id: id, params },
    deposit: WITHDRAW_DEPOSIT + ONE_YOCTO,
    gas: 150n * TGAS,
  });

const setSignerMode = (mode: "ok" | "error" | "wrong_key") =>
  root.callFunction({ contractId: signer.accountId, methodName: "set_mode", args: { mode } });

beforeAll(async () => {
  sandbox = await Sandbox.start({});
  root = new Account("sandbox", sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  signer = await subAccount("signer", 20n);
  bearer = await subAccount("bearer", 50n);
  alice = await subAccount("alice", 50n);
  bob = await subAccount("bob", 50n);
  eve = await subAccount("eve", 50n);

  await signer.deployContract(readFileSync(join(OUT, "mock_signer.wasm")));
  await signer.callFunction({ contractId: signer.accountId, methodName: "new", args: { seed: "tests" } });

  await bearer.deployContract(readFileSync(join(OUT, "bearer.wasm")));
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
    },
  });
});

afterAll(async () => {
  await sandbox?.tearDown();
});

describe("create_vault", () => {
  it("mints a sealed vault with keys, an EVM address and a custody entry", async () => {
    const id = await createVault(alice, "Theo's birthday");
    const v = await vault(id);
    expect(v.owner_id).toBe(alice.accountId);
    expect(v.state).toEqual({ kind: "sealed" });
    expect(v.signatures_requested).toBe(0);
    expect(v.keys?.btc).toMatch(/^secp256k1:/);
    expect(v.keys?.sol).toMatch(/^ed25519:/);
    expect(v.evm_address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId]);
  });

  it("create_deposit_covers_max_vault (T12)", async () => {
    await createVault(alice, "x".repeat(32));
    await expectPanic(
      alice.callFunction({
        contractId: bearer.accountId,
        methodName: "create_vault",
        args: { name: null, finish: "sage" },
        deposit: CREATE_DEPOSIT - 1n,
        gas: 100n * TGAS,
      }),
      "ERR_DEPOSIT",
    );
    await expectPanic(
      alice.callFunction({
        contractId: bearer.accountId,
        methodName: "create_vault",
        args: { name: "x".repeat(33), finish: "sage" },
        deposit: CREATE_DEPOSIT,
        gas: 100n * TGAS,
      }),
      "ERR_NAME_TOO_LONG",
    );
  });
});

describe("the one rule", () => {
  it("sealed_vault_cannot_request_signature (T3)", async () => {
    const id = await createVault(alice);
    const before = await signCalls();
    await expectPanic(withdrawEvm(alice, id), "ERR_VAULT_SEALED");
    expect(await signCalls()).toBe(before);
    expect((await vault(id)).signatures_requested).toBe(0);
  });

  it("alice_cannot_break_seal_after_transfer and alice_cannot_withdraw_after_transfer (T1)", async () => {
    const id = await createVault(alice);
    await transfer(alice, id, bob);
    expect((await vault(id)).owner_id).toBe(bob.accountId);
    await expectPanic(breakSeal(alice, id), "ERR_NOT_OWNER");
    await expectPanic(withdrawEvm(alice, id), "ERR_NOT_OWNER");

    await breakSeal(bob, id);
    await expectPanic(withdrawEvm(alice, id), "ERR_NOT_OWNER");
    await expectPanic(withdrawEvm(eve, id), "ERR_NOT_OWNER");
  });

  it("opened_vault_rejects_nft_transfer and nft_transfer_call (T2)", async () => {
    const id = await createVault(bob);
    await breakSeal(bob, id);
    await expectPanic(transfer(bob, id, alice), "ERR_VAULT_OPENED");
    await expectPanic(
      bob.callFunction({
        contractId: bearer.accountId,
        methodName: "nft_transfer_call",
        args: { receiver_id: alice.accountId, token_id: id, msg: "" },
        deposit: ONE_YOCTO,
        gas: 100n * TGAS,
      }),
      "ERR_VAULT_OPENED",
    );
    expect((await vault(id)).owner_id).toBe(bob.accountId);
  });

  it("break_seal is one-way and needs exactly 1 yocto", async () => {
    const id = await createVault(alice);
    await expectPanic(
      alice.callFunction({ contractId: bearer.accountId, methodName: "break_seal", args: { token_id: id }, gas: 30n * TGAS }),
      "Requires attached deposit of exactly 1 yoctoNEAR",
    );
    await breakSeal(alice, id);
    await expectPanic(breakSeal(alice, id), "ERR_ALREADY_OPENED");
    const token = await view<{ metadata: { extra: string } }>("nft_token", { token_id: id });
    expect(JSON.parse(token.metadata.extra)).toEqual({ state: "opened" });
  });

  it("race_break_then_transfer and race_transfer_then_break (T4)", async () => {
    for (const order of ["break-first", "transfer-first"] as const) {
      const id = await createVault(alice);
      const ops =
        order === "break-first"
          ? [breakSeal(alice, id), transfer(alice, id, bob)]
          : [transfer(alice, id, bob), breakSeal(alice, id)];
      await Promise.allSettled(ops);
      const v = await vault(id);
      const opened = v.state.kind === "opened";
      const moved = v.owner_id !== alice.accountId;
      // Exactly one of the two can have happened, never both.
      expect(opened !== moved, `${order}: opened=${opened} moved=${moved}`).toBe(true);
    }
  });

  it("batched break_seal + withdraw is atomic (brief 4.8)", async () => {
    const id = await createVault(alice);
    const badBatch = alice.signAndSendTransaction({
      receiverId: bearer.accountId,
      actions: [
        actions.functionCall("break_seal", { token_id: id }, 30n * TGAS, ONE_YOCTO),
        actions.functionCall("withdraw_evm", { token_id: id, params: evmParams({ chain_id: "1" }) }, 150n * TGAS, WITHDRAW_DEPOSIT + 1n),
      ],
    });
    await expectPanic(badBatch, "ERR_CHAIN_NOT_SUPPORTED");
    expect((await vault(id)).state).toEqual({ kind: "sealed" });

    await alice.signAndSendTransaction({
      receiverId: bearer.accountId,
      actions: [
        actions.functionCall("break_seal", { token_id: id }, 30n * TGAS, ONE_YOCTO),
        actions.functionCall("withdraw_evm", { token_id: id, params: evmParams() }, 150n * TGAS, WITHDRAW_DEPOSIT + 1n),
      ],
    });
    const v = await vault(id);
    expect(v.state.kind).toBe("opened");
    expect(v.signatures_requested).toBe(1);
  });

  it("transfer_rejected_during_pending_signature (T5)", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    const results = await Promise.allSettled([withdrawEvm(alice, id), transfer(alice, id, bob)]);
    expect(results[1].status).toBe("rejected");
    expect(String((results[1] as PromiseRejectedResult).reason)).toContain("ERR_VAULT_OPENED");
    expect((await vault(id)).owner_id).toBe(alice.accountId);
  });

  it("nft_approve_not_exposed and approvals refused (T6)", async () => {
    const id = await createVault(alice);
    await expectPanic(
      alice.callFunction({
        contractId: bearer.accountId,
        methodName: "nft_approve",
        args: { token_id: id, account_id: eve.accountId },
        deposit: NEAR / 100n,
        gas: 30n * TGAS,
      }),
      "MethodNotFound",
    );
    await expectPanic(
      alice.callFunction({
        contractId: bearer.accountId,
        methodName: "nft_transfer",
        args: { receiver_id: bob.accountId, token_id: id, approval_id: 0 },
        deposit: ONE_YOCTO,
        gas: 30n * TGAS,
      }),
      "ERR_NO_APPROVALS",
    );
  });
});

describe("withdrawals from an opened vault", () => {
  it("signs a Base transfer that recovers to the vault's own address", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    const params = evmParams({ nonce: "3" });
    await withdrawEvm(alice, id, params);
    const [w] = await withdrawals(id);
    expect(w.status).toBe("signed");

    const unsigned = {
      type: "eip1559" as const,
      chainId: BASE_SEPOLIA,
      nonce: 3,
      to: getAddress(params.to as string),
      value: BigInt(params.amount_wei),
      gas: BigInt(params.gas_limit),
      maxFeePerGas: BigInt(params.max_fee_per_gas),
      maxPriorityFeePerGas: BigInt(params.max_priority_fee_per_gas),
      data: "0x" as Hex,
    };
    // The contract's hand-rolled EIP-1559 hash matches viem's.
    expect(`0x${w.payload_hashes[0]}`).toBe(keccak256(serializeTransaction(unsigned)));
    // The stored signed transaction is valid and was signed by the vault's address.
    const from = await recoverTransactionAddress({ serializedTransaction: `0x${w.signed_raw_tx}` as Hex });
    expect(from.toLowerCase()).toBe((await vault(id)).evm_address);
  });

  it("failed_signature_stays_opened and failed_signature_can_retry (T9)", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    await setSignerMode("error");
    try {
      await withdrawEvm(alice, id).catch(() => undefined);
    } finally {
      await setSignerMode("ok");
    }
    let [w] = await withdrawals(id);
    expect(w.status).toBe("failed");
    expect(w.error).toBe("ERR_SIGNER_FAILED");
    expect((await vault(id)).state.kind).toBe("opened");

    await withdrawEvm(alice, id);
    [, w] = await withdrawals(id);
    expect(w.status).toBe("signed");
  });

  it("rejects_signature_from_wrong_key (T17)", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    await setSignerMode("wrong_key");
    try {
      await withdrawEvm(alice, id).catch(() => undefined);
    } finally {
      await setSignerMode("ok");
    }
    const [w] = await withdrawals(id);
    expect(w.status).toBe("failed");
    expect(w.error).toBe("ERR_SIGNATURE_WRONG_KEY");
    expect(w.signed_raw_tx).toBeNull();
  });

  it("rejects unsupported chains and bad params (T7)", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    await expectPanic(withdrawEvm(alice, id, evmParams({ chain_id: "1" })), "ERR_CHAIN_NOT_SUPPORTED");
    await expectPanic(withdrawEvm(alice, id, evmParams({ to: "0x1234" })), "ERR_BAD_ADDRESS");
    await expectPanic(withdrawEvm(alice, id, evmParams({ gas_limit: "20999" })), "ERR_GAS_LIMIT_TOO_LOW");
  });
});

describe("custody and privileges", () => {
  it("records every holder in the custody log", async () => {
    const id = await createVault(alice);
    await transfer(alice, id, bob);
    await transfer(bob, id, eve);
    expect((await vault(id)).custody.map((c) => c.account_id)).toEqual([alice.accountId, bob.accountId, eve.accountId]);
  });

  it("no_privileged_methods (T11)", () => {
    const wasm = new WebAssembly.Module(readFileSync(join(OUT, "bearer.wasm")));
    const methods = WebAssembly.Module.exports(wasm)
      .filter((e) => e.kind === "function")
      .map((e) => e.name)
      .sort();
    expect(methods).toEqual(
      [
        "break_seal",
        "contract_source_metadata", // NEP-330, added by near-sdk
        "create_vault",
        "fetch_keys",
        "get_config",
        "new",
        "nft_metadata",
        "nft_resolve_transfer",
        "nft_supply_for_owner",
        "nft_token",
        "nft_tokens",
        "nft_tokens_for_owner",
        "nft_total_supply",
        "nft_transfer",
        "nft_transfer_call",
        "on_derived_keys",
        "on_evm_signed",
        "signer_id",
        "vault",
        "withdraw_evm",
        "withdrawals",
      ].sort(),
    );
  });
});
