/**
 * Borrowing against a vault on NEAR testnet, against the locked Bearer contract (bearer.testnet).
 *
 *   node spike/lend-testnet.ts setup   # deploy LEND_WASM and initialise
 *   node spike/lend-testnet.ts run     # request, fund, repay; fund and foreclose; request and cancel
 *   CONFIRM_LOCK=<lend> node spike/lend-testnet.ts lock   # delete every key; only if the code is LEND_WASM
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
const LEND = process.env.LEND_CONTRACT_ID ?? "bearer-lend.testnet";
const ALICE = `alice.${PARENT}`;
const BOB = `bob.${PARENT}`;
const LEND_WASM = process.env.LEND_WASM ?? join(import.meta.dirname, "..", "..", "res", "lend.wasm");
const CREDS = join(homedir(), ".near-credentials", "testnet");

const MILLI = 10n ** 21n;
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const LOAN_DEPOSIT = 10n * MILLI;
const CREATE_DEPOSIT = 50n * MILLI;
const SECOND = 1_000_000_000n;
/** alice borrows 0.1 NEAR and pays back 0.105. */
const PRINCIPAL = 100n * MILLI;
const REPAYMENT = 105n * MILLI;

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

/** An account's balance once its pending receipts (gas refunds, payouts) have landed. */
async function settledBalance(id: string) {
  let last = BigInt((await viewAccount(id)).amount);
  for (let stable = 0; stable < 4; ) {
    await sleep(1500);
    const now = BigInt((await viewAccount(id)).amount);
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  return last;
}

async function chainNow() {
  const b = await rpc<{ header: { timestamp_nanosec: string } }>("block", { finality: "final" });
  return BigInt(b.header.timestamp_nanosec);
}

type Outcome = {
  transaction: { hash: string };
  status: { SuccessValue?: string; Failure?: unknown };
  transaction_outcome: { outcome: { gas_burnt: number } };
  receipts_outcome: { outcome: { executor_id: string; gas_burnt: number; status: Record<string, unknown>; logs: string[] } }[];
};

const steps: Record<string, unknown>[] = [];

/** Signs here and sends with send_tx, so a refusal comes back as an outcome, not a thrown error. */
async function tx(who: Account, receiverId: string, method: string, args: object, deposit: bigint, label: string, expect: string | null = null) {
  const signed = await who.createSignedTransaction({ receiverId, actions: [actions.functionCall(method, args, 150n * TGAS, deposit)] });
  const r = await rpc<Outcome>("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "FINAL" });
  const failures = [r.status.Failure, ...r.receipts_outcome.map((x) => x.outcome.status.Failure)].filter(Boolean);
  const text = JSON.stringify(failures);
  const code = failures.length ? (text.match(/ERR_[A-Z_]+/)?.[0] ?? text.match(/[A-Za-z]+Error/)?.[0] ?? "failed") : null;
  const events = r.receipts_outcome.flatMap((x) => x.outcome.logs).filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice(11)).event);
  const tgas = (r.transaction_outcome.outcome.gas_burnt + r.receipts_outcome.reduce((s, x) => s + x.outcome.gas_burnt, 0)) / 1e12;
  const step = { step: label, by: who.accountId, call: `${receiverId}.${method}`, tx: explorer(r.transaction.hash), tgas: Math.round(tgas * 1000) / 1000, refused: code, events };
  steps.push(step);
  console.log(`${label}: ${code ? `refused, ${code}` : "ok"} · ${step.tgas} Tgas · events ${events.join(", ") || "none"} · ${step.tx}`);
  if (expect !== null ? code !== expect : code) throw new Error(`${label}: expected ${expect ?? "success"}, got ${code ?? "success"}`);
  return r;
}

type Vault = { owner_id: string; state: { kind: string }; signatures_requested: number; custody: { account_id: string }[] };
type Loan = { state: { kind: string; lender?: string; due_at_ns?: string } };
const vault = (id: string) => view<Vault>(BEARER, "vault", { token_id: id });
const loan = (id: string) => view<Loan | null>(LEND, "loan", { token_id: id });

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

const summary = (v: Vault) => ({ owner: v.owner_id, state: v.state, signatures_requested: v.signatures_requested, custody: v.custody.map((c) => c.account_id) });

/* ---------- commands ---------- */

async function setup() {
  const wasm = readFileSync(LEND_WASM);
  const l = account(LEND);
  if ((await viewAccount(LEND)).code_hash !== codeHashOf(wasm)) await l.deployContract(wasm);
  let hash = "";
  for (let i = 0; i < 20 && hash !== codeHashOf(wasm); i++) {
    if (i) await sleep(1000);
    hash = (await viewAccount(LEND)).code_hash;
  }
  try {
    await view(LEND, "get_config");
    console.log("already initialised");
  } catch {
    await tx(l, LEND, "new", { nft_contract: BEARER, loan_deposit: LOAN_DEPOSIT.toString() }, 0n, "initialise");
  }
  console.log(`${LEND}: code ${hash} (${hash === codeHashOf(wasm) ? "matches" : "DIFFERS from"} ${relative(join(import.meta.dirname, "..", "..", ".."), LEND_WASM)})`);
  console.log(JSON.stringify(await view(LEND, "get_config")));
}

async function run() {
  const alice = account(ALICE);
  const bob = account(BOB);
  const terms = (term: bigint) => JSON.stringify({ principal: PRINCIPAL.toString(), repayment: REPAYMENT.toString(), term_ns: term.toString() });
  const create = async (name: string) => {
    const r = await tx(alice, BEARER, "create_vault", { name, finish: "champagne" }, CREATE_DEPOSIT, `alice creates "${name}"`);
    return JSON.parse(Buffer.from(r.status.SuccessValue ?? "", "base64").toString()) as string;
  };
  const pledge = (id: string, term: bigint, label: string) =>
    tx(alice, BEARER, "nft_transfer_call", { receiver_id: LEND, token_id: id, msg: terms(term) }, ONE_YOCTO, label);
  const fund = (id: string, term: bigint, label: string, repayment = REPAYMENT, expect: string | null = null) =>
    tx(bob, LEND, "fund", { token_id: id, repayment: repayment.toString(), term_ns: term.toString() }, PRINCIPAL, label, expect);

  const repaid = await create("Lend run: repaid");
  const foreclosed = await create("Lend run: foreclosed");
  const cancelled = await create("Lend run: cancelled");
  await tx(alice, LEND, "deposit_for_loan", {}, 3n * LOAN_DEPOSIT, "alice pays three loan deposits");

  // 1. Request, fund, repay. alice signs nothing while bob funds, so her balance moves by exactly the principal.
  const DAY = 24n * 3600n * SECOND;
  await pledge(repaid, DAY, `alice pledges vault ${repaid}: 0.1 NEAR now, 0.105 back within a day`);
  await fund(repaid, DAY, "bob funds it, naming a different repayment", PRINCIPAL, "ERR_TERMS_CHANGED");
  const aliceBeforeFund = await settledBalance(ALICE);
  await fund(repaid, DAY, `bob funds vault ${repaid}`);
  const borrowerReceived = (await settledBalance(ALICE)) - aliceBeforeFund;
  await tx(alice, BEARER, "break_seal", { token_id: repaid }, ONE_YOCTO, "alice breaks the seal on her pledged vault", "ERR_NOT_OWNER");
  await tx(bob, LEND, "foreclose", { token_id: repaid }, ONE_YOCTO, "bob takes the vault before the due date", "ERR_NOT_DUE");
  const bobBeforeRepay = await settledBalance(BOB);
  await tx(alice, LEND, "repay", { token_id: repaid }, REPAYMENT, `alice repays vault ${repaid}`);
  for (let i = 0; i < 20 && (await loan(repaid)); i++) await sleep(1000);
  const lenderReceived = (await settledBalance(BOB)) - bobBeforeRepay;
  const afterRepay = await vault(repaid);

  // 2. Request, fund for 70 s, let it run out, foreclose.
  const SHORT = 70n * SECOND;
  await pledge(foreclosed, SHORT, `alice pledges vault ${foreclosed}: 0.1 NEAR now, 0.105 back within 70 s`);
  await fund(foreclosed, SHORT, `bob funds vault ${foreclosed}`);
  const due = BigInt((await loan(foreclosed))?.state.due_at_ns ?? "0");
  console.log(`waiting for ${new Date(Number(due / 1_000_000n)).toISOString()}…`);
  while ((await chainNow()) < due) await sleep(3000);
  await tx(alice, LEND, "repay", { token_id: foreclosed }, REPAYMENT, "alice repays after the due date", "ERR_PAST_DUE");
  const aliceBeforeForeclose = await settledBalance(ALICE);
  await tx(bob, LEND, "foreclose", { token_id: foreclosed }, ONE_YOCTO, `bob takes vault ${foreclosed}`);
  for (let i = 0; i < 20 && (await loan(foreclosed)); i++) await sleep(1000);
  const depositBack = (await settledBalance(ALICE)) - aliceBeforeForeclose;
  const afterForeclose = await vault(foreclosed);

  // 3. Request, then take it back before anyone lends.
  await pledge(cancelled, DAY, `alice pledges vault ${cancelled}`);
  await tx(alice, LEND, "cancel_request", { token_id: cancelled }, ONE_YOCTO, "alice takes it back");
  for (let i = 0; i < 20 && (await loan(cancelled)); i++) await sleep(1000);
  const afterCancel = await vault(cancelled);

  console.log(`vault ${repaid}: ${afterRepay.owner_id}, ${afterRepay.state.kind}, ${afterRepay.signatures_requested} signatures · alice got ${Number(borrowerReceived) / 1e24} NEAR, bob got ${Number(lenderReceived) / 1e24} NEAR back`);
  console.log(`vault ${foreclosed}: ${afterForeclose.owner_id}, ${afterForeclose.state.kind} · alice got her deposit back: ${Number(depositBack) / 1e24} NEAR`);
  console.log(`vault ${cancelled}: ${afterCancel.owner_id}`);
  saveReport("testnet-lend", {
    measured_at: new Date().toISOString(),
    bearer: BEARER,
    lend: LEND,
    lend_code_hash: (await viewAccount(LEND)).code_hash,
    principal_yocto: PRINCIPAL.toString(),
    repayment_yocto: REPAYMENT.toString(),
    steps,
    repaid: { token_id: repaid, ...summary(afterRepay), borrower_received_yocto: borrowerReceived.toString(), borrower_received_exact: borrowerReceived === PRINCIPAL, lender_received_yocto: lenderReceived.toString(), lender_received_exact: lenderReceived === REPAYMENT },
    foreclosed: { token_id: foreclosed, due_at_ns: due.toString(), ...summary(afterForeclose), borrower_deposit_back_yocto: depositBack.toString(), deposit_back_exact: depositBack === LOAN_DEPOSIT },
    cancelled: { token_id: cancelled, ...summary(afterCancel) },
  });
}

/** Deletes every access key on the lending account (L10). Same guards as Bearer's lock. */
async function lock() {
  if (process.env.CONFIRM_LOCK !== LEND) throw new Error(`Locking ${LEND} can't be undone. Run again with CONFIRM_LOCK=${LEND}.`);
  const expected = codeHashOf(readFileSync(LEND_WASM));
  const { code_hash } = await viewAccount(LEND);
  if (code_hash !== expected) throw new Error(`${LEND} runs ${code_hash}, not the given build (${expected}); refusing to lock`);
  type Keys = { keys: { public_key: string }[] };
  const keyList = () => rpc<Keys>("query", { request_type: "view_access_key_list", finality: "final", account_id: LEND });
  const { keys } = await keyList();
  if (!keys.length) return console.log(`${LEND} is already locked`);
  const own = (JSON.parse(readFileSync(join(CREDS, `${LEND}.json`), "utf8")) as { public_key: string }).public_key;
  const ordered = [...keys.filter((k) => k.public_key !== own), ...keys.filter((k) => k.public_key === own)];
  const r = (await account(LEND).signAndSendTransaction({
    receiverId: LEND,
    actions: ordered.map((k) => actions.deleteKey(PublicKey.fromString(k.public_key))),
    waitUntil: "FINAL",
  })) as unknown as Outcome;
  const after = await keyList();
  const report = {
    measured_at: new Date().toISOString(),
    contract: LEND,
    code_hash,
    wasm: relative(join(import.meta.dirname, "..", "..", ".."), LEND_WASM),
    deleted_keys: ordered.map((k) => k.public_key),
    tx: explorer(r.transaction.hash),
    keys_after: after.keys.length,
  };
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-lend-lock", report);
  if (after.keys.length) throw new Error(`${LEND} still has ${after.keys.length} key(s)`);
}

const cmd = process.argv[2];
if (cmd === "setup") await setup();
else if (cmd === "run") await run();
else if (cmd === "lock") await lock();
else console.log("usage: node spike/lend-testnet.ts setup|run|lock");
