/**
 * Sandbox integration tests for the Bearer contract against the mock MPC signer.
 * Test names match docs/THREAT_MODEL.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { PublicKey as SolKey, SystemInstruction, SystemProgram, Transaction as SolTransaction } from "@solana/web3.js";
import * as bitcoin from "bitcoinjs-lib";
import { createHash } from "node:crypto";
import { Account, PublicKey, actions } from "near-api-js";
import { DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, Sandbox } from "near-sandbox";
import {
  getAddress,
  keccak256,
  recoverTransactionAddress,
  serializeTransaction,
  type Hex,
  type TransactionSerializedEIP1559,
} from "viem";
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
  btc_address: string | null;
  evm_address: string | null;
  sol_address: string | null;
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

const BTC_TO = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const fakeTxid = (n: number) => n.toString(16).padStart(64, "0");

/** One input per `[value_sat, vout]`, each from a different (made-up) transaction. */
function btcParams(inputs: [number, number][], amount: number, fee: number, to = BTC_TO) {
  return {
    inputs: inputs.map(([value, vout], i) => ({ txid: fakeTxid(i + 1), vout, value_sat: String(value) })),
    to_address: to,
    amount_sat: String(amount),
    fee_sat: String(fee),
  };
}

const withdrawBtc = (
  who: Account,
  id: string,
  params: ReturnType<typeof btcParams>,
  { deposit = (WITHDRAW_DEPOSIT + ONE_YOCTO) * BigInt(params.inputs.length), gas = 150n * TGAS } = {},
) =>
  who.callFunction({
    contractId: bearer.accountId,
    methodName: "withdraw_btc",
    args: { token_id: id, params },
    deposit,
    gas,
  });

/** Compressed SEC1 key from a NEAR `secp256k1:` key (64 bytes, x ‖ y). */
function compressedKey(nearKey: string) {
  const raw = PublicKey.fromString(nearKey).data;
  const out = new Uint8Array(33);
  out[0] = raw[63] & 1 ? 3 : 2;
  out.set(raw.slice(0, 32), 1);
  return out;
}

/** Checks a signed spend with bitcoinjs-lib and noble: sighashes, witnesses and signatures. */
function checkSignedSpend(w: Withdrawal, params: ReturnType<typeof btcParams>, pubkey: Uint8Array) {
  const tx = bitcoin.Transaction.fromHex(w.signed_raw_tx as string);
  expect(tx.version).toBe(2);
  expect(tx.locktime).toBe(0);
  expect(tx.ins.map((i) => [Buffer.from(i.hash).reverse().toString("hex"), i.index])).toEqual(
    params.inputs.map((i) => [i.txid, i.vout]),
  );
  const pkh = bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.testnet });
  const scriptCode = bitcoin.payments.p2pkh({ hash: pkh.hash }).output as Uint8Array;
  params.inputs.forEach((input, i) => {
    const hash = tx.hashForWitnessV0(i, scriptCode, BigInt(input.value_sat), bitcoin.Transaction.SIGHASH_ALL);
    // The contract's BIP143 digest is bitcoinjs-lib's.
    expect(Buffer.from(hash).toString("hex")).toBe(w.payload_hashes[i]);
    const [sig, key] = tx.ins[i].witness;
    expect(sig[sig.length - 1]).toBe(bitcoin.Transaction.SIGHASH_ALL);
    expect(Buffer.from(key).equals(Buffer.from(pubkey))).toBe(true);
    expect(secp256k1.verify(sig.subarray(0, -1), hash, pubkey, { prehash: false, format: "der", lowS: true })).toBe(true);
  });
  return { tx, vaultScript: pkh.output as Uint8Array };
}

const SOL_TO = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOL_BLOCKHASH = "3SPUWvuNQALMPKUaABs4CjQ3X8H8TfRWcb8gcXd7nUoE";
const solParams = (o: Partial<{ recent_blockhash: string; to: string; lamports: string }> = {}) => ({
  recent_blockhash: SOL_BLOCKHASH,
  to: SOL_TO,
  lamports: "1500000",
  ...o,
});
const withdrawSol = (who: Account, id: string, params = solParams()) =>
  who.callFunction({
    contractId: bearer.accountId,
    methodName: "withdraw_sol",
    args: { token_id: id, params },
    deposit: WITHDRAW_DEPOSIT + ONE_YOCTO,
    gas: 100n * TGAS,
  });

/** Parses a signed Solana transfer with @solana/web3.js and checks it end to end. */
function checkSolTransfer(w: Withdrawal, vaultAddress: string, params: ReturnType<typeof solParams>) {
  const tx = SolTransaction.from(Buffer.from(w.signed_raw_tx as string, "hex"));
  expect(tx.verifySignatures()).toBe(true);
  expect(tx.feePayer?.toBase58()).toBe(vaultAddress);
  expect(tx.recentBlockhash).toBe(params.recent_blockhash);
  expect(tx.instructions).toHaveLength(1);
  const [ix] = tx.instructions;
  expect(ix.programId.equals(SystemProgram.programId)).toBe(true);
  expect(SystemInstruction.decodeInstructionType(ix)).toBe("Transfer");
  const t = SystemInstruction.decodeTransfer(ix);
  expect([t.fromPubkey.toBase58(), t.toPubkey.toBase58(), String(t.lamports)]).toEqual([vaultAddress, params.to, params.lamports]);
  expect(createHash("sha256").update(tx.serializeMessage()).digest("hex")).toBe(w.payload_hashes[0]);
}

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
      base_uri: "https://bearer.example/nft",
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

  it("create_vault_requires_gas_for_keys", async () => {
    // The signer's derived_public_key burns ~5.4 Tgas each on testnet; three of them plus the
    // callback must fit, or the vault would be minted without keys.
    await expectPanic(
      alice.callFunction({
        contractId: bearer.accountId,
        methodName: "create_vault",
        args: { name: null, finish: "sage" },
        deposit: CREATE_DEPOSIT,
        gas: 40n * TGAS,
      }),
      "ERR_GAS",
    );
    const id = await alice.callFunction<string>({
      contractId: bearer.accountId,
      methodName: "create_vault",
      args: { name: null, finish: "sage" },
      deposit: CREATE_DEPOSIT,
      gas: 44n * TGAS,
    });
    for (let i = 0; i < 20 && !(await vault(id)).keys; i++) await new Promise((r) => setTimeout(r, 500));
    expect((await vault(id)).keys).not.toBeNull();
  });
});

describe("token media", () => {
  it("points each token at a live image of its seal (brief 3.3 #9)", async () => {
    const id = await createVault(alice);
    const meta = await view<{ base_uri: string | null }>("nft_metadata", {});
    const token = await view<{ metadata: { media: string | null; extra: string } }>("nft_token", { token_id: id });
    expect(meta.base_uri).toBe("https://bearer.example/nft");
    expect(token.metadata.media).toBe(`${id}.svg`);
    expect(JSON.parse(token.metadata.extra).state).toBe("sealed");
    await breakSeal(alice, id);
    const opened = await view<{ metadata: { media: string | null; extra: string } }>("nft_token", { token_id: id });
    // Same media URL; the image itself changes because it reads the chain.
    expect(opened.metadata.media).toBe(`${id}.svg`);
    expect(JSON.parse(opened.metadata.extra).state).toBe("opened");
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
    const from = await recoverTransactionAddress({ serializedTransaction: `0x${w.signed_raw_tx}` as TransactionSerializedEIP1559 });
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

describe("bitcoin withdrawals", () => {
  it("signs a P2WPKH spend: payment out, change back to the vault (T7)", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    const v = await vault(id);
    const pubkey = compressedKey(v.keys!.btc);
    // The contract's address is bitcoinjs-lib's P2WPKH address for the derived key.
    expect(v.btc_address).toBe(bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.testnet }).address);

    const params = btcParams([[60_000, 0], [25_000, 3]], 70_000, 1_500);
    await withdrawBtc(alice, id, params);
    const [w] = await withdrawals(id);
    expect(w.status).toBe("signed");
    const { tx, vaultScript } = checkSignedSpend(w, params, pubkey);
    expect(tx.outs).toHaveLength(2);
    expect(tx.outs[0].value).toBe(70_000n);
    expect(Buffer.from(tx.outs[0].script).equals(Buffer.from(bitcoin.address.toOutputScript(BTC_TO, bitcoin.networks.testnet)))).toBe(true);
    expect(tx.outs[1].value).toBe(13_500n);
    expect(Buffer.from(tx.outs[1].script).equals(Buffer.from(vaultScript))).toBe(true);
    expect((await vault(id)).signatures_requested).toBe(2);
  });

  it("joins max_btc_inputs signatures into one callback; no change when spending it all", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    const pubkey = compressedKey((await vault(id)).keys!.btc);
    const params = btcParams([[10_000, 0], [10_000, 1], [10_000, 2], [10_000, 3]], 39_000, 1_000);
    await withdrawBtc(alice, id, params);
    const [w] = await withdrawals(id);
    expect(w.status).toBe("signed");
    expect(w.payload_hashes).toHaveLength(4);
    const { tx } = checkSignedSpend(w, params, pubkey);
    expect(tx.outs).toHaveLength(1);
    expect((await vault(id)).signatures_requested).toBe(4);
  });

  it("sealed_vault_cannot_request_btc_signature (T3) and alice_cannot_withdraw_btc_after_transfer (T1)", async () => {
    const id = await createVault(alice);
    const params = btcParams([[50_000, 0]], 40_000, 1_000);
    await expectPanic(withdrawBtc(alice, id, params), "ERR_VAULT_SEALED");
    await transfer(alice, id, bob);
    await breakSeal(bob, id);
    await expectPanic(withdrawBtc(alice, id, params), "ERR_NOT_OWNER");
    expect((await vault(id)).signatures_requested).toBe(0);
  });

  it("rejects bad Bitcoin spends before asking for a signature (T7)", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    const ok = btcParams([[50_000, 0]], 40_000, 1_000);
    await expectPanic(withdrawBtc(alice, id, btcParams([], 1_000, 100)), "ERR_NO_INPUTS");
    await expectPanic(
      withdrawBtc(alice, id, btcParams([[1_000, 0], [1_000, 0], [1_000, 0], [1_000, 0], [1_000, 0]], 3_000, 100)),
      "ERR_TOO_MANY_INPUTS",
    );
    await expectPanic(withdrawBtc(alice, id, { ...ok, to_address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" }), "ERR_WRONG_NETWORK");
    await expectPanic(withdrawBtc(alice, id, { ...ok, to_address: "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn" }), "ERR_BAD_ADDRESS");
    await expectPanic(withdrawBtc(alice, id, btcParams([[50_000, 0]], 200, 1_000)), "ERR_AMOUNT_BELOW_DUST");
    await expectPanic(withdrawBtc(alice, id, btcParams([[50_000, 0]], 49_500, 1_000)), "ERR_INSUFFICIENT_INPUTS");
    await expectPanic(withdrawBtc(alice, id, btcParams([[50_000, 0]], 48_900, 1_000)), "ERR_CHANGE_BELOW_DUST");
    await expectPanic(
      withdrawBtc(alice, id, { ...ok, inputs: [ok.inputs[0], ok.inputs[0]] }, { deposit: (WITHDRAW_DEPOSIT + ONE_YOCTO) * 2n }),
      "ERR_DUPLICATE_INPUT",
    );
    const two = btcParams([[30_000, 0], [30_000, 1]], 40_000, 1_000);
    await expectPanic(withdrawBtc(alice, id, two, { deposit: WITHDRAW_DEPOSIT + ONE_YOCTO }), "ERR_DEPOSIT");
    await expectPanic(withdrawBtc(alice, id, two, { gas: 60n * TGAS }), "ERR_GAS");
    expect((await vault(id)).signatures_requested).toBe(0);
  });

  it("a failed Bitcoin signature fails the whole withdrawal, which can be retried (T9, T17)", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    const params = btcParams([[30_000, 0], [30_000, 1]], 50_000, 1_000);
    for (const mode of ["error", "wrong_key"] as const) {
      await setSignerMode(mode);
      try {
        await withdrawBtc(alice, id, params).catch(() => undefined);
      } finally {
        await setSignerMode("ok");
      }
    }
    const [failed, wrong] = await withdrawals(id);
    expect([failed.status, failed.error]).toEqual(["failed", "ERR_SIGNER_FAILED: input 0"]);
    expect([wrong.status, wrong.error]).toEqual(["failed", "ERR_SIGNATURE_WRONG_KEY"]);
    expect(wrong.signed_raw_tx).toBeNull();
    expect((await vault(id)).state.kind).toBe("opened");

    await withdrawBtc(alice, id, params);
    const [, , retried] = await withdrawals(id);
    expect(retried.status).toBe("signed");
  });
});

describe("solana withdrawals", () => {
  it("signs one SystemProgram transfer from the vault (sol_single_transfer_only, T7)", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    const v = await vault(id);
    // The Solana address is the Ed25519 key itself.
    expect(v.sol_address).toBe(new SolKey(PublicKey.fromString(v.keys!.sol).data).toBase58());

    await withdrawSol(alice, id);
    const [w] = await withdrawals(id);
    expect(w.status).toBe("signed");
    checkSolTransfer(w, v.sol_address!, solParams());

    // Sending to itself lists the vault once and still verifies.
    const self = solParams({ to: v.sol_address!, lamports: "5" });
    await withdrawSol(alice, id, self);
    const [, w2] = await withdrawals(id);
    checkSolTransfer(w2, v.sol_address!, self);
    expect((await vault(id)).signatures_requested).toBe(2);
  });

  it("sealed_vault_cannot_request_sol_signature (T3) and alice_cannot_withdraw_sol_after_transfer (T1)", async () => {
    const id = await createVault(alice);
    await expectPanic(withdrawSol(alice, id), "ERR_VAULT_SEALED");
    await transfer(alice, id, bob);
    await breakSeal(bob, id);
    await expectPanic(withdrawSol(alice, id), "ERR_NOT_OWNER");
    expect((await vault(id)).signatures_requested).toBe(0);
  });

  it("rejects bad Solana params before asking for a signature (T7)", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    await expectPanic(withdrawSol(alice, id, solParams({ to: SystemProgram.programId.toBase58() })), "ERR_BAD_ADDRESS");
    await expectPanic(withdrawSol(alice, id, solParams({ to: "0x3fa2b1c47d9e0f5a6b8c2d4e6f80a1b3c519cd00" })), "ERR_BAD_ADDRESS");
    await expectPanic(withdrawSol(alice, id, solParams({ lamports: "0" })), "ERR_AMOUNT_ZERO");
    await expectPanic(withdrawSol(alice, id, solParams({ recent_blockhash: "not-a-blockhash" })), "ERR_BAD_BLOCKHASH");
    expect((await vault(id)).signatures_requested).toBe(0);
  });

  it("a failed or wrong-key Ed25519 signature fails the withdrawal (T9, T17)", async () => {
    const id = await createVault(alice);
    await breakSeal(alice, id);
    for (const mode of ["error", "wrong_key"] as const) {
      await setSignerMode(mode);
      try {
        await withdrawSol(alice, id).catch(() => undefined);
      } finally {
        await setSignerMode("ok");
      }
    }
    const [failed, wrong] = await withdrawals(id);
    expect([failed.status, failed.error]).toEqual(["failed", "ERR_SIGNER_FAILED"]);
    expect([wrong.status, wrong.error]).toEqual(["failed", "ERR_SIGNATURE_WRONG_KEY"]);
    expect((await vault(id)).state.kind).toBe("opened");
    await withdrawSol(alice, id);
    expect((await withdrawals(id))[2].status).toBe("signed");
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
        "deposit_near", // v2: NEAR-side holdings (holdings.rs)
        "fetch_keys",
        "ft_on_transfer",
        "get_config",
        "holdings",
        // v2: adds staking to the deployment made before it. #[private]: only the account's own
        // key can call it, and nothing can once the account is locked.
        "migrate_add_staking",
        "new",
        "nft_metadata",
        "nft_on_transfer",
        "nft_resolve_transfer",
        "nft_supply_for_owner",
        "nft_token",
        "nft_tokens",
        "nft_tokens_for_owner",
        "nft_total_supply",
        "nft_transfer",
        "nft_transfer_call",
        "on_batch_unstaked", // v2: staking (staking.rs)
        "on_batch_withdrawn",
        "on_btc_signed",
        "on_derived_keys",
        "on_evm_signed",
        "on_near_withdrawn",
        "on_nft_withdrawn",
        "on_sol_signed",
        "on_stake_priced",
        "on_staked",
        "on_token_withdrawn",
        "on_unstake_priced",
        "process_unstaking",
        "signer_id",
        "stake",
        "stake_of",
        "staking",
        "unstake",
        "vault",
        "withdraw_btc",
        "withdraw_evm",
        "withdraw_near",
        "withdraw_nft",
        "withdraw_sol",
        "withdraw_token",
        "withdrawals",
      ].sort(),
    );
  });

  it("declares the standards it implements (NEP-330), and no approvals", async () => {
    const meta = await view<{ standards: { standard: string }[] }>("contract_source_metadata", {});
    expect(meta.standards.map((s) => s.standard).sort()).toEqual(["nep171", "nep177", "nep181", "nep297", "nep330"]);
  });
});
