/**
 * Threat T6, the transfer-callback path, against the Bearer contract as deployed and locked
 * (contracts/res/bearer.wasm). A receiver contract (contracts/mock-receiver) breaks the seal on
 * the vault inside `nft_on_transfer`, then asks for the vault back. If the resolve step returned
 * it, an opened vault would have changed hands; Bearer must keep it with the receiver.
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
const ONE_YOCTO = 1n;
const TGAS = 10n ** 12n;

let sandbox: Sandbox;
let root: Account;
let bearer: Account;
let receiver: Account;
let alice: Account;

type VaultView = {
  owner_id: string;
  state: { kind: "sealed" } | { kind: "opened"; at_ns: string; by: string };
  signatures_requested: number;
  keys: unknown;
  custody: { account_id: string }[];
};

async function subAccount(prefix: string, near: bigint) {
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: near * NEAR });
  return new Account(`${prefix}.${root.accountId}`, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
}

const vault = (id: string) => root.provider.callFunction({ contractId: bearer.accountId, method: "vault", args: { token_id: id } }) as Promise<VaultView>;

async function createVault(owner: Account): Promise<string> {
  const id = await owner.callFunction<string>({
    contractId: bearer.accountId,
    methodName: "create_vault",
    args: { name: null, finish: "obsidian" },
    deposit: CREATE_DEPOSIT,
    gas: 100n * TGAS,
  });
  for (let i = 0; i < 20; i++) {
    if ((await vault(id)).keys) return id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`keys never arrived for vault ${id}`);
}

const transferCall = (from: Account, id: string, msg: string) =>
  from.callFunction<boolean>({
    contractId: bearer.accountId,
    methodName: "nft_transfer_call",
    args: { receiver_id: receiver.accountId, token_id: id, msg },
    deposit: ONE_YOCTO,
    gas: 200n * TGAS,
  });

async function expectFailure(p: Promise<unknown>) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
}

beforeAll(async () => {
  sandbox = await Sandbox.start({});
  root = new Account("sandbox", sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  const signer = await subAccount("signer", 20n);
  bearer = await subAccount("bearer", 50n);
  receiver = await subAccount("receiver", 10n);
  alice = await subAccount("alice", 50n);

  await signer.deployContract(readFileSync(join(CONTRACTS, "out", "mock_signer.wasm")));
  await signer.callFunction({ contractId: signer.accountId, methodName: "new", args: { seed: "transfer-call" } });
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
  await receiver.deployContract(readFileSync(join(CONTRACTS, "out", "mock_receiver.wasm")));
});

afterAll(async () => {
  await sandbox?.tearDown();
});

describe("a receiver that opens the vault in its transfer callback (T6)", () => {
  it("resolve_keeps_opened_vault_with_receiver", async () => {
    const id = await createVault(alice);
    const kept = await transferCall(alice, id, "open-then-return");

    const v = await vault(id);
    // The receiver broke the seal, then asked for the vault back; it stays with the receiver.
    expect(v.state).toMatchObject({ kind: "opened", by: receiver.accountId });
    expect(v.owner_id).toBe(receiver.accountId);
    expect(kept).toBe(true);
    // It never went back: custody shows alice, then the receiver, and nothing after.
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, receiver.accountId]);
    // And alice, who sent it, can't touch it.
    await expectFailure(
      alice.callFunction({ contractId: bearer.accountId, methodName: "break_seal", args: { token_id: id }, deposit: ONE_YOCTO, gas: 30n * TGAS }),
    );
    await expectFailure(
      alice.callFunction({
        contractId: bearer.accountId,
        methodName: "nft_transfer",
        args: { receiver_id: alice.accountId, token_id: id },
        deposit: ONE_YOCTO,
        gas: 30n * TGAS,
      }),
    );
    expect((await vault(id)).owner_id).toBe(receiver.accountId);
  });

  it("a sealed vault asked back is returned, still sealed", async () => {
    const id = await createVault(alice);
    const kept = await transferCall(alice, id, "return");

    const v = await vault(id);
    expect(kept).toBe(false);
    expect(v.owner_id).toBe(alice.accountId);
    expect(v.state.kind).toBe("sealed");
    expect(v.signatures_requested).toBe(0);
    expect(v.custody.map((c) => c.account_id)).toEqual([alice.accountId, receiver.accountId, alice.accountId]);
  });

  it("a receiver that keeps the vault keeps it, sealed", async () => {
    const id = await createVault(alice);
    const kept = await transferCall(alice, id, "keep");
    const v = await vault(id);
    expect(kept).toBe(true);
    expect(v.owner_id).toBe(receiver.accountId);
    expect(v.state.kind).toBe("sealed");
  });
});
