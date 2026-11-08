/**
 * Day-1 testnet spike (brief 7.3, spikes 1, 4 and 5) against the real MPC signer.
 *
 *   node spike/testnet-sign.ts setup   # subaccounts, deploy, init (skips what exists)
 *   node spike/testnet-sign.ts run     # measure; writes a JSON report
 *   node spike/testnet-sign.ts gas-floor   # create_vault refuses 40 Tgas, works at 44
 *
 * Needs BEARER_TESTNET_PARENT: a faucet-created testnet account whose key is in
 * ~/.near-credentials/testnet. Subaccount keys are written there too, never to the repo.
 * Every number in the report is measured on testnet; nothing is estimated.
 */
import { createPublicKey, randomBytes, verify } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, KeyPair, PublicKey, actions } from "near-api-js";
import { getAddress, parseTransaction, recoverTransactionAddress, type TransactionSerializedEIP1559 } from "viem";
import { publicKeyToAddress } from "viem/accounts";

// rpc.testnet.near.org is deprecated and rate-limits (HTTP 429) part-way through a run.
const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const BASE_RPC = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const SIGNER = "v1.signer-prod.testnet";
const PARENT = process.env.BEARER_TESTNET_PARENT;
if (!PARENT) throw new Error("Set BEARER_TESTNET_PARENT to a faucet-created testnet account.");
const CONTRACT = `${process.env.BEARER_TESTNET_PREFIX ?? "v3a"}.${PARENT}`;
const ALICE = `alice.${PARENT}`;
const BOB = `bob.${PARENT}`;
const RUNS = Number(process.env.SPIKE_RUNS ?? 5);

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const CREATE_DEPOSIT = 5n * 10n ** 22n; // 0.05 NEAR, as in the sandbox tests
const WITHDRAW_DEPOSIT = 10n ** 22n; // 0.01 NEAR
const BASE_SEPOLIA = 84532;
const WASM = join(import.meta.dirname, "..", "..", "out", "bearer.wasm");
const CREDS = join(homedir(), ".near-credentials", "testnet");

/* ---------- accounts and RPC ---------- */

function account(id: string) {
  const { private_key } = JSON.parse(readFileSync(join(CREDS, `${id}.json`), "utf8"));
  return new Account(id, RPC, private_key);
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await res.json();
    const err = body.error ?? body.result?.error;
    // send_tx/tx time out while receipts are still running; ask again.
    if (err && attempt < 20 && /TIMEOUT|UNKNOWN_TRANSACTION|timeout/i.test(JSON.stringify(err))) {
      await sleep(1500);
      continue;
    }
    if (err) throw new Error(`${method}: ${JSON.stringify(err).slice(0, 400)}`);
    return body.result as T;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function exists(id: string) {
  try {
    await rpc("query", { request_type: "view_account", finality: "final", account_id: id });
    return true;
  } catch {
    return false;
  }
}

async function viewAccount(id: string) {
  return rpc<{ amount: string; storage_usage: number; code_hash: string }>("query", {
    request_type: "view_account",
    finality: "final",
    account_id: id,
  });
}

async function view<T>(contractId: string, method: string, args: object): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

type Outcome = {
  transaction: { hash: string };
  status: { SuccessValue?: string; Failure?: unknown };
  transaction_outcome: { outcome: { gas_burnt: number } };
  receipts_outcome: { outcome: { executor_id: string; gas_burnt: number; status: Record<string, unknown> } }[];
};

/** Submits and returns as soon as the transaction is in a final block. */
async function submit(from: Account, receiverId: string, acts: ReturnType<typeof actions.functionCall>[]) {
  const sent = Date.now();
  const r = (await from.signAndSendTransaction({ receiverId, actions: acts, waitUntil: "INCLUDED_FINAL" })) as unknown as Outcome;
  return { hash: r.transaction.hash, sent };
}

/** Waits for every receipt, including yield/resume from the signer. */
async function finalOutcome(hash: string, sender: string): Promise<Outcome> {
  for (;;) {
    const r = await rpc<Outcome & { final_execution_status: string }>("tx", {
      tx_hash: hash,
      sender_account_id: sender,
      wait_until: "FINAL",
    });
    if (r.final_execution_status === "FINAL" || r.status.SuccessValue !== undefined || r.status.Failure) return r;
    await sleep(1000);
  }
}

function gasReport(o: Outcome) {
  const receipts = o.receipts_outcome.map((r) => ({
    executor: r.outcome.executor_id,
    tgas: +(r.outcome.gas_burnt / 1e12).toFixed(3),
    failed: "Failure" in r.outcome.status,
  }));
  const total = o.transaction_outcome.outcome.gas_burnt + o.receipts_outcome.reduce((s, r) => s + r.outcome.gas_burnt, 0);
  return { total_tgas: +(total / 1e12).toFixed(3), receipts };
}

const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/* ---------- setup ---------- */

async function setup() {
  const parent = account(PARENT!);
  for (const [id, near] of [
    [CONTRACT, 5n],
    [ALICE, 1n],
    [BOB, 1n],
  ] as const) {
    if (await exists(id)) {
      console.log(`exists  ${id}`);
      continue;
    }
    const kp = KeyPair.fromRandom("ed25519");
    await parent.createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey(), nearToTransfer: near * NEAR });
    writeFileSync(
      join(CREDS, `${id}.json`),
      JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }),
      { mode: 0o600 },
    );
    console.log(`created ${id} (${near} NEAR)`);
  }

  const contract = account(CONTRACT);
  const state = await viewAccount(CONTRACT);
  if (state.code_hash === "11111111111111111111111111111111") {
    await contract.deployContract(readFileSync(WASM));
    await contract.callFunction({
      contractId: CONTRACT,
      methodName: "new",
      args: {
        signer_id: SIGNER,
        config: {
          evm_chain_ids: [BASE_SEPOLIA],
          max_btc_inputs: 4,
          create_deposit: CREATE_DEPOSIT.toString(),
          withdraw_deposit: WITHDRAW_DEPOSIT.toString(),
          mpc_sign_deposit: "1",
        },
      },
      gas: 30n * TGAS,
    });
    console.log(`deployed and initialised ${CONTRACT}`);
  } else {
    console.log(`code    ${CONTRACT} ${(await viewAccount(CONTRACT)).code_hash}`);
  }
}

/* ---------- run ---------- */

type VaultView = {
  token_id: string;
  owner_id: string;
  state: { kind: string };
  signatures_requested: number;
  keys: { btc: string; evm: string; sol: string } | null;
  evm_address: string | null;
  paths: { btc: string; evm: string; sol: string };
};
type Withdrawal = { index: number; status: "pending" | "signed" | "failed"; signed_raw_tx: string | null; error: string | null };

async function run() {
  const report: Record<string, unknown> = {};
  try {
    await measure(report);
  } catch (e) {
    report.error = String(e);
    process.exitCode = 1;
  } finally {
    const dir = join(import.meta.dirname, "reports");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `testnet-sign-${String(report.measured_at ?? new Date().toISOString())}.json`.replace(/:/g, "-"));
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report: ${file}`);
  }
}

async function measure(report: Record<string, unknown>) {
  const alice = account(ALICE);
  const bob = account(BOB);
  Object.assign(report, {
    measured_at: new Date().toISOString(),
    contract: CONTRACT,
    signer: SIGNER,
    signer_version: await view<string>(SIGNER, "version", {}),
    rpc: RPC,
  });

  // Spike 4: create_vault fetches the derived keys from the signer in a cross-contract call.
  const before = (await viewAccount(CONTRACT)).storage_usage;
  const created = await submit(alice, CONTRACT, [
    actions.functionCall("create_vault", { name: "Spike vault, 32 characters long!", finish: "obsidian" }, 100n * TGAS, CREATE_DEPOSIT),
  ]);
  const createOutcome = await finalOutcome(created.hash, ALICE);
  const tokenId = JSON.parse(Buffer.from(createOutcome.status.SuccessValue ?? "", "base64").toString());
  let vault = await view<VaultView>(CONTRACT, "vault", { token_id: tokenId });
  for (let i = 0; !vault.keys && i < 60; i++) {
    await sleep(500);
    vault = await view<VaultView>(CONTRACT, "vault", { token_id: tokenId });
  }
  const keysMs = Date.now() - created.sent;
  if (!vault.keys || !vault.evm_address) throw new Error(`keys never arrived for vault ${tokenId}`);
  report.create_vault = {
    token_id: tokenId,
    tx: explorer(created.hash),
    keys_visible_after_ms: keysMs,
    gas: gasReport(createOutcome),
    storage_bytes_added: (await viewAccount(CONTRACT)).storage_usage - before,
  };

  // Spike 5: what the contract stored equals what the signer derives for (contract, path).
  const parity: Record<string, unknown> = {};
  for (const chain of ["btc", "evm", "sol"] as const) {
    const derived = await view<string>(SIGNER, "derived_public_key", {
      path: vault.paths[chain],
      predecessor: CONTRACT,
      domain_id: chain === "sol" ? 1 : 0,
    });
    parity[chain] = { path: vault.paths[chain], stored: vault.keys[chain], matches_signer: derived === vault.keys[chain] };
  }
  const evmKey = PublicKey.fromString(vault.keys.evm).data;
  const evmFromKey = publicKeyToAddress(`0x04${Buffer.from(evmKey).toString("hex")}`);
  parity.evm_address = {
    stored: vault.evm_address,
    from_key_via_viem: evmFromKey,
    matches: getAddress(vault.evm_address) === evmFromKey,
  };
  report.parity = parity;

  // Hand the vault from alice to bob, then bob opens it.
  const moved = await submit(alice, CONTRACT, [
    actions.functionCall("nft_transfer", { receiver_id: BOB, token_id: tokenId }, 30n * TGAS, ONE_YOCTO),
  ]);
  report.nft_transfer = { tx: explorer(moved.hash), gas: gasReport(await finalOutcome(moved.hash, ALICE)) };

  // Spike 1 (domain 0): run 1 is break_seal + withdraw_evm in one transaction, runs 2..N withdraw again.
  const runs: Record<string, unknown>[] = [];
  report.withdraw_evm = { runs };
  for (let n = 0; n < RUNS; n++) {
    const params = {
      chain_id: String(BASE_SEPOLIA),
      nonce: String(n),
      to: vault.evm_address,
      amount_wei: "1000000000000",
      gas_limit: "21000",
      max_fee_per_gas: "2000000000",
      max_priority_fee_per_gas: "1000000",
    };
    const acts = [actions.functionCall("withdraw_evm", { token_id: tokenId, params }, 150n * TGAS, WITHDRAW_DEPOSIT + ONE_YOCTO)];
    if (n === 0) acts.unshift(actions.functionCall("break_seal", { token_id: tokenId }, 30n * TGAS, ONE_YOCTO));
    const sent = await submit(bob, CONTRACT, acts);

    let w: Withdrawal | undefined;
    for (let i = 0; i < 240; i++) {
      const list = await view<Withdrawal[]>(CONTRACT, "withdrawals", { token_id: tokenId, from_index: n, limit: 1 });
      w = list[0];
      if (w && w.status !== "pending") break;
      await sleep(500);
    }
    const signedMs = Date.now() - sent.sent;
    const outcome = await finalOutcome(sent.hash, BOB);
    const row: Record<string, unknown> = {
      run: n + 1,
      batched_break_seal: n === 0,
      tx: explorer(sent.hash),
      status: w?.status,
      error: w?.error,
      signed_visible_after_ms: signedMs,
      gas: gasReport(outcome),
    };
    if (w?.signed_raw_tx) {
      const raw = `0x${w.signed_raw_tx.replace(/^0x/, "")}` as TransactionSerializedEIP1559;
      const tx = parseTransaction(raw);
      const from = await recoverTransactionAddress({ serializedTransaction: raw });
      row.evm = {
        recovers_to_vault: from === getAddress(vault.evm_address),
        chain_id: tx.chainId,
        nonce: tx.nonce,
        type: tx.type,
      };
      if (n === 0) row.raw_tx = raw;
    }
    runs.push(row);
    console.log(`run ${n + 1}: ${w?.status} in ${signedMs} ms`);
  }
  report.withdraw_evm = {
    runs,
    n: runs.length,
    median_signed_visible_ms: median(runs.map((r) => r.signed_visible_after_ms as number)),
  };

  // The first signed tx, offered to Base Sepolia. Unfunded, it should fail on balance, not on format.
  const raw = runs[0]?.raw_tx as string | undefined;
  if (raw) {
    const res = await fetch(BASE_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] }),
    });
    report.base_sepolia_broadcast = await res.json();
  }

  // Spike 1 (domain 1): the signer's Ed25519 path, called directly by alice.
  const path = "bearer-spike:eddsa";
  const edKey = await view<string>(SIGNER, "derived_public_key", { path, predecessor: ALICE, domain_id: 1 });
  const edRuns: { run: number; final_after_ms: number; [k: string]: unknown }[] = [];
  report.sign_eddsa_direct = { derived_key: edKey, runs: edRuns };
  for (let n = 0; n < RUNS; n++) {
    const msg = randomBytes(32);
    const sent = await submit(alice, SIGNER, [
      actions.functionCall(
        "sign",
        { request: { path, payload_v2: { Eddsa: msg.toString("hex") }, domain_id: 1 } },
        50n * TGAS,
        ONE_YOCTO,
      ),
    ]);
    const outcome = await finalOutcome(sent.hash, ALICE);
    const ms = Date.now() - sent.sent;
    const value = outcome.status.SuccessValue ? JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString()) : null;
    let valid = false;
    if (value?.signature) {
      const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(PublicKey.fromString(edKey).data)]);
      valid = verify(null, msg, createPublicKey({ key: der, format: "der", type: "spki" }), Buffer.from(value.signature));
    }
    edRuns.push({ run: n + 1, tx: explorer(sent.hash), final_after_ms: ms, scheme: value?.scheme ?? null, verifies: valid, gas: gasReport(outcome).total_tgas });
    console.log(`eddsa ${n + 1}: ${valid ? "valid" : "INVALID"} in ${ms} ms`);
  }
  report.sign_eddsa_direct = { derived_key: edKey, runs: edRuns, n: edRuns.length, median_final_ms: median(edRuns.map((r) => r.final_after_ms)) };
}

/** Redeploys the current wasm in place. Only for unlocked spike accounts with an unchanged state layout. */
async function redeploy() {
  await account(CONTRACT).deployContract(readFileSync(WASM));
  console.log(`redeployed ${CONTRACT} ${(await viewAccount(CONTRACT)).code_hash}`);
}

/** create_vault must refuse gas that can't cover the key requests, and work at the floor. */
async function gasFloor() {
  const alice = account(ALICE);
  for (const tgas of [40n, 44n]) {
    try {
      const sent = await submit(alice, CONTRACT, [
        actions.functionCall("create_vault", { name: null, finish: "sage" }, tgas * TGAS, CREATE_DEPOSIT),
      ]);
      const o = await finalOutcome(sent.hash, ALICE);
      const id = o.status.SuccessValue ? JSON.parse(Buffer.from(o.status.SuccessValue, "base64").toString()) : null;
      let v = id ? await view<VaultView>(CONTRACT, "vault", { token_id: id }) : null;
      for (let i = 0; v && !v.keys && i < 40; i++) {
        await sleep(500);
        v = await view<VaultView>(CONTRACT, "vault", { token_id: id });
      }
      console.log(`${tgas} Tgas: vault ${id}, keys ${v?.keys ? "stored" : "MISSING"}, ${explorer(sent.hash)}`);
    } catch (e) {
      console.log(`${tgas} Tgas: refused, ${String(e).match(/ERR_[A-Z_]+/)?.[0] ?? String(e).slice(0, 160)}`);
    }
  }
}

const cmd = process.argv[2];
if (cmd === "setup") await setup();
else if (cmd === "run") await run();
else if (cmd === "redeploy") await redeploy();
else if (cmd === "gas-floor") await gasFloor();
else {
  console.log("usage: node spike/testnet-sign.ts setup|run|redeploy|gas-floor");
  process.exitCode = 1;
}
