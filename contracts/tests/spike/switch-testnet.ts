/**
 * The dead man's switch on NEAR testnet, against the locked Bearer contract (bearer.testnet).
 *
 *   node spike/switch-testnet.ts setup   # deploy SWITCH_WASM and initialise
 *   node spike/switch-testnet.ts run     # arm, check in, change, take back; arm, go quiet, hand over
 *   CONFIRM_LOCK=<switch> node spike/switch-testnet.ts lock   # delete every key; only if the code is SWITCH_WASM
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
const SWITCH = process.env.SWITCH_CONTRACT_ID ?? "bearer-switch.testnet";
const ALICE = `alice.${PARENT}`;
const BOB = `bob.${PARENT}`;
/** The beneficiary nobody has created: stands in for a mistyped name. */
const GHOST = `ghost.${PARENT}`;
const SWITCH_WASM = process.env.SWITCH_WASM ?? join(import.meta.dirname, "..", "..", "res", "switch.wasm");
const CREDS = join(homedir(), ".near-credentials", "testnet");

const MILLI = 10n ** 21n;
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const SWITCH_DEPOSIT = 10n * MILLI;
const CREATE_DEPOSIT = 50n * MILLI;
const SECOND = 1_000_000_000n;
const YEAR = 365n * 24n * 3600n * SECOND;

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
async function tx(who: Account, receiverId: string, method: string, args: object, deposit: bigint, label: string, expect: string | null = null, gas = 150n * TGAS) {
  const signed = await who.createSignedTransaction({ receiverId, actions: [actions.functionCall(method, args, gas, deposit)] });
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
type Switch = { owner: string; beneficiary: string; interval_ns: string; last_check_in_ns: string; state: { kind: string } };
const vault = (id: string) => view<Vault>(BEARER, "vault", { token_id: id });
const switchFor = (id: string) => view<Switch | null>(SWITCH, "switch_for", { token_id: id });
const dueOf = (s: Switch) => BigInt(s.last_check_in_ns) + BigInt(s.interval_ns);

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
  const wasm = readFileSync(SWITCH_WASM);
  const s = account(SWITCH);
  if ((await viewAccount(SWITCH)).code_hash !== codeHashOf(wasm)) await s.deployContract(wasm);
  let hash = "";
  for (let i = 0; i < 20 && hash !== codeHashOf(wasm); i++) {
    if (i) await sleep(1000);
    hash = (await viewAccount(SWITCH)).code_hash;
  }
  try {
    await view(SWITCH, "get_config");
    console.log("already initialised");
  } catch {
    await tx(s, SWITCH, "new", { nft_contract: BEARER, switch_deposit: SWITCH_DEPOSIT.toString() }, 0n, "initialise");
  }
  console.log(`${SWITCH}: code ${hash} (${hash === codeHashOf(wasm) ? "matches" : "DIFFERS from"} ${relative(join(import.meta.dirname, "..", "..", ".."), SWITCH_WASM)})`);
  console.log(JSON.stringify(await view(SWITCH, "get_config")));
}

async function run() {
  const alice = account(ALICE);
  const bob = account(BOB);
  // A stranger: neither the owner nor the beneficiary.
  const stranger = account(PARENT as string);
  try {
    await viewAccount(GHOST);
    throw new Error(`${GHOST} exists; the missing-beneficiary step needs a name nobody has`);
  } catch (e) {
    if (String(e).includes("exists;")) throw e;
  }
  const arm = (id: string, beneficiary: string, interval: bigint, label: string) =>
    tx(alice, BEARER, "nft_transfer_call", { receiver_id: SWITCH, token_id: id, msg: JSON.stringify({ beneficiary, interval_ns: interval.toString() }) }, ONE_YOCTO, label);
  const release = (who: Account, id: string, label: string, expect: string | null = null) => tx(who, SWITCH, "release", { token_id: id }, 0n, label, expect, 100n * TGAS);
  const create = async (name: string) => {
    const r = await tx(alice, BEARER, "create_vault", { name, finish: "midnight" }, CREATE_DEPOSIT, `alice creates "${name}"`);
    return JSON.parse(Buffer.from(r.status.SuccessValue ?? "", "base64").toString()) as string;
  };

  // SWITCH_QUIET=29,30 picks up after the silence: the vault armed for bob, then the one armed for
  // GHOST, both already due and already tried once for GHOST (say, after a run that stopped there).
  const quiet = process.env.SWITCH_QUIET?.split(",").map((s) => s.trim());
  if (quiet && quiet.length !== 2) throw new Error("SWITCH_QUIET takes two token ids: released, missing beneficiary");
  let takenBack: string | null = null;
  let afterTakeBack: Vault | null = null;
  let checkInMoved: bigint | null = null;
  let released: string;
  let missing: string;
  if (quiet) {
    [released, missing] = quiet;
  } else {
    // SWITCH_VAULTS=31,32,33 reuses three sealed vaults of alice's (say, from a run that stopped early).
    const reuse = process.env.SWITCH_VAULTS?.split(",").map((s) => s.trim());
    if (reuse && reuse.length !== 3) throw new Error("SWITCH_VAULTS takes three token ids: taken back, released, missing beneficiary");
    takenBack = reuse?.[0] ?? (await create("Switch run: taken back"));
    released = reuse?.[1] ?? (await create("Switch run: released"));
    missing = reuse?.[2] ?? (await create("Switch run: no such heir"));
    await tx(alice, SWITCH, "deposit_for_switch", {}, 3n * SWITCH_DEPOSIT, "alice pays three switch deposits");

    // 1. Arm for a year, check in, change, take back. Nobody else can do any of it.
    await arm(takenBack, BOB, YEAR, `alice puts vault ${takenBack} in a switch for bob, a year between check-ins`);
    await tx(alice, BEARER, "break_seal", { token_id: takenBack }, ONE_YOCTO, "alice breaks the seal on her vault in the switch", "ERR_NOT_OWNER");
    await tx(bob, SWITCH, "check_in", { token_id: takenBack }, ONE_YOCTO, "bob checks in for alice", "ERR_NOT_OWNER");
    await release(stranger, takenBack, "a stranger hands it over early", "ERR_NOT_SILENT");
    const before = BigInt((await switchFor(takenBack))!.last_check_in_ns);
    await tx(alice, SWITCH, "check_in", { token_id: takenBack }, ONE_YOCTO, "alice checks in");
    const after = BigInt((await switchFor(takenBack))!.last_check_in_ns);
    await tx(alice, SWITCH, "update", { token_id: takenBack, beneficiary: null, interval_ns: (2n * YEAR).toString() }, ONE_YOCTO, "alice changes it to two years");
    await tx(alice, SWITCH, "take_back", { token_id: takenBack }, ONE_YOCTO, "alice takes it back");
    for (let i = 0; i < 20 && (await switchFor(takenBack)); i++) await sleep(1000);
    afterTakeBack = await vault(takenBack);
    checkInMoved = after - before;

    // 2. Arm two for 70 s and go quiet: one names bob, one names an account nobody has created.
    const SHORT = 70n * SECOND;
    await arm(released, BOB, SHORT, `alice puts vault ${released} in a switch for bob, 70 s between check-ins`);
    await arm(missing, GHOST, SHORT, `alice puts vault ${missing} in a switch for ${GHOST}, which doesn't exist`);
    const due = dueOf((await switchFor(missing))!);
    console.log(`waiting for ${new Date(Number(due / 1_000_000n)).toISOString()}…`);
    while ((await chainNow()) < due) await sleep(3000);

    // The 1-yoctoNEAR probe to GHOST fails (ActionError), so the switch puts the vault back as it was.
    await release(stranger, missing, `a stranger hands vault ${missing} to ${GHOST}`, "ActionError");
  }
  for (let i = 0; i < 20 && (await switchFor(missing))?.state.kind !== "armed"; i++) await sleep(1000);
  const missingAfter = { switch: await switchFor(missing), vault: summary(await vault(missing)) };

  const aliceBefore = await settledBalance(ALICE);
  await release(stranger, released, `a stranger hands vault ${released} to bob`);
  for (let i = 0; i < 20 && (await switchFor(released)); i++) await sleep(1000);
  const depositBack = (await settledBalance(ALICE)) - aliceBefore;
  const afterRelease = await vault(released);

  await tx(alice, SWITCH, "take_back", { token_id: missing }, ONE_YOCTO, `alice takes vault ${missing} back`);
  for (let i = 0; i < 20 && (await switchFor(missing)); i++) await sleep(1000);

  if (takenBack && afterTakeBack && checkInMoved !== null) {
    console.log(`vault ${takenBack}: ${afterTakeBack.owner_id}, ${afterTakeBack.state.kind} · check-in moved the clock by ${Number(checkInMoved / 1_000_000n) / 1000} s`);
  }
  console.log(`vault ${released}: ${afterRelease.owner_id}, ${afterRelease.state.kind}, ${afterRelease.signatures_requested} signatures · alice got her deposit back: ${Number(depositBack) / 1e24} NEAR`);
  console.log(`vault ${missing}: ${missingAfter.vault.owner} while ${GHOST} didn't exist; then back with ${(await vault(missing)).owner_id}`);
  saveReport("testnet-switch", {
    measured_at: new Date().toISOString(),
    bearer: BEARER,
    switch: SWITCH,
    switch_code_hash: (await viewAccount(SWITCH)).code_hash,
    steps,
    taken_back: takenBack && afterTakeBack ? { token_id: takenBack, ...summary(afterTakeBack), check_in_moved_ns: String(checkInMoved) } : "earlier, in the part this run picked up from",
    released: { token_id: released, ...summary(afterRelease), owner_deposit_back_yocto: depositBack.toString(), deposit_back_exact: depositBack === SWITCH_DEPOSIT },
    missing_beneficiary: { token_id: missing, beneficiary: GHOST, after_release_attempt: missingAfter, finally: summary(await vault(missing)) },
  });
}

/** Deletes every access key on the switch account (D9). Same guards as Bearer's lock. */
async function lock() {
  if (process.env.CONFIRM_LOCK !== SWITCH) throw new Error(`Locking ${SWITCH} can't be undone. Run again with CONFIRM_LOCK=${SWITCH}.`);
  const expected = codeHashOf(readFileSync(SWITCH_WASM));
  const { code_hash } = await viewAccount(SWITCH);
  if (code_hash !== expected) throw new Error(`${SWITCH} runs ${code_hash}, not the given build (${expected}); refusing to lock`);
  type Keys = { keys: { public_key: string }[] };
  const keyList = () => rpc<Keys>("query", { request_type: "view_access_key_list", finality: "final", account_id: SWITCH });
  const { keys } = await keyList();
  if (!keys.length) return console.log(`${SWITCH} is already locked`);
  const own = (JSON.parse(readFileSync(join(CREDS, `${SWITCH}.json`), "utf8")) as { public_key: string }).public_key;
  const ordered = [...keys.filter((k) => k.public_key !== own), ...keys.filter((k) => k.public_key === own)];
  const r = (await account(SWITCH).signAndSendTransaction({
    receiverId: SWITCH,
    actions: ordered.map((k) => actions.deleteKey(PublicKey.fromString(k.public_key))),
    waitUntil: "FINAL",
  })) as unknown as Outcome;
  const after = await keyList();
  const report = {
    measured_at: new Date().toISOString(),
    contract: SWITCH,
    code_hash,
    wasm: relative(join(import.meta.dirname, "..", "..", ".."), SWITCH_WASM),
    deleted_keys: ordered.map((k) => k.public_key),
    tx: explorer(r.transaction.hash),
    keys_after: after.keys.length,
  };
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-switch-lock", report);
  if (after.keys.length) throw new Error(`${SWITCH} still has ${after.keys.length} key(s)`);
}

const cmd = process.argv[2];
if (cmd === "setup") await setup();
else if (cmd === "run") await run();
else if (cmd === "lock") await lock();
else console.log("usage: node spike/switch-testnet.ts setup|run|lock");
