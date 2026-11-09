/**
 * The scheduled handover on NEAR testnet, against the locked Bearer contract (bearer.testnet).
 *
 *   node spike/schedule-testnet.ts setup   # deploy contracts/res/schedule.wasm and initialise
 *   node spike/schedule-testnet.ts run     # schedule, refuse early moves, release on the date
 *   CONFIRM_LOCK=<schedule> node spike/schedule-testnet.ts lock   # delete every key; only if the code is SCHEDULE_WASM
 *
 * Keys come from ~/.near-credentials/testnet, never the repo. Every number in the report is
 * measured on testnet; nothing is estimated.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { Account, KeyPair, PublicKey, actions } from "near-api-js";

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const PARENT = process.env.BEARER_TESTNET_PARENT;
if (!PARENT) throw new Error("Set BEARER_TESTNET_PARENT to the faucet-created parent of the test accounts.");
const BEARER = process.env.BEARER_CONTRACT_ID ?? "bearer.testnet";
const SCHEDULE = process.env.SCHEDULE_CONTRACT_ID ?? "bearer-schedule.testnet";
const ALICE = `alice.${PARENT}`;
const BOB = `bob.${PARENT}`;
/** A name only PARENT can create, so nobody else can register it while a vault waits for it. */
const NOBODY = process.env.SCHEDULE_NOBODY ?? `nobody.${PARENT}`;
const SCHEDULE_WASM = process.env.SCHEDULE_WASM ?? join(import.meta.dirname, "..", "..", "res", "schedule.wasm");
const CREDS = join(homedir(), ".near-credentials", "testnet");

const MILLI = 10n ** 21n;
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const SCHEDULE_DEPOSIT = 10n * MILLI;
const CREATE_DEPOSIT = 50n * MILLI;
const SECOND = 1_000_000_000n;

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

async function exists(id: string) {
  try {
    await viewAccount(id);
    return true;
  } catch {
    return false;
  }
}

/** An account's balance once its pending receipts (gas refunds, refunds) have landed. */
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
const vault = (id: string) => view<Vault>(BEARER, "vault", { token_id: id });
const schedule = (id: string) => view<{ state: { kind: string } } | null>(SCHEDULE, "schedule", { token_id: id });

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

/* ---------- commands ---------- */

async function setup() {
  const wasm = readFileSync(SCHEDULE_WASM);
  const s = account(SCHEDULE);
  if ((await viewAccount(SCHEDULE)).code_hash !== codeHashOf(wasm)) await s.deployContract(wasm);
  let hash = "";
  for (let i = 0; i < 20 && hash !== codeHashOf(wasm); i++) {
    if (i) await sleep(1000);
    hash = (await viewAccount(SCHEDULE)).code_hash;
  }
  try {
    await view(SCHEDULE, "get_config");
    console.log("already initialised");
  } catch {
    await tx(s, SCHEDULE, "new", { nft_contract: BEARER, schedule_deposit: SCHEDULE_DEPOSIT.toString() }, 0n, "initialise");
  }
  console.log(`${SCHEDULE}: code ${hash} (${hash === codeHashOf(wasm) ? "matches" : "DIFFERS from"} ${relative(join(import.meta.dirname, "..", "..", ".."), SCHEDULE_WASM)})`);
  console.log(JSON.stringify(await view(SCHEDULE, "get_config")));
}

async function run() {
  const alice = account(ALICE);
  const bob = account(BOB);
  const carol = account(PARENT!); // neither giver nor recipient: whoever releases on the day
  const toBob = process.env.SCHEDULE_ALICE_VAULT ?? "2";
  const toNobody = process.env.SCHEDULE_BOB_VAULT ?? "4";
  for (const [id, owner] of [[toBob, ALICE], [toNobody, BOB]] as const) {
    const v = await vault(id);
    if (v.owner_id !== owner || v.state.kind !== "sealed") throw new Error(`vault ${id} must be sealed and ${owner}'s`);
  }
  if (await exists(NOBODY)) throw new Error(`${NOBODY} must not exist yet`);

  const send = (who: Account, id: string, recipient: string, at: bigint, cancellable: boolean, label: string) =>
    tx(who, BEARER, "nft_transfer_call", { receiver_id: SCHEDULE, token_id: id, msg: JSON.stringify({ recipient, release_at_ns: at.toString(), cancellable }) }, ONE_YOCTO, label);

  // A cancellable schedule on a fresh vault, cancelled before its date.
  const created = await tx(alice, BEARER, "create_vault", { name: "Schedule run: cancelled", finish: "graphite" }, CREATE_DEPOSIT, "alice creates a vault to cancel");
  const toCancel = JSON.parse(Buffer.from(created.status.SuccessValue ?? "", "base64").toString());
  await tx(alice, SCHEDULE, "deposit_for_schedule", {}, 2n * SCHEDULE_DEPOSIT, "alice pays two schedule deposits");
  await tx(bob, SCHEDULE, "deposit_for_schedule", {}, SCHEDULE_DEPOSIT, "bob pays a schedule deposit");
  await send(alice, toCancel, BOB, (await chainNow()) + 3600n * SECOND, true, `alice schedules vault ${toCancel} for bob in an hour, cancellable`);
  await tx(alice, SCHEDULE, "cancel", { token_id: toCancel }, ONE_YOCTO, "alice cancels it");
  for (let i = 0; i < 20 && (await vault(toCancel)).owner_id !== ALICE; i++) await sleep(1000);

  // Two irrevocable schedules, due in 90 s.
  const at = (await chainNow()) + 90n * SECOND;
  await send(alice, toBob, BOB, at, false, `alice schedules vault ${toBob} for bob, not cancellable`);
  await send(bob, toNobody, NOBODY, at, false, `bob schedules vault ${toNobody} for ${NOBODY}, which doesn't exist`);

  // Nothing moves early, and the giver can't withdraw or take it back.
  await tx(carol, SCHEDULE, "release", { token_id: toBob }, 0n, "release before the date", "ERR_TOO_EARLY");
  await tx(alice, SCHEDULE, "cancel", { token_id: toBob }, ONE_YOCTO, "alice cancels a schedule she made irrevocable", "ERR_NOT_CANCELLABLE");
  await tx(alice, BEARER, "break_seal", { token_id: toBob }, ONE_YOCTO, "alice breaks the seal on her scheduled vault", "ERR_NOT_OWNER");

  console.log(`waiting for ${new Date(Number(at / 1_000_000n)).toISOString()}…`);
  while ((await chainNow()) < at) await sleep(3000);

  // On the date, someone else releases both.
  const aliceBefore = await settledBalance(ALICE);
  await tx(carol, SCHEDULE, "release", { token_id: toBob }, 0n, `release vault ${toBob} to bob`);
  for (let i = 0; i < 20 && (await schedule(toBob)); i++) await sleep(1000);
  const released = await vault(toBob);
  const aliceRefund = (await settledBalance(ALICE)) - aliceBefore;

  // The 1 yoctoNEAR existence check fails by design (ActionError on that receipt); the vault stays.
  const missing = await tx(carol, SCHEDULE, "release", { token_id: toNobody }, 0n, `release vault ${toNobody} to ${NOBODY}`, "ActionError");
  if (!missing.receipts_outcome.some((x) => x.outcome.logs.some((l) => l.includes('"recipient_missing"')))) throw new Error("expected a recipient_missing event");
  const stillWaiting = await schedule(toNobody);
  const heldWhileMissing = (await vault(toNobody)).owner_id;

  // Create the missing account (only PARENT can), then release again.
  const kp = KeyPair.fromRandom("ed25519");
  await carol.createSubAccount({ accountOrPrefix: NOBODY, publicKey: kp.getPublicKey(), nearToTransfer: 100n * MILLI });
  writeFileSync(join(CREDS, `${NOBODY}.json`), JSON.stringify({ account_id: NOBODY, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
  await tx(carol, SCHEDULE, "release", { token_id: toNobody }, 0n, `release vault ${toNobody} again, now ${NOBODY} exists`);
  for (let i = 0; i < 20 && (await schedule(toNobody)); i++) await sleep(1000);
  const arrived = await vault(toNobody);

  console.log(`vault ${toBob}: ${released.owner_id}, ${released.state.kind}, ${released.signatures_requested} signatures · alice refunded ${Number(aliceRefund) / 1e24} NEAR`);
  console.log(`vault ${toNobody}: waited (${stillWaiting?.state.kind}, held by ${heldWhileMissing}) until the account existed, then went to ${arrived.owner_id}`);
  saveReport("testnet-schedule", {
    measured_at: new Date().toISOString(),
    bearer: BEARER,
    schedule: SCHEDULE,
    schedule_code_hash: (await viewAccount(SCHEDULE)).code_hash,
    release_at_ns: at.toString(),
    steps,
    cancelled_vault: { token_id: toCancel, owner_after: (await vault(toCancel)).owner_id },
    released_vault: { token_id: toBob, owner: released.owner_id, state: released.state, signatures_requested: released.signatures_requested, custody: released.custody.map((c) => c.account_id) },
    giver_refund_yocto: aliceRefund.toString(),
    giver_refund_exact: aliceRefund === SCHEDULE_DEPOSIT,
    missing_recipient: { token_id: toNobody, state_after_first_release: stillWaiting?.state ?? null, held_by: heldWhileMissing, owner_after_account_created: arrived.owner_id },
  });
}

/** Deletes every access key on the schedule account (S10). Same guards as Bearer's lock. */
async function lock() {
  if (process.env.CONFIRM_LOCK !== SCHEDULE) throw new Error(`Locking ${SCHEDULE} can't be undone. Run again with CONFIRM_LOCK=${SCHEDULE}.`);
  const expected = codeHashOf(readFileSync(SCHEDULE_WASM));
  const { code_hash } = await viewAccount(SCHEDULE);
  if (code_hash !== expected) throw new Error(`${SCHEDULE} runs ${code_hash}, not the given build (${expected}); refusing to lock`);
  type Keys = { keys: { public_key: string }[] };
  const keyList = () => rpc<Keys>("query", { request_type: "view_access_key_list", finality: "final", account_id: SCHEDULE });
  const { keys } = await keyList();
  if (!keys.length) return console.log(`${SCHEDULE} is already locked`);
  const own = (JSON.parse(readFileSync(join(CREDS, `${SCHEDULE}.json`), "utf8")) as { public_key: string }).public_key;
  const ordered = [...keys.filter((k) => k.public_key !== own), ...keys.filter((k) => k.public_key === own)];
  const r = (await account(SCHEDULE).signAndSendTransaction({
    receiverId: SCHEDULE,
    actions: ordered.map((k) => actions.deleteKey(PublicKey.fromString(k.public_key))),
    waitUntil: "FINAL",
  })) as unknown as Outcome;
  const after = await keyList();
  const report = {
    measured_at: new Date().toISOString(),
    contract: SCHEDULE,
    code_hash,
    wasm: relative(join(import.meta.dirname, "..", "..", ".."), SCHEDULE_WASM),
    deleted_keys: ordered.map((k) => k.public_key),
    tx: explorer(r.transaction.hash),
    keys_after: after.keys.length,
  };
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-schedule-lock", report);
  if (after.keys.length) throw new Error(`${SCHEDULE} still has ${after.keys.length} key(s)`);
}

/** Releases one scheduled vault; creates its recipient first if it's a missing subaccount of PARENT. */
async function releaseOne(tokenId: string) {
  const s = await view<{ recipient: string } | null>(SCHEDULE, "schedule", { token_id: tokenId });
  if (!s) throw new Error(`vault ${tokenId} isn't scheduled`);
  const carol = account(PARENT!);
  if (!(await exists(s.recipient)) && s.recipient.endsWith(`.${PARENT}`)) {
    const kp = KeyPair.fromRandom("ed25519");
    await carol.createSubAccount({ accountOrPrefix: s.recipient, publicKey: kp.getPublicKey(), nearToTransfer: 100n * MILLI });
    writeFileSync(join(CREDS, `${s.recipient}.json`), JSON.stringify({ account_id: s.recipient, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
    console.log(`created ${s.recipient}`);
  }
  await tx(carol, SCHEDULE, "release", { token_id: tokenId }, 0n, `release vault ${tokenId} to ${s.recipient}`);
  for (let i = 0; i < 20 && (await schedule(tokenId)); i++) await sleep(1000);
  console.log(`vault ${tokenId}: owner ${(await vault(tokenId)).owner_id}`);
}

const cmd = process.argv[2];
if (cmd === "setup") await setup();
else if (cmd === "release") await releaseOne(process.argv[3] ?? "");
else if (cmd === "run") await run();
else if (cmd === "lock") await lock();
else console.log("usage: node spike/schedule-testnet.ts setup|run|release <token>|lock");
