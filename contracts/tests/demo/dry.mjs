/**
 * pnpm demo:dry — Bearer's six-step story for a judge with no funds (brief 6.4, 8.1).
 *
 * The NEAR side is real: a local sandbox running the committed contract and a mock MPC signer.
 * The three chains are SIMULATED ledgers that really apply each signed transaction: they check
 * the signature, spend coins or nonces, and refuse anything spent twice. Every line they print
 * starts with SIMULATED. Plain JavaScript, so it runs on Node 20 with nothing else installed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { SystemInstruction, Transaction as SolTransaction } from "@solana/web3.js";
import * as bitcoin from "bitcoinjs-lib";
import { Account, PublicKey, actions } from "near-api-js";
import { DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, Sandbox } from "near-sandbox";
import { parseTransaction, recoverTransactionAddress } from "viem";

const ROOT = join(import.meta.dirname, "..", "..");
const wasm = (name) => {
  for (const dir of ["res", "out"]) {
    const p = join(ROOT, dir, name);
    if (existsSync(p)) return readFileSync(p);
  }
  throw new Error(`${name} not found in contracts/res or contracts/out`);
};

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const CREATE = 5n * 10n ** 22n;
const WITHDRAW = 10n ** 22n;

/* ---------- output ---------- */

const tty = process.stdout.isTTY;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const gold = c("33");
const green = c("32");
const red = c("31");
const dim = c("2");
const bold = c("1");

let passed = 0;
let failed = 0;
let stepNo = 0;
const step = (title, caption) => {
  stepNo += 1;
  console.log(`\n${gold(`${stepNo} ·`)} ${bold(title)}${caption ? dim(`  ${caption}`) : ""}`);
};
const check = (ok, text) => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? green("✓") : red("✗")} ${text}`);
};
const sim = (text) => console.log(`  ${dim(`SIMULATED ${text}`)}`);

async function rejects(promise, code, text) {
  try {
    await promise;
    check(false, `${text}: accepted (should never happen)`);
  } catch (e) {
    const msg = `${e} ${JSON.stringify(e, Object.getOwnPropertyNames(e))}`;
    check(msg.includes(code), `${text} → rejected with ${code}`);
  }
}

/* ---------- simulated chains ---------- */

const btcLedger = new Map(); // "txid:vout" → { address, value }
const evmLedger = new Map(); // address → { balance, nonce }
const solLedger = new Map(); // address → lamports
const solSeen = new Set();

function btcFund(address, value) {
  const txid = createHash("sha256").update(`fund:${address}:${value}:${btcLedger.size}`).digest("hex");
  btcLedger.set(`${txid}:0`, { address, value });
  sim(`Bitcoin: ${value} sats arrive at ${address}`);
  return { txid, vout: 0, value_sat: String(value) };
}

/** Applies a signed Bitcoin spend: every input must exist, be the vault's, and be unspent. */
function btcApply(rawHex, vaultAddress, pubkey) {
  const tx = bitcoin.Transaction.fromHex(rawHex);
  const pkh = bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.testnet });
  const scriptCode = bitcoin.payments.p2pkh({ hash: pkh.hash }).output;
  for (const [i, input] of tx.ins.entries()) {
    const key = `${Buffer.from(input.hash).reverse().toString("hex")}:${input.index}`;
    const coin = btcLedger.get(key);
    if (!coin) return { ok: false, why: `input ${key.slice(0, 12)}… is already spent` };
    const hash = tx.hashForWitnessV0(i, scriptCode, BigInt(coin.value), bitcoin.Transaction.SIGHASH_ALL);
    const [sig] = input.witness;
    if (coin.address !== vaultAddress || !secp256k1.verify(sig.subarray(0, -1), hash, pubkey, { prehash: false, format: "der", lowS: true })) {
      return { ok: false, why: "bad signature" };
    }
  }
  const txid = tx.getId();
  for (const input of tx.ins) btcLedger.delete(`${Buffer.from(input.hash).reverse().toString("hex")}:${input.index}`);
  tx.outs.forEach((o, i) => {
    const address = bitcoin.address.fromOutputScript(o.script, bitcoin.networks.testnet);
    btcLedger.set(`${txid}:${i}`, { address, value: Number(o.value) });
  });
  return { ok: true, txid };
}
const btcBalance = (address) => [...btcLedger.values()].filter((c) => c.address === address).reduce((s, c) => s + c.value, 0);

/** Applies a signed EIP-1559 transfer: sender recovered from the signature, nonce must be next. */
async function evmApply(rawHex) {
  const raw = `0x${rawHex}`;
  const tx = parseTransaction(raw);
  const from = (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase();
  const acct = evmLedger.get(from) ?? { balance: 0n, nonce: 0 };
  if (tx.nonce !== acct.nonce) return { ok: false, why: `nonce ${tx.nonce} already used` };
  const cost = tx.value + tx.gas * tx.maxFeePerGas;
  if (acct.balance < cost) return { ok: false, why: "insufficient funds" };
  acct.balance -= cost;
  acct.nonce += 1;
  evmLedger.set(from, acct);
  const to = tx.to.toLowerCase();
  const dest = evmLedger.get(to) ?? { balance: 0n, nonce: 0 };
  dest.balance += tx.value;
  evmLedger.set(to, dest);
  return { ok: true, from };
}

/** Applies a signed Solana transfer: signature valid, exactly one transfer, never replayed. */
function solApply(rawHex) {
  const tx = SolTransaction.from(Buffer.from(rawHex, "hex"));
  if (!tx.verifySignatures()) return { ok: false, why: "bad signature" };
  const sig = Buffer.from(tx.signature).toString("hex");
  if (solSeen.has(sig)) return { ok: false, why: "already processed" };
  const t = SystemInstruction.decodeTransfer(tx.instructions[0]);
  const from = t.fromPubkey.toBase58();
  const need = BigInt(t.lamports) + 5000n;
  if ((solLedger.get(from) ?? 0n) < need) return { ok: false, why: "insufficient funds" };
  solSeen.add(sig);
  solLedger.set(from, solLedger.get(from) - need);
  solLedger.set(t.toPubkey.toBase58(), (solLedger.get(t.toPubkey.toBase58()) ?? 0n) + BigInt(t.lamports));
  return { ok: true };
}

/* ---------- the story ---------- */

console.log(bold("\nBearer · dry run"));
console.log(dim("A real NEAR sandbox and contract; the three chains are SIMULATED ledgers that apply each signed transaction.\n"));

const sandbox = await Sandbox.start({});
try {
  const root = new Account("sandbox", sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  const sub = async (prefix, near) => {
    await root.createSubAccount({ accountOrPrefix: prefix, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: near * NEAR });
    return new Account(`${prefix}.sandbox`, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
  };
  const [signer, bearer, alice, bob, eve] = await Promise.all([sub("signer", 20n), sub("bearer", 50n), sub("alice", 20n), sub("bob", 20n), sub("eve", 20n)]);
  await signer.deployContract(wasm("mock_signer.wasm"));
  await signer.callFunction({ contractId: signer.accountId, methodName: "new", args: { seed: "demo" } });
  await bearer.deployContract(wasm("bearer.wasm"));
  await bearer.callFunction({
    contractId: bearer.accountId,
    methodName: "new",
    args: {
      signer_id: signer.accountId,
      config: { evm_chain_ids: [84532], max_btc_inputs: 4, create_deposit: CREATE.toString(), withdraw_deposit: WITHDRAW.toString(), mpc_sign_deposit: "1" },
    },
  });
  console.log(dim(`NEAR sandbox at ${sandbox.rpcUrl} · contract ${bearer.accountId} · mock MPC signer ${signer.accountId}`));

  const view = (method, args) => root.provider.callFunction({ contractId: bearer.accountId, method, args });
  const vault = (id) => view("vault", { token_id: id });
  const call = (who, methodName, args, deposit = 0n, gas = 100n * TGAS) =>
    who.callFunction({ contractId: bearer.accountId, methodName, args, deposit, gas });
  const createVault = async (who, name) => {
    const id = await call(who, "create_vault", { name, finish: "champagne" }, CREATE);
    for (let i = 0; i < 20 && !(await vault(id)).keys; i++) await new Promise((r) => setTimeout(r, 300));
    return id;
  };

  /* 1 */
  step("Alice creates a vault", "a vault: three native addresses, one seal");
  const id = await createVault(alice, "Theo's birthday");
  let v = await vault(id);
  console.log(dim(`  Bitcoin ${v.btc_address}\n  Base    ${v.evm_address}\n  Solana  ${v.sol_address}`));
  check(v.state.kind === "sealed" && v.signatures_requested === 0, "sealed, 0 signatures ever requested");
  check(!!v.keys && !!v.btc_address && !!v.evm_address && !!v.sol_address, "the signer's derived keys and all three addresses are stored");

  /* 2 */
  step("Deposits arrive on three chains");
  const raw = PublicKey.fromString(v.keys.btc).data;
  const pubkey = new Uint8Array([raw[63] & 1 ? 3 : 2, ...raw.slice(0, 32)]);
  const coin = btcFund(v.btc_address, 50_000);
  evmLedger.set(v.evm_address, { balance: 10n ** 16n, nonce: 0 });
  sim(`Base: 0.01 ETH arrives at ${v.evm_address}`);
  solLedger.set(v.sol_address, 50_000_000n);
  sim(`Solana: 0.05 SOL arrives at ${v.sol_address}`);
  check(btcBalance(v.btc_address) === 50_000, "the vault's addresses hold coins; the contract never sees balances");

  /* 3 */
  step("Alice hands it to Bob", "one NEAR transaction; nothing moves on Bitcoin, Base or Solana");
  const before = JSON.stringify([...btcLedger, ...evmLedger, ...solLedger], (_, x) => (typeof x === "bigint" ? String(x) : x));
  await call(alice, "nft_transfer", { receiver_id: bob.accountId, token_id: id }, 1n, 30n * TGAS);
  v = await vault(id);
  check(v.owner_id === bob.accountId && v.state.kind === "sealed", "Bob holds it, still sealed");
  check(v.custody.map((x) => x.account_id).join(" → ") === `${alice.accountId} → ${bob.accountId}`, "the custody log records Alice, then Bob");
  check(JSON.stringify([...btcLedger, ...evmLedger, ...solLedger], (_, x) => (typeof x === "bigint" ? String(x) : x)) === before, "not one coin moved on any chain");

  /* 4 */
  step("Alice tries to get back in", "the old owner can't touch it");
  const btcParams = (inputs, amount, fee) => ({ inputs, to_address: v.btc_address, amount_sat: String(amount), fee_sat: String(fee) });
  await rejects(call(alice, "withdraw_btc", { token_id: id, params: btcParams([coin], 30_000, 500) }, WITHDRAW + 1n, 120n * TGAS), "ERR_NOT_OWNER", "Alice withdraws Bitcoin");
  await rejects(call(alice, "break_seal", { token_id: id }, 1n, 30n * TGAS), "ERR_NOT_OWNER", "Alice breaks the seal");
  await rejects(call(bob, "withdraw_btc", { token_id: id, params: btcParams([coin], 30_000, 500) }, WITHDRAW + 1n, 120n * TGAS), "ERR_VAULT_SEALED", "even Bob can't withdraw without breaking the seal");
  check((await vault(id)).signatures_requested === 0, "still 0 signatures ever requested");

  /* 5 */
  step("Bob breaks the seal and withdraws", "breaking the seal is one-way");
  const bobBtc = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
  await bob.signAndSendTransaction({
    receiverId: bearer.accountId,
    actions: [
      actions.functionCall("break_seal", { token_id: id }, 30n * TGAS, 1n),
      actions.functionCall("withdraw_btc", { token_id: id, params: { ...btcParams([coin], 30_000, 500), to_address: bobBtc } }, 120n * TGAS, WITHDRAW + 1n),
    ],
    waitUntil: "FINAL",
  });
  v = await vault(id);
  check(v.state.kind === "opened", "opened, in the same NEAR transaction as the withdrawal");
  let [w] = await view("withdrawals", { token_id: id, from_index: 0, limit: 1 });
  check(w.status === "signed", "NEAR's MPC network signed the Bitcoin spend; the contract checked it");
  let applied = btcApply(w.signed_raw_tx, v.btc_address, pubkey);
  check(applied.ok, `Bitcoin accepts it: 30,000 sats to Bob, 19,500 change back to the vault`);
  sim(`Bitcoin: ${applied.txid ?? applied.why}`);
  check(btcBalance(bobBtc) === 30_000 && btcBalance(v.btc_address) === 19_500, "balances moved exactly as signed");

  await call(bob, "withdraw_evm", {
    token_id: id,
    params: { chain_id: "84532", nonce: "0", to: "0x3fa2b1c47d9e0f5a6b8c2d4e6f80a1b3c519cd00", amount_wei: "5000000000000000", gas_limit: "21000", max_fee_per_gas: "2000000000", max_priority_fee_per_gas: "1000000" },
  }, WITHDRAW + 1n, 100n * TGAS);
  [, w] = await view("withdrawals", { token_id: id, from_index: 0, limit: 2 });
  applied = await evmApply(w.signed_raw_tx);
  check(applied.ok && applied.from === v.evm_address, "Base accepts a transfer signed by the vault's own address");

  const { Keypair } = await import("@solana/web3.js");
  const bobSol = Keypair.generate().publicKey.toBase58();
  await call(bob, "withdraw_sol", { token_id: id, params: { recent_blockhash: "3SPUWvuNQALMPKUaABs4CjQ3X8H8TfRWcb8gcXd7nUoE", to: bobSol, lamports: "20000000" } }, WITHDRAW + 1n, 100n * TGAS);
  [, , w] = await view("withdrawals", { token_id: id, from_index: 0, limit: 3 });
  applied = solApply(w.signed_raw_tx);
  check(applied.ok && solLedger.get(bobSol) === 20_000_000n, "Solana accepts one transfer, signed by the vault's Ed25519 key");

  /* 6 */
  step("Nobody can pass on an opened vault", "so there's never a signature to keep in a drawer");
  await rejects(call(bob, "nft_transfer", { receiver_id: eve.accountId, token_id: id }, 1n, 30n * TGAS), "ERR_VAULT_OPENED", "Bob transfers the opened vault");
  await rejects(call(eve, "sign", { request: { path: "x", payload_v2: { Ecdsa: "00".repeat(32) }, domain_id: 0 } }, 1n, 30n * TGAS), "MethodNotFound", "anyone asks the contract to sign arbitrary bytes");
  const sealed = await createVault(eve, "Eve's own");
  await rejects(call(eve, "withdraw_evm", { token_id: sealed, params: { chain_id: "84532", nonce: "0", to: "0x3fa2b1c47d9e0f5a6b8c2d4e6f80a1b3c519cd00", amount_wei: "1", gas_limit: "21000", max_fee_per_gas: "1", max_priority_fee_per_gas: "1" } }, WITHDRAW + 1n, 100n * TGAS), "ERR_VAULT_SEALED", "a sealed vault asks for a signature");

  /* T10 */
  step("Retries are safe", "two signatures for the same coins: at most one lands (T10)");
  const second = btcFund(v.btc_address, 20_000);
  for (let i = 0; i < 2; i++) {
    await call(bob, "withdraw_btc", { token_id: id, params: { ...btcParams([second], 10_000, 400 + i * 100), to_address: bobBtc } }, WITHDRAW + 1n, 120n * TGAS);
  }
  const ws = await view("withdrawals", { token_id: id, from_index: 3, limit: 2 });
  check(ws.length === 2 && ws.every((x) => x.status === "signed"), "both requests were signed (a retry at a higher fee)");
  const first = btcApply(ws[1].signed_raw_tx, v.btc_address, pubkey);
  const retry = btcApply(ws[0].signed_raw_tx, v.btc_address, pubkey);
  sim(`Bitcoin: first ${first.ok ? "confirms" : first.why}; the other: ${retry.ok ? "confirms" : retry.why}`);
  check(first.ok && !retry.ok, "only one spends the coin, and both pay Bob");
  const evmRetry = await evmApply((await view("withdrawals", { token_id: id, from_index: 1, limit: 1 }))[0].signed_raw_tx);
  check(!evmRetry.ok, `re-sending the Base transfer fails: ${evmRetry.why}`);
} finally {
  await sandbox.tearDown();
}

const total = passed + failed;
console.log(`\n${failed ? red(`✗ ${failed} of ${total} checks failed`) : green(`✓ ${passed}/${total} checks passed`)}\n`);
process.exitCode = failed ? 1 : 0;
