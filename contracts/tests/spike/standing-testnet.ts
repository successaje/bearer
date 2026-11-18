/**
 * Standing payments on NEAR testnet, against the locked Bearer contract (bearer.testnet), with
 * real Bitcoin testnet4 payments.
 *
 *   node spike/standing-testnet.ts setup            # deploy STANDING_WASM and initialise
 *   node spike/standing-testnet.ts vault            # alice. creates a sealed vault
 *   node spike/standing-testnet.ts fund-evm <id> <wei>   # bob. pays Base Sepolia ETH into it from his opened vault FUNDER (No. 0001)
 *   node spike/standing-testnet.ts plan <id> evm|btc     # alice. plans it, payee bob.: every 2 minutes, 3 payments, back to FUNDER's (evm) or the treasury's (btc) address
 *   node spike/standing-testnet.ts collect <id>     # bob. collects what's due, then broadcasts the signed payment
 *   node spike/standing-testnet.ts refusals <id>    # the refusals that must hold on testnet
 *   node spike/standing-testnet.ts stop <id>        # alice. stops the payments
 *   CONFIRM_LOCK=<standing> node spike/standing-testnet.ts lock   # delete every key; only if the code is STANDING_WASM
 *
 * Keys come from ~/.near-credentials/testnet, never the repo. Every number in the report is
 * measured on testnet; nothing is estimated.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { Account, PublicKey, actions } from "near-api-js";

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const PARENT = process.env.BEARER_TESTNET_PARENT;
if (!PARENT) throw new Error("Set BEARER_TESTNET_PARENT to the faucet-created parent of the test accounts.");
const BEARER = process.env.BEARER_CONTRACT_ID ?? "bearer.testnet";
const STANDING = process.env.STANDING_CONTRACT_ID ?? "bearer-standing.testnet";
const ALICE = `alice.${PARENT}`;
const BOB = `bob.${PARENT}`;
/** Vault No. 0011, the links treasury: payments go back to it, so no testnet coins are lost. */
const TREASURY = process.env.STANDING_PAY_TO_VAULT ?? "11";
/** Vault No. 0001, opened and held by bob.: funds the Base Sepolia run and gets its payments back. */
const FUNDER = process.env.STANDING_FUNDER_VAULT ?? "1";
const BASE_RPC = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const BASE_SEPOLIA = 84532;
const STANDING_WASM = process.env.STANDING_WASM ?? join(import.meta.dirname, "..", "..", "res", "standing.wasm");
const ESPLORA = process.env.ESPLORA_API ?? "https://blockstream.info/testnet4/api";
const CREDS = join(homedir(), ".near-credentials", "testnet");

const MILLI = 10n ** 21n;
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const PLAN_DEPOSIT = 10n * MILLI;
const CREATE_DEPOSIT = 50n * MILLI;
const WITHDRAW_DEPOSIT = 10n * MILLI;
const SECOND = 1_000_000_000n;
const AMOUNT_SAT = 10_000;
const MAX_FEE_SAT = 1_000;
/** 0.00005 ETH a payment; fee at most 21,000 gas at 0.05 gwei. */
const AMOUNT_WEI = 50_000_000_000_000n;
const GAS_LIMIT = 21_000n;
const MAX_FEE_WEI = GAS_LIMIT * 50_000_000n;
const PRIORITY_WEI = 1_000_000n;
const INTERVAL = 120n * SECOND;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

function account(id: string) {
  const { private_key } = JSON.parse(readFileSync(join(CREDS, `${id}.json`), "utf8"));
  return new Account(id, RPC, private_key);
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const body = await res.json();
    const err = body.error ?? body.result?.error;
    if (err && attempt < 20 && /TIMEOUT|UNKNOWN_TRANSACTION|timeout/i.test(JSON.stringify(err))) {
      await sleep(1500);
      continue;
    }
    if (err) throw new Error(`${method}: ${JSON.stringify(err).slice(0, 400)}`);
    return body.result as T;
  }
}

async function view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

const viewAccount = (id: string) =>
  rpc<{ amount: string; code_hash: string }>("query", { request_type: "view_account", finality: "final", account_id: id });

type Outcome = {
  transaction: { hash: string };
  status: { SuccessValue?: string; Failure?: unknown };
  transaction_outcome: { outcome: { gas_burnt: number } };
  receipts_outcome: { outcome: { executor_id: string; gas_burnt: number; status: Record<string, unknown>; logs: string[] } }[];
};

const steps: Record<string, unknown>[] = [];

/** Signs here and sends with send_tx, so a refusal comes back as an outcome, not a thrown error. */
async function tx(who: Account, receiverId: string, method: string, args: object, deposit: bigint, label: string, expect: string | null = null, gas = 150n * TGAS) {
  const signed = await who.createSignedTransaction({ receiverId, actions: [actions.functionCall(method, args, gas, deposit)] });
  const r = await rpc<Outcome>("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "FINAL" });
  const failures = [r.status.Failure, ...r.receipts_outcome.map((x) => x.outcome.status.Failure)].filter(Boolean);
  const text = JSON.stringify(failures);
  const code = failures.length ? (text.match(/ERR_[A-Z_]+/)?.[0] ?? text.match(/[A-Za-z]+Error/)?.[0] ?? "failed") : null;
  const events = r.receipts_outcome
    .flatMap((x) => x.outcome.logs)
    .filter((l) => l.startsWith("EVENT_JSON:"))
    .map((l) => JSON.parse(l.slice(11)))
    .map((e) => `${e.standard}:${e.event}`);
  const tgas = (r.transaction_outcome.outcome.gas_burnt + r.receipts_outcome.reduce((s, x) => s + x.outcome.gas_burnt, 0)) / 1e12;
  const step = { step: label, by: who.accountId, call: `${receiverId}.${method}`, tx: explorer(r.transaction.hash), tgas: Math.round(tgas * 1000) / 1000, refused: code, events };
  steps.push(step);
  console.log(`${label}: ${code ? `refused, ${code}` : "ok"} · ${step.tgas} Tgas · ${events.join(", ") || "no events"} · ${step.tx}`);
  if (expect !== null ? code !== expect : code) throw new Error(`${label}: expected ${expect ?? "success"}, got ${code ?? "success"}`);
  return r;
}

type Vault = { token_id: string; owner_id: string; state: { kind: string; by?: string }; btc_address: string | null; evm_address: string | null; withdrawal_count: number };
type Plan = { payee: string; chain: "btc" | "evm" | "sol"; to: string; amount: string; max_fee: string; payments: number; withdrawals: number; opened: boolean; stopped_at_ns: string | null; state: { kind: string } };
type Withdrawal = { index: number; status: string; signed_raw_tx: string | null; error: string | null };
const vault = (id: string) => view<Vault>(BEARER, "vault", { token_id: id });
const plan = (id: string) => view<Plan | null>(STANDING, "plan", { token_id: id });

/* ---------- Bitcoin testnet4 ---------- */

type Utxo = { txid: string; vout: number; value: number; status: { confirmed: boolean } };

async function esplora<T>(path: string): Promise<T> {
  const res = await fetch(`${ESPLORA}${path}`);
  if (!res.ok) throw new Error(`${new URL(ESPLORA).host} answered HTTP ${res.status} for ${path}`);
  return (await res.json()) as T;
}

async function feeRate() {
  const estimates = await esplora<Record<string, number>>("/fee-estimates");
  const fastest = Object.entries(estimates).sort(([a], [b]) => Number(a) - Number(b))[0]?.[1] ?? 0;
  return Math.max(2, Math.ceil(fastest));
}

async function broadcast(raw: string) {
  const res = await fetch(`${ESPLORA}/tx`, { method: "POST", body: raw });
  const txid = (await res.text()).trim();
  if (!res.ok) throw new Error(`broadcast refused: ${txid.slice(0, 200)}`);
  return txid;
}

/* ---------- Base Sepolia ---------- */

async function eth<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(BASE_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((x) => x.json());
  if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error).slice(0, 300)}`);
  return r.result as T;
}

const ethBalance = async (address: string) => BigInt(await eth<string>("eth_getBalance", [address, "latest"]));
const ethNonce = async (address: string) => BigInt(await eth<string>("eth_getTransactionCount", [address, "pending"]));

/** EIP-1559 fees for a plain transfer, never over `cap` in all. */
async function ethFees(cap: bigint) {
  const block = await eth<{ baseFeePerGas: string }>("eth_getBlockByNumber", ["latest", false]);
  const wanted = 2n * BigInt(block.baseFeePerGas) + PRIORITY_WEI;
  const max = cap / GAS_LIMIT;
  return { max_fee_per_gas: wanted < max ? wanted : max, max_priority_fee_per_gas: PRIORITY_WEI };
}

async function ethBroadcast(raw: string) {
  const hash = await eth<string>("eth_sendRawTransaction", [`0x${raw}`]);
  for (let i = 0; i < 60; i++) {
    const r = await eth<{ status: string } | null>("eth_getTransactionReceipt", [hash]);
    if (r) {
      if (r.status !== "0x1") throw new Error(`${hash} reverted`);
      return hash;
    }
    await sleep(2000);
  }
  throw new Error(`${hash} didn't confirm in two minutes`);
}

/* ---------- helpers ---------- */

const codeHashOf = (wasm: Buffer) => base58(createHash("sha256").update(wasm).digest());
function base58(buf: Buffer) {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${buf.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = A[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function saveReport(name: string, data: unknown) {
  const dir = join(import.meta.dirname, "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${new Date().toISOString().replace(/[:]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`report: ${file}`);
}

async function settled(id: string) {
  for (let i = 0; i < 60; i++) {
    const p = await plan(id);
    if (p?.state.kind === "waiting" || p?.state.kind === "unsettled") return p;
    await sleep(1000);
  }
  return plan(id);
}

/* ---------- commands ---------- */

async function setup() {
  const wasm = readFileSync(STANDING_WASM);
  const s = account(STANDING);
  if ((await viewAccount(STANDING)).code_hash !== codeHashOf(wasm)) await s.deployContract(wasm);
  let hash = "";
  for (let i = 0; i < 20 && hash !== codeHashOf(wasm); i++) {
    if (i) await sleep(1000);
    hash = (await viewAccount(STANDING)).code_hash;
  }
  try {
    await view(STANDING, "get_config");
    console.log("already initialised");
  } catch {
    await tx(s, STANDING, "new", { nft_contract: BEARER, plan_deposit: PLAN_DEPOSIT.toString() }, 0n, "initialise");
  }
  console.log(`${STANDING}: code ${hash} (${hash === codeHashOf(wasm) ? "matches" : "DIFFERS from"} ${relative(join(import.meta.dirname, "..", "..", ".."), STANDING_WASM)})`);
  console.log(JSON.stringify(await view(STANDING, "get_config")));
}

async function newVault() {
  const alice = account(ALICE);
  const r = await tx(alice, BEARER, "create_vault", { name: "Standing payment", finish: "sage" }, CREATE_DEPOSIT, "alice creates a vault");
  const id = JSON.parse(Buffer.from(r.status.SuccessValue as string, "base64").toString()) as string;
  let v = await vault(id);
  for (let i = 0; i < 20 && !v.btc_address; i++) {
    await sleep(1000);
    v = await vault(id);
  }
  console.log(`vault No. ${id.padStart(4, "0")}, ${v.state.kind}, Bitcoin testnet4 address ${v.btc_address}`);
  console.log(`fund it: pnpm spike:links pay ${id} 30000`);
}

/** bob. pays `wei` into vault `id`'s Base Sepolia address from his opened vault FUNDER. */
async function fundEvm(id: string, wei: bigint) {
  const bob = account(BOB);
  const from = await vault(FUNDER);
  const to = (await vault(id)).evm_address as string;
  const fees = await ethFees(GAS_LIMIT * 1_000_000_000n);
  const params = { chain_id: String(BASE_SEPOLIA), nonce: String(await ethNonce(from.evm_address as string)), to, amount_wei: wei.toString(), gas_limit: GAS_LIMIT.toString(), max_fee_per_gas: fees.max_fee_per_gas.toString(), max_priority_fee_per_gas: fees.max_priority_fee_per_gas.toString() };
  const index = from.withdrawal_count;
  await tx(bob, BEARER, "withdraw_evm", { token_id: FUNDER, params }, WITHDRAW_DEPOSIT + ONE_YOCTO, `bob pays ${wei} wei from vault ${FUNDER} into vault ${id}`, null, 150n * TGAS);
  const [w] = await view<Withdrawal[]>(BEARER, "withdrawals", { token_id: FUNDER, from_index: index, limit: 1 });
  if (!w?.signed_raw_tx) throw new Error(`not signed: ${w?.error ?? w?.status}`);
  const hash = await ethBroadcast(w.signed_raw_tx);
  console.log(`funded: https://sepolia.basescan.org/tx/${hash}; vault ${id} holds ${await ethBalance(to)} wei`);
}

async function planIt(id: string, chain: string) {
  const alice = account(ALICE);
  const evm = chain === "evm";
  const to = evm ? ((await vault(FUNDER)).evm_address as string) : ((await vault(TREASURY)).btc_address as string);
  await tx(alice, STANDING, "deposit_for_plan", {}, PLAN_DEPOSIT, "alice pays the plan deposit");
  const terms = evm
    ? { chain: "evm", to, chain_id: String(BASE_SEPOLIA), amount: AMOUNT_WEI.toString(), max_fee: MAX_FEE_WEI.toString() }
    : { chain: "btc", to, amount: String(AMOUNT_SAT), max_fee: String(MAX_FEE_SAT) };
  const msg = { payee: BOB, ...terms, interval_ns: INTERVAL.toString(), first_due_ns: "0", max_payments: 3, cancellable: true };
  await tx(alice, BEARER, "nft_transfer_call", { receiver_id: STANDING, token_id: id, msg: JSON.stringify(msg) }, ONE_YOCTO, `alice plans vault ${id}: ${terms.amount} ${evm ? "wei" : "sats"} every ${INTERVAL / SECOND} s to ${to}, payee ${BOB}`, null, 200n * TGAS);
  console.log(JSON.stringify(await plan(id), null, 2));
  saveReport("testnet-standing-plan", { measured_at: new Date().toISOString(), contract: STANDING, token_id: id, terms: msg, steps });
}

async function collect(id: string) {
  const p = await plan(id);
  if (!p) throw new Error(`vault ${id} has no plan`);
  if (p.chain === "evm") return collectEvm(id, p);
  const bob = account(BOB);
  const v = await vault(id);
  const coins = (await esplora<Utxo[]>(`/address/${v.btc_address}/utxo`)).sort((a, b) => b.value - a.value).slice(0, 2);
  if (!coins.length) throw new Error(`vault ${id}'s address ${v.btc_address} holds no coins yet`);
  const rate = await feeRate();
  const fee = Math.min(MAX_FEE_SAT, Math.ceil(rate * (11 + 68 * coins.length + 31 * 2)));
  const inputs = coins.map((c) => ({ txid: c.txid, vout: c.vout, value_sat: String(c.value) }));
  const n = BigInt(inputs.length);
  const deposit = (WITHDRAW_DEPOSIT + ONE_YOCTO) * n + (p.opened ? 0n : ONE_YOCTO);
  const index = p.withdrawals;
  await tx(bob, STANDING, "collect", { token_id: id, params: { chain: "btc", inputs, fee_sat: String(fee) } }, deposit, `bob collects payment ${p.payments + 1} from vault ${id} (${coins.length} coin(s), fee ${fee} sats)`, null, 300n * TGAS);
  const after = await settled(id);
  const [w] = await view<Withdrawal[]>(BEARER, "withdrawals", { token_id: id, from_index: index, limit: 1 });
  console.log(`plan: ${after?.payments} payment(s), state ${after?.state.kind}; Bearer record #${index}: ${w?.status}`);
  if (!w?.signed_raw_tx) throw new Error(`not signed: ${w?.error ?? w?.status}`);
  const txid = await broadcast(w.signed_raw_tx);
  const link = `https://blockstream.info/testnet4/tx/${txid}`;
  console.log(`broadcast: ${link}`);
  const after_vault = await vault(id);
  saveReport("testnet-standing-collect", {
    measured_at: new Date().toISOString(),
    contract: STANDING,
    token_id: id,
    vault_state: after_vault.state,
    vault_owner: after_vault.owner_id,
    payment: after?.payments,
    bearer_record: index,
    amount_sat: AMOUNT_SAT,
    fee_sat: fee,
    to: p.to,
    bitcoin_tx: link,
    steps,
  });
}

async function collectEvm(id: string, p: Plan) {
  const bob = account(BOB);
  const v = await vault(id);
  const before = await ethBalance(p.to);
  const fees = await ethFees(BigInt(p.max_fee));
  const params = { chain: "evm", nonce: String(await ethNonce(v.evm_address as string)), gas_limit: GAS_LIMIT.toString(), max_fee_per_gas: fees.max_fee_per_gas.toString(), max_priority_fee_per_gas: fees.max_priority_fee_per_gas.toString() };
  const deposit = WITHDRAW_DEPOSIT + ONE_YOCTO + (p.opened ? 0n : ONE_YOCTO);
  const index = p.withdrawals;
  await tx(bob, STANDING, "collect", { token_id: id, params }, deposit, `bob collects payment ${p.payments + 1} from vault ${id} (nonce ${params.nonce}, max fee ${fees.max_fee_per_gas} wei/gas)`, null, 300n * TGAS);
  const after = await settled(id);
  const [w] = await view<Withdrawal[]>(BEARER, "withdrawals", { token_id: id, from_index: index, limit: 1 });
  console.log(`plan: ${after?.payments} payment(s), state ${after?.state.kind}; Bearer record #${index}: ${w?.status}`);
  if (!w?.signed_raw_tx) throw new Error(`not signed: ${w?.error ?? w?.status}`);
  const hash = await ethBroadcast(w.signed_raw_tx);
  const link = `https://sepolia.basescan.org/tx/${hash}`;
  const received = (await ethBalance(p.to)) - before;
  console.log(`confirmed: ${link}; ${p.to} received ${received} wei`);
  const after_vault = await vault(id);
  saveReport("testnet-standing-collect", {
    measured_at: new Date().toISOString(),
    contract: STANDING,
    token_id: id,
    vault_state: after_vault.state,
    vault_owner: after_vault.owner_id,
    payment: after?.payments,
    bearer_record: index,
    amount_wei: p.amount,
    received_wei: received.toString(),
    to: p.to,
    base_sepolia_tx: link,
    steps,
  });
}

async function refusals(id: string) {
  const alice = account(ALICE);
  const bob = account(BOB);
  const p = await plan(id);
  if (!p) throw new Error(`vault ${id} has no plan`);
  const coin = { txid: "00".repeat(32), vout: 0, value_sat: "50000" };
  const cap = BigInt(p.max_fee);
  const params = (over: boolean) =>
    p.chain === "evm"
      ? { chain: "evm", nonce: "0", gas_limit: GAS_LIMIT.toString(), max_fee_per_gas: (cap / GAS_LIMIT + (over ? 1n : 0n)).toString(), max_priority_fee_per_gas: "1" }
      : { chain: "btc", inputs: [coin], fee_sat: String(over ? cap + 1n : 300n) };
  const dep = WITHDRAW_DEPOSIT + 2n;
  await tx(alice, STANDING, "collect", { token_id: id, params: params(false) }, dep, "alice collects (not the payee)", "ERR_NOT_PAYEE", 300n * TGAS);
  await tx(bob, STANDING, "collect", { token_id: id, params: params(true) }, dep, "bob collects with a fee over the cap", "ERR_FEE_TOO_HIGH", 300n * TGAS);
  if (Number(await view<number>(STANDING, "owed", { token_id: id })) === 0) {
    await tx(bob, STANDING, "collect", { token_id: id, params: params(false) }, dep, "bob collects before the next period", "ERR_NOT_DUE", 300n * TGAS);
  }
  if (p.opened) {
    await tx(alice, STANDING, "take_back", { token_id: id }, ONE_YOCTO, "alice takes an opened vault back", "ERR_VAULT_OPENED");
    await tx(alice, BEARER, "nft_transfer", { receiver_id: ALICE, token_id: id }, ONE_YOCTO, "alice moves the opened vault on Bearer", "ERR_VAULT_OPENED");
  }
  await tx(bob, STANDING, "stop", { token_id: id }, ONE_YOCTO, "bob stops the plan (not the giver)", "ERR_NOT_GIVER");
  saveReport("testnet-standing-refusals", { measured_at: new Date().toISOString(), contract: STANDING, token_id: id, steps });
}

async function stop(id: string) {
  const p = await plan(id);
  await tx(account(ALICE), STANDING, "stop", { token_id: id }, ONE_YOCTO, `alice stops vault ${id}'s payments`);
  const coin = { txid: "00".repeat(32), vout: 0, value_sat: "50000" };
  const params = p?.chain === "evm" ? { chain: "evm", nonce: "0", gas_limit: "21000", max_fee_per_gas: "1", max_priority_fee_per_gas: "1" } : { chain: "btc", inputs: [coin], fee_sat: "300" };
  await tx(account(BOB), STANDING, "collect", { token_id: id, params }, WITHDRAW_DEPOSIT + 2n, "bob collects after the stop", "ERR_ENDED", 300n * TGAS);
  saveReport("testnet-standing-stop", { measured_at: new Date().toISOString(), contract: STANDING, token_id: id, plan: await plan(id), steps });
}

/** Deletes every access key on the standing-payments account (P12). Same guards as Bearer's lock. */
async function lock() {
  if (process.env.CONFIRM_LOCK !== STANDING) throw new Error(`Locking ${STANDING} can't be undone. Run again with CONFIRM_LOCK=${STANDING}.`);
  const expected = codeHashOf(readFileSync(STANDING_WASM));
  const { code_hash } = await viewAccount(STANDING);
  if (code_hash !== expected) throw new Error(`${STANDING} runs ${code_hash}, not the given build (${expected}); refusing to lock`);
  type Keys = { keys: { public_key: string }[] };
  const keyList = () => rpc<Keys>("query", { request_type: "view_access_key_list", finality: "final", account_id: STANDING });
  const { keys } = await keyList();
  if (!keys.length) return console.log(`${STANDING} is already locked`);
  const own = (JSON.parse(readFileSync(join(CREDS, `${STANDING}.json`), "utf8")) as { public_key: string }).public_key;
  const ordered = [...keys.filter((k) => k.public_key !== own), ...keys.filter((k) => k.public_key === own)];
  const r = (await account(STANDING).signAndSendTransaction({
    receiverId: STANDING,
    actions: ordered.map((k) => actions.deleteKey(PublicKey.fromString(k.public_key))),
    waitUntil: "FINAL",
  })) as unknown as Outcome;
  const after = await keyList();
  const report = {
    measured_at: new Date().toISOString(),
    contract: STANDING,
    code_hash,
    wasm: relative(join(import.meta.dirname, "..", "..", ".."), STANDING_WASM),
    deleted_keys: ordered.map((k) => k.public_key),
    tx: explorer(r.transaction.hash),
    keys_after: after.keys.length,
  };
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-standing-lock", report);
  if (after.keys.length) throw new Error(`${STANDING} still has ${after.keys.length} key(s)`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "setup") await setup();
else if (cmd === "vault") await newVault();
else if (cmd === "fund-evm") await fundEvm(arg ?? "", BigInt(process.argv[4] ?? "0"));
else if (cmd === "plan") await planIt(arg ?? "", process.argv[4] ?? "evm");
else if (cmd === "collect") await collect(arg ?? "");
else if (cmd === "refusals") await refusals(arg ?? "");
else if (cmd === "stop") await stop(arg ?? "");
else if (cmd === "lock") await lock();
else console.log("usage: node spike/standing-testnet.ts setup|vault|fund-evm <id> <wei>|plan <id> evm|btc|collect <id>|refusals <id>|stop <id>|lock");
