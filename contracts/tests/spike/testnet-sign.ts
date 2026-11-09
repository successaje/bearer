/**
 * Day-1 testnet spike (brief 7.3, spikes 1, 4 and 5) against the real MPC signer.
 *
 *   node spike/testnet-sign.ts setup   # subaccounts, deploy, init (skips what exists)
 *   node spike/testnet-sign.ts run     # measure; writes a JSON report
 *   node spike/testnet-sign.ts gas-floor   # create_vault refuses 40 Tgas, works at 44
 *   node spike/testnet-sign.ts broadcast <token> <index>   # send a stored withdrawal to Base Sepolia
 *   node spike/testnet-sign.ts btc-joined <token>   # 1–4 joined Bitcoin signatures (made-up inputs, never broadcast)
 *   node spike/testnet-sign.ts btc-vault            # alice creates a vault to fund with testnet4 BTC
 *   node spike/testnet-sign.ts btc-withdraw <token> # transfer to bob, break the seal, withdraw, broadcast
 *   node spike/testnet-sign.ts sol-withdraw <token> # sign a devnet transfer; airdrop and broadcast if possible
 *   CONFIRM_LOCK=<contract> node spike/testnet-sign.ts lock  # delete every key; only if the code is BEARER_WASM
 *
 * Needs BEARER_TESTNET_PARENT: a faucet-created testnet account whose key is in
 * ~/.near-credentials/testnet. Subaccount keys are written there too, never to the repo.
 * Every number in the report is measured on testnet; nothing is estimated.
 */
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { Transaction as SolTransaction } from "@solana/web3.js";
import * as bitcoin from "bitcoinjs-lib";
import { Account, KeyPair, PublicKey, actions } from "near-api-js";
import { getAddress, parseTransaction, recoverTransactionAddress, type TransactionSerializedEIP1559 } from "viem";
import { publicKeyToAddress } from "viem/accounts";

// rpc.testnet.near.org is deprecated and rate-limits (HTTP 429) part-way through a run.
const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const BASE_RPC = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
// Esplora API for testnet4. mempool.space/testnet4 is the brief's pointer but didn't answer from
// this machine on 2026-11-08; Blockstream's and mempool.emzy.de's agreed on the tip.
const SOL_RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const ESPLORA = process.env.ESPLORA_API ?? "https://blockstream.info/testnet4/api";
const SIGNER = "v1.signer-prod.testnet";
const PARENT = process.env.BEARER_TESTNET_PARENT;
if (!PARENT) throw new Error("Set BEARER_TESTNET_PARENT to a faucet-created testnet account.");
// BEARER_CONTRACT_ID names a contract account that already exists (the locked deployment,
// bearer.testnet); otherwise the contract is a subaccount of the parent.
const CONTRACT = process.env.BEARER_CONTRACT_ID ?? `${process.env.BEARER_TESTNET_PREFIX ?? "v3a"}.${PARENT}`;
const ALICE = `alice.${PARENT}`;
const BOB = `bob.${PARENT}`;
const RUNS = Number(process.env.SPIKE_RUNS ?? 5);

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const CREATE_DEPOSIT = 5n * 10n ** 22n; // 0.05 NEAR, as in the sandbox tests
const WITHDRAW_DEPOSIT = 10n ** 22n; // 0.01 NEAR
const BASE_SEPOLIA = 84532;
// BEARER_WASM points setup at another build, e.g. the reproducible one in contracts/res.
const WASM = process.env.BEARER_WASM ?? join(import.meta.dirname, "..", "..", "out", "bearer.wasm");
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
        // Where wallets fetch each token's live image: the web app's /nft route.
        base_uri: process.env.BEARER_MEDIA_BASE_URI ?? null,
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
  withdrawal_count: number;
  keys: { btc: string; evm: string; sol: string } | null;
  btc_address: string | null;
  evm_address: string | null;
  sol_address: string | null;
  paths: { btc: string; evm: string; sol: string };
};
type Withdrawal = {
  index: number;
  status: "pending" | "signed" | "failed";
  payload_hashes: string[];
  signed_raw_tx: string | null;
  error: string | null;
};

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

async function baseRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result as T;
}

/**
 * Broadcasts a stored withdrawal to Base Sepolia and waits for its receipt. It reads the signed
 * transaction from the contract's public view, as anyone could (brief 4.11: stored_tx_is_public).
 */
async function broadcast(tokenId: string, index: number) {
  const vault = await view<VaultView>(CONTRACT, "vault", { token_id: tokenId });
  const [w] = await view<Withdrawal[]>(CONTRACT, "withdrawals", { token_id: tokenId, from_index: index, limit: 1 });
  if (!w?.signed_raw_tx || !vault.evm_address) throw new Error(`no signed transaction at vault ${tokenId} #${index}`);
  const raw = `0x${w.signed_raw_tx.replace(/^0x/, "")}` as TransactionSerializedEIP1559;
  const from = await recoverTransactionAddress({ serializedTransaction: raw });
  if (from !== getAddress(vault.evm_address)) throw new Error(`signed by ${from}, not the vault`);

  const sent = Date.now();
  const hash = await baseRpc<string>("eth_sendRawTransaction", [raw]);
  let receipt: { status: string; blockNumber: string; gasUsed: string; effectiveGasPrice: string } | null = null;
  while (!receipt) {
    await sleep(1000);
    receipt = await baseRpc("eth_getTransactionReceipt", [hash]);
  }
  const tx = parseTransaction(raw);
  const result = {
    broadcast_at: new Date(sent).toISOString(),
    contract: CONTRACT,
    token_id: tokenId,
    withdrawal_index: index,
    from,
    to: tx.to,
    value_wei: tx.value?.toString(),
    nonce: tx.nonce,
    hash,
    explorer: `https://sepolia.basescan.org/tx/${hash}`,
    status: receipt.status === "0x1" ? "success" : "reverted",
    block: Number(BigInt(receipt.blockNumber)),
    gas_used: Number(BigInt(receipt.gasUsed)),
    fee_wei: (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)).toString(),
    receipt_after_ms: Date.now() - sent,
  };
  const dir = join(import.meta.dirname, "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `base-broadcast-${result.broadcast_at}.json`.replace(/:/g, "-"));
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`report: ${file}`);
}

/* ---------- Bitcoin ---------- */

type BtcInput = { txid: string; vout: number; value_sat: string };

function compressedKey(nearKey: string) {
  const raw = PublicKey.fromString(nearKey).data;
  const out = new Uint8Array(33);
  out[0] = raw[63] & 1 ? 3 : 2;
  out.set(raw.slice(0, 32), 1);
  return out;
}

/** Checks every sighash and signature of a signed spend with bitcoinjs-lib and noble. */
function checkBtcSpend(w: Withdrawal, inputs: BtcInput[], pubkey: Uint8Array) {
  const tx = bitcoin.Transaction.fromHex(w.signed_raw_tx as string);
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.testnet });
  const scriptCode = bitcoin.payments.p2pkh({ hash: p2wpkh.hash }).output as Uint8Array;
  const ok = inputs.every((input, i) => {
    const hash = tx.hashForWitnessV0(i, scriptCode, BigInt(input.value_sat), bitcoin.Transaction.SIGHASH_ALL);
    const [sig] = tx.ins[i].witness;
    return (
      Buffer.from(hash).toString("hex") === w.payload_hashes[i] &&
      secp256k1.verify(sig.subarray(0, -1), hash, pubkey, { prehash: false, format: "der", lowS: true })
    );
  });
  return { ok, vsize: tx.virtualSize(), txid: tx.getId() };
}

/** Sends withdraw_btc (optionally after break_seal in the same transaction) and waits for the record. */
async function withdrawBtc(owner: Account, tokenId: string, params: { inputs: BtcInput[]; to_address: string; amount_sat: string; fee_sat: string }, withBreak: boolean) {
  const n = params.inputs.length;
  const acts = [
    actions.functionCall("withdraw_btc", { token_id: tokenId, params }, BigInt(15 * n + 60) * TGAS, (WITHDRAW_DEPOSIT + ONE_YOCTO) * BigInt(n)),
  ];
  if (withBreak) acts.unshift(actions.functionCall("break_seal", { token_id: tokenId }, 30n * TGAS, ONE_YOCTO));
  const index = (await view<VaultView>(CONTRACT, "vault", { token_id: tokenId })).withdrawal_count;
  const sent = await submit(owner, CONTRACT, acts);
  let w: Withdrawal | undefined;
  for (let i = 0; i < 240; i++) {
    [w] = await view<Withdrawal[]>(CONTRACT, "withdrawals", { token_id: tokenId, from_index: index, limit: 1 });
    if (w && w.status !== "pending") break;
    await sleep(500);
  }
  const signedMs = Date.now() - sent.sent;
  const outcome = await finalOutcome(sent.hash, owner.accountId);
  return { w: w as Withdrawal, signedMs, tx: explorer(sent.hash), gas: gasReport(outcome) };
}

function saveReport(name: string, report: object) {
  const dir = join(import.meta.dirname, "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${new Date().toISOString()}.json`.replace(/:/g, "-"));
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`report: ${file}`);
}

/**
 * Spike 1, Bitcoin part: 1–4 sign requests joined with Promise::and into one callback, on the
 * real signer. The inputs are made up (the contract can't see UTXOs), so nothing is broadcast.
 */
async function btcJoined(tokenId: string) {
  const vault = await view<VaultView>(CONTRACT, "vault", { token_id: tokenId });
  if (vault.state.kind !== "opened" || !vault.keys || !vault.btc_address) throw new Error(`vault ${tokenId} must be opened, with keys`);
  const owner = account(vault.owner_id);
  const pubkey = compressedKey(vault.keys.btc);
  const runs = [];
  for (let n = 1; n <= 4; n++) {
    const inputs = Array.from({ length: n }, (_, i) => ({
      txid: createHash("sha256").update(`bearer-spike:${tokenId}:${n}:${i}`).digest("hex"),
      vout: i,
      value_sat: "20000",
    }));
    const params = { inputs, to_address: vault.btc_address, amount_sat: "10000", fee_sat: "500" };
    const r = await withdrawBtc(owner, tokenId, params, false);
    const check = r.w.signed_raw_tx ? checkBtcSpend(r.w, inputs, pubkey) : null;
    const callback = r.gas.receipts.filter((x) => x.executor === CONTRACT).at(-1);
    runs.push({ inputs: n, status: r.w.status, error: r.w.error, signed_visible_after_ms: r.signedMs, verified_with_bitcoinjs: check?.ok ?? false, vsize: check?.vsize, tx: r.tx, gas_total_tgas: r.gas.total_tgas, callback_tgas: callback?.tgas, receipts: r.gas.receipts });
    console.log(`${n} input(s): ${r.w.status} in ${r.signedMs} ms, ${r.gas.total_tgas} Tgas, callback ${callback?.tgas} Tgas, verified ${check?.ok}`);
  }
  saveReport("testnet-btc-joined", { measured_at: new Date().toISOString(), contract: CONTRACT, token_id: tokenId, signer_version: await view<string>(SIGNER, "version", {}), runs });
}

/** Alice creates a vault to fund with testnet4 BTC; prints its address. */
async function btcVault() {
  const alice = account(ALICE);
  const sent = await submit(alice, CONTRACT, [
    actions.functionCall("create_vault", { name: "Bitcoin spike", finish: "champagne" }, 60n * TGAS, CREATE_DEPOSIT),
  ]);
  const o = await finalOutcome(sent.hash, ALICE);
  const id = JSON.parse(Buffer.from(o.status.SuccessValue ?? "", "base64").toString());
  let v = await view<VaultView>(CONTRACT, "vault", { token_id: id });
  for (let i = 0; !v.btc_address && i < 40; i++) {
    await sleep(500);
    v = await view<VaultView>(CONTRACT, "vault", { token_id: id });
  }
  console.log(JSON.stringify({ token_id: id, owner: v.owner_id, btc_address: v.btc_address, tx: explorer(sent.hash) }, null, 2));
}

/**
 * The full Bitcoin story on testnet4: alice hands the funded vault to bob, bob breaks the seal
 * and withdraws in one NEAR transaction, then the signed spend is broadcast via mempool.space.
 * BTC_TO sets the destination (default: the vault's own address, a self-transfer).
 */
async function btcWithdraw(tokenId: string) {
  let vault = await view<VaultView>(CONTRACT, "vault", { token_id: tokenId });
  if (!vault.keys || !vault.btc_address) throw new Error("keys pending");
  const address = vault.btc_address;
  const pubkey = compressedKey(vault.keys.btc);
  const report: Record<string, unknown> = { measured_at: new Date().toISOString(), contract: CONTRACT, token_id: tokenId, btc_address: address };
  if (vault.owner_id === ALICE && vault.state.kind === "sealed") {
    const moved = await submit(account(ALICE), CONTRACT, [
      actions.functionCall("nft_transfer", { receiver_id: BOB, token_id: tokenId }, 30n * TGAS, ONE_YOCTO),
    ]);
    await finalOutcome(moved.hash, ALICE);
    report.nft_transfer = explorer(moved.hash);
    vault = await view<VaultView>(CONTRACT, "vault", { token_id: tokenId });
  }
  const utxos = (await (await fetch(`${ESPLORA}/address/${address}/utxo`)).json()) as {
    txid: string;
    vout: number;
    value: number;
    status: { confirmed: boolean };
  }[];
  const max = (await view<{ max_btc_inputs: number }>(CONTRACT, "get_config", {})).max_btc_inputs;
  const spendable = utxos.filter((u) => u.status.confirmed).slice(0, max);
  if (!spendable.length) throw new Error(`no confirmed coins at ${address} yet (${utxos.length} unconfirmed)`);
  const total = spendable.reduce((s, u) => s + u.value, 0);
  // Esplora fee estimates: target blocks → sat/vB. Take the fastest target offered, at least 2.
  const estimates = (await (await fetch(`${ESPLORA}/fee-estimates`)).json()) as Record<string, number>;
  const fastest = Object.entries(estimates).sort(([a], [b]) => Number(a) - Number(b))[0]?.[1] ?? 0;
  const rate = Math.max(2, Math.ceil(fastest));
  const vbytes = 11 + 68 * spendable.length + 31 * 2;
  const fee = Math.ceil(rate * vbytes);
  const amount = Math.floor((total - fee) / 2);
  const inputs = spendable.map((u) => ({ txid: u.txid, vout: u.vout, value_sat: String(u.value) }));
  const params = { inputs, to_address: process.env.BTC_TO ?? address, amount_sat: String(amount), fee_sat: String(fee) };
  Object.assign(report, { params, fee_rate_sat_vb: rate });

  const r = await withdrawBtc(account(vault.owner_id), tokenId, params, vault.state.kind === "sealed");
  const check = r.w.signed_raw_tx ? checkBtcSpend(r.w, inputs, pubkey) : null;
  Object.assign(report, { status: r.w.status, error: r.w.error, near_tx: r.tx, signed_visible_after_ms: r.signedMs, gas: r.gas, verified_with_bitcoinjs: check?.ok, vsize: check?.vsize });
  if (r.w.signed_raw_tx && check?.ok) {
    const res = await fetch(`${ESPLORA}/tx`, { method: "POST", body: r.w.signed_raw_tx });
    const body = await res.text();
    Object.assign(report, {
      broadcast_status: res.status,
      broadcast_response: body,
      txid: check.txid,
      explorer: `https://mempool.space/testnet4/tx/${check.txid}`,
      explorer_alt: `https://blockstream.info/testnet4/tx/${check.txid}`,
    });
  }
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-btc-withdraw", report);
}

/* ---------- Solana ---------- */

async function solRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result as T;
}

/**
 * Signs a devnet transfer from an opened vault with the MPC's Ed25519 domain. If the vault holds
 * SOL (or a devnet airdrop works) it broadcasts and waits for confirmation; otherwise devnet
 * simulates it with signature checks, which is enough to prove the signature and encoding.
 */
async function solWithdraw(tokenId: string) {
  const vault = await view<VaultView>(CONTRACT, "vault", { token_id: tokenId });
  if (vault.state.kind !== "opened" || !vault.sol_address) throw new Error(`vault ${tokenId} must be opened, with keys`);
  const address = vault.sol_address;
  const report: Record<string, unknown> = { measured_at: new Date().toISOString(), contract: CONTRACT, token_id: tokenId, sol_address: address, rpc: SOL_RPC };

  let balance = (await solRpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }])).value;
  if (balance < 10_000_000 && !process.env.NO_AIRDROP) {
    try {
      const sig = await solRpc<string>("requestAirdrop", [address, 1_000_000_000]);
      for (let i = 0; i < 40 && balance < 10_000_000; i++) {
        await sleep(1500);
        balance = (await solRpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }])).value;
      }
      report.airdrop = { signature: sig, balance_after: balance };
    } catch (e) {
      report.airdrop = { error: String(e).slice(0, 300) };
    }
  }
  report.balance_lamports = balance;

  // A self-transfer: proves the whole path without needing a second funded account.
  const { value } = await solRpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "finalized" }]);
  const params = { recent_blockhash: value.blockhash, to: address, lamports: "1000" };
  const index = vault.withdrawal_count;
  const owner = account(vault.owner_id);
  const sent = await submit(owner, CONTRACT, [
    actions.functionCall("withdraw_sol", { token_id: tokenId, params }, 60n * TGAS, WITHDRAW_DEPOSIT + ONE_YOCTO),
  ]);
  let w: Withdrawal | undefined;
  for (let i = 0; i < 240; i++) {
    [w] = await view<Withdrawal[]>(CONTRACT, "withdrawals", { token_id: tokenId, from_index: index, limit: 1 });
    if (w && w.status !== "pending") break;
    await sleep(500);
  }
  const signedMs = Date.now() - sent.sent;
  const outcome = await finalOutcome(sent.hash, owner.accountId);
  Object.assign(report, { params, status: w?.status, error: w?.error, near_tx: explorer(sent.hash), signed_visible_after_ms: signedMs, gas: gasReport(outcome) });
  if (!w?.signed_raw_tx) {
    console.log(JSON.stringify(report, null, 2));
    saveReport("testnet-sol-withdraw", report);
    return;
  }

  const raw = Buffer.from(w.signed_raw_tx, "hex");
  const tx = SolTransaction.from(raw);
  report.verified_with_web3js = tx.verifySignatures() && tx.feePayer?.toBase58() === address && tx.instructions.length === 1;
  const b64 = raw.toString("base64");
  if (balance >= 10_000_000) {
    const sig = await solRpc<string>("sendTransaction", [b64, { encoding: "base64" }]);
    let status: { confirmationStatus?: string; err?: unknown } | null = null;
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      [status] = (await solRpc<{ value: ({ confirmationStatus: string; err: unknown } | null)[] }>("getSignatureStatuses", [[sig]])).value;
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") break;
      await sleep(1000);
    }
    Object.assign(report, { broadcast: { signature: sig, status, confirmed_after_ms: Date.now() - t0, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` } });
  } else {
    report.simulation = await solRpc("simulateTransaction", [b64, { encoding: "base64", sigVerify: true }]);
  }
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-sol-withdraw", report);
}

/* ---------- lock (cannot be undone) ---------- */

function base58(buf: Buffer) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${buf.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

/**
 * Deletes every access key on the contract account, so nobody can ever change or redeploy its
 * code (brief 4.10, T11). Refuses unless the deployed code is exactly BEARER_WASM and
 * CONFIRM_LOCK names the contract. There is no way back: a bug after this means a new account.
 */
async function lock() {
  if (process.env.CONFIRM_LOCK !== CONTRACT) {
    throw new Error(`Locking ${CONTRACT} can't be undone. Run again with CONFIRM_LOCK=${CONTRACT}.`);
  }
  const expected = base58(createHash("sha256").update(readFileSync(WASM)).digest());
  const { code_hash } = await viewAccount(CONTRACT);
  if (code_hash !== expected) throw new Error(`${CONTRACT} runs ${code_hash}, not ${WASM} (${expected}); refusing to lock`);

  type Keys = { keys: { public_key: string; access_key: { permission: unknown } }[] };
  const keyList = () => rpc<Keys>("query", { request_type: "view_access_key_list", finality: "final", account_id: CONTRACT });
  const { keys } = await keyList();
  if (!keys.length) {
    console.log(`${CONTRACT} is already locked`);
    return;
  }
  const own = (JSON.parse(readFileSync(join(CREDS, `${CONTRACT}.json`), "utf8")) as { public_key: string }).public_key;
  // Every other key first, then the one signing this transaction.
  const ordered = [...keys.filter((k) => k.public_key !== own), ...keys.filter((k) => k.public_key === own)];
  const r = (await account(CONTRACT).signAndSendTransaction({
    receiverId: CONTRACT,
    actions: ordered.map((k) => actions.deleteKey(PublicKey.fromString(k.public_key))),
    waitUntil: "FINAL",
  })) as unknown as Outcome;

  const after = await keyList();
  const report = {
    measured_at: new Date().toISOString(),
    contract: CONTRACT,
    code_hash,
    wasm: WASM,
    deleted_keys: ordered.map((k) => ({ public_key: k.public_key, full_access: k.access_key.permission === "FullAccess" })),
    tx: explorer(r.transaction.hash),
    keys_after: after.keys.length,
  };
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-lock", report);
  if (after.keys.length) throw new Error(`${CONTRACT} still has ${after.keys.length} key(s)`);
}

const cmd = process.argv[2];
if (cmd === "setup") await setup();
else if (cmd === "run") await run();
else if (cmd === "redeploy") await redeploy();
else if (cmd === "gas-floor") await gasFloor();
else if (cmd === "broadcast") await broadcast(process.argv[3] ?? "", Number(process.argv[4] ?? 0));
else if (cmd === "btc-joined") await btcJoined(process.argv[3] ?? "");
else if (cmd === "btc-vault") await btcVault();
else if (cmd === "btc-withdraw") await btcWithdraw(process.argv[3] ?? "");
else if (cmd === "sol-withdraw") await solWithdraw(process.argv[3] ?? "");
else if (cmd === "lock") await lock();
else {
  console.log("usage: node spike/testnet-sign.ts setup|run|redeploy|gas-floor|broadcast|btc-joined|btc-vault|btc-withdraw|sol-withdraw|lock");
  process.exitCode = 1;
}
