/**
 * v2 staking on NEAR testnet: bearer-v2.testnet stakes vaults' NEAR with one real staking pool.
 *
 *   CONFIRM_MIGRATE=bearer-v2.testnet node spike/staking-testnet.ts migrate   # deploy out/bearer.wasm, add staking, keep every vault
 *   CONFIRM_DEPLOY=bearer-v2.testnet node spike/staking-testnet.ts deploy     # deploy a newer build; the state stays as it is
 *   node spike/staking-testnet.ts run       # stake from a sealed vault, refusals, hand it over, unstake in batches
 *   node spike/staking-testnet.ts status    # the pool's view, the batches, each staked vault's worth
 *   node spike/staking-testnet.ts process   # once unlocked: withdraw the batch into the vault, unstake the next
 *
 * Keys come from ~/.near-credentials/testnet, never the repo. Every number in a report is measured
 * on testnet; nothing is estimated.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, actions } from "near-api-js";

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const PARENT = process.env.BEARER_TESTNET_PARENT;
if (!PARENT) throw new Error("Set BEARER_TESTNET_PARENT to the faucet-created parent of the test accounts.");
const BEARER = process.env.BEARER_V2_CONTRACT_ID ?? "bearer-v2.testnet";
/** Standard staking pool code, no access keys, 3% fee, producing blocks (checked 2026-11-09). */
const POOL = process.env.STAKING_POOL ?? "stakely_v2.pool.f863973.m0";
const ALICE = `alice.${PARENT}`;
const BOB = `bob.${PARENT}`;
const WASM = process.env.BEARER_WASM ?? join(import.meta.dirname, "..", "..", "out", "bearer.wasm");
const CREDS = join(homedir(), ".near-credentials", "testnet");

const MILLI = 10n ** 21n;
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const CREATE_DEPOSIT = 50n * MILLI;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
const near = (yocto: bigint | string) => Number(BigInt(yocto) / 10n ** 15n) / 1e9;

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
const epochHeight = async () => (await rpc<{ epoch_height: number }>("validators", [null])).epoch_height;

type Outcome = {
  transaction: { hash: string };
  status: { SuccessValue?: string; Failure?: unknown };
  transaction_outcome: { outcome: { gas_burnt: number } };
  receipts_outcome: { outcome: { executor_id: string; gas_burnt: number; status: Record<string, unknown>; logs: string[] } }[];
};

type Staking = { pool: string | null; total_shares: string; queued: string; batch: number; unbonding: string; unbonding_epoch: number; withdrawn_through: number; busy: boolean; last_pool_stake: string };
type StakeView = { shares: string; staked_estimate: string; queued: string; unbonding: string; unlocks_at_epoch: number | null; ready: string };
type PoolAccount = { unstaked_balance: string; staked_balance: string; can_withdraw: boolean };

const steps: Record<string, unknown>[] = [];

/** Signs here and sends with send_tx, so a refusal comes back as an outcome, not a thrown error. */
async function tx(who: Account, method: string, args: object, deposit: bigint, label: string, expect: string | null = null, gas = 300n * TGAS) {
  const signed = await who.createSignedTransaction({ receiverId: BEARER, actions: [actions.functionCall(method, args, gas, deposit)] });
  const r = await rpc<Outcome>("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "FINAL" });
  const failures = [r.status.Failure, ...r.receipts_outcome.map((x) => x.outcome.status.Failure)].filter(Boolean);
  const text = JSON.stringify(failures);
  const code = failures.length ? (text.match(/ERR_[A-Z_]+/)?.[0] ?? text.match(/[A-Za-z]+Error/)?.[0] ?? "failed") : null;
  const events = r.receipts_outcome.flatMap((x) => x.outcome.logs).filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice(11)).event);
  const tgas = (r.transaction_outcome.outcome.gas_burnt + r.receipts_outcome.reduce((s, x) => s + x.outcome.gas_burnt, 0)) / 1e12;
  const step = { step: label, by: who.accountId, call: method, tx: explorer(r.transaction.hash), tgas: Math.round(tgas * 1000) / 1000, refused: code, events };
  steps.push(step);
  console.log(`${label}: ${code ? `refused, ${code}` : "ok"} · ${step.tgas} Tgas · events ${events.join(", ") || "none"} · ${step.tx}`);
  if (expect !== null ? code !== expect : code) throw new Error(`${label}: expected ${expect ?? "success"}, got ${code ?? "success"}`);
  return r;
}

const staking = () => view<Staking>(BEARER, "staking");
const stakeOf = (id: string) => view<StakeView | null>(BEARER, "stake_of", { token_id: id });
const vaultNear = async (id: string) => BigInt((await view<{ near: string }>(BEARER, "holdings", { token_id: id })).near);
const poolAccount = () => view<PoolAccount>(POOL, "get_account", { account_id: BEARER });

/** A vault's shares at the pool's current price, as the site computes it. */
async function worth(id: string) {
  const [s, mine, pool] = await Promise.all([staking(), stakeOf(id), poolAccount()]);
  if (!mine || s.total_shares === "0") return 0n;
  return (BigInt(mine.shares) * (BigInt(pool.staked_balance) - BigInt(s.queued))) / BigInt(s.total_shares);
}

function saveReport(name: string, report: object) {
  const dir = join(import.meta.dirname, "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${new Date().toISOString()}.json`.replace(/:/g, "-"));
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`report: ${file}`);
}

const codeHashOf = (wasm: Buffer) => {
  const digest = createHash("sha256").update(wasm).digest();
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${digest.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
};

/** Deploys out/bearer.wasm and adds staking in the same transaction, so no call sees one without the other. */
async function migrate() {
  if (process.env.CONFIRM_MIGRATE !== BEARER) throw new Error(`Run again with CONFIRM_MIGRATE=${BEARER} to replace its code.`);
  const wasm = readFileSync(WASM);
  const supplyBefore = await view<string>(BEARER, "nft_total_supply");
  const first = await view<{ owner_id: string; state: { kind: string } }>(BEARER, "vault", { token_id: "1" });
  const r = (await account(BEARER).signAndSendTransaction({
    receiverId: BEARER,
    actions: [actions.deployContract(wasm), actions.functionCall("migrate_add_staking", { staking_pool: POOL }, 100n * TGAS, 0n)],
    waitUntil: "FINAL",
  })) as unknown as Outcome;
  let codeHash = "";
  for (let i = 0; i < 20 && codeHash !== codeHashOf(wasm); i++) {
    codeHash = (await viewAccount(BEARER)).code_hash;
    if (codeHash !== codeHashOf(wasm)) await sleep(1000);
  }
  const report = {
    measured_at: new Date().toISOString(),
    contract: BEARER,
    tx: explorer(r.transaction.hash),
    code_hash: codeHash,
    wasm_code_hash: codeHashOf(wasm),
    staking: await staking(),
    vaults_before: supplyBefore,
    vaults_after: await view<string>(BEARER, "nft_total_supply"),
    vault_1_before: first,
    vault_1_after: await view<{ owner_id: string; state: { kind: string } }>(BEARER, "vault", { token_id: "1" }),
  };
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-staking-migrate", report);
}

/** Deploys a newer out/bearer.wasm whose state layout is unchanged; checks the state still reads. */
async function deploy() {
  if (process.env.CONFIRM_DEPLOY !== BEARER) throw new Error(`Run again with CONFIRM_DEPLOY=${BEARER} to replace its code.`);
  const wasm = readFileSync(WASM);
  const before = { staking: await staking(), supply: await view<string>(BEARER, "nft_total_supply") };
  const r = (await account(BEARER).signAndSendTransaction({ receiverId: BEARER, actions: [actions.deployContract(wasm)], waitUntil: "FINAL" })) as unknown as Outcome;
  let codeHash = "";
  for (let i = 0; i < 20 && codeHash !== codeHashOf(wasm); i++) {
    codeHash = (await viewAccount(BEARER)).code_hash;
    if (codeHash !== codeHashOf(wasm)) await sleep(1000);
  }
  const after = { staking: await staking(), supply: await view<string>(BEARER, "nft_total_supply") };
  const report = { measured_at: new Date().toISOString(), contract: BEARER, tx: explorer(r.transaction.hash), code_hash: codeHash, matches_wasm: codeHash === codeHashOf(wasm), before, after };
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-staking-deploy", report);
}

async function run() {
  const alice = account(ALICE);
  const bob = account(BOB);
  const carol = account(PARENT!);
  const s0 = await staking();
  if (s0.pool !== POOL) throw new Error(`${BEARER} stakes with ${s0.pool}, not ${POOL}`);
  const poolBefore = await poolAccount();

  // A sealed vault of alice's with 0.8 NEAR; she stakes 0.6 of it.
  const created = await tx(alice, "create_vault", { name: "Staking run", finish: "sage" }, CREATE_DEPOSIT, "alice creates a vault", null, 100n * TGAS);
  const id = JSON.parse(Buffer.from(created.status.SuccessValue as string, "base64").toString()) as string;
  await tx(alice, "deposit_near", { token_id: id }, 800n * MILLI, `alice puts 0.8 NEAR in vault ${id}`, null, 30n * TGAS);
  const held = await vaultNear(id);
  await tx(carol, "stake", { token_id: id, amount: (600n * MILLI).toString() }, ONE_YOCTO, "a stranger stakes alice's vault", "ERR_NOT_OWNER");
  await tx(alice, "stake", { token_id: id, amount: (600n * MILLI).toString() }, ONE_YOCTO, "alice stakes 0.6 NEAR from her sealed vault");
  const afterStake = { vault_near: (await vaultNear(id)).toString(), stake: await stakeOf(id), pool: await poolAccount(), staking: await staking() };
  const sealed = await view<{ state: { kind: string }; signatures_requested: number }>(BEARER, "vault", { token_id: id });
  await tx(alice, "withdraw_near", { token_id: id, receiver_id: ALICE, amount: (100n * MILLI).toString() }, ONE_YOCTO, "alice withdraws from her sealed vault", "ERR_VAULT_SEALED", 30n * TGAS);
  await tx(carol, "process_unstaking", {}, 0n, "anyone moves unstaking along with nothing asked", "ERR_NOTHING_TO_DO");

  // She hands it to bob, sealed; the stake goes with it.
  await tx(alice, "nft_transfer", { receiver_id: BOB, token_id: id }, ONE_YOCTO, "alice hands the vault to bob", null, 30n * TGAS);
  await tx(alice, "unstake", { token_id: id, amount: null }, ONE_YOCTO, "alice unstakes after handing it over", "ERR_NOT_OWNER");

  // bob unstakes twice: the first goes to the pool at once, the second waits for it to unlock.
  await tx(bob, "unstake", { token_id: id, amount: (200n * MILLI).toString() }, ONE_YOCTO, "bob unstakes 0.2 NEAR");
  const firstBatch = { staking: await staking(), stake: await stakeOf(id), pool: await poolAccount() };
  await tx(bob, "unstake", { token_id: id, amount: (100n * MILLI).toString() }, ONE_YOCTO, "bob unstakes 0.1 NEAR more while the first unlocks");
  const secondAsk = { staking: await staking(), stake: await stakeOf(id), pool: await poolAccount() };
  await tx(carol, "process_unstaking", {}, 0n, "anyone withdraws before it unlocks", "ERR_NOT_UNLOCKED");

  const report = {
    measured_at: new Date().toISOString(),
    contract: BEARER,
    code_hash: (await viewAccount(BEARER)).code_hash,
    pool: POOL,
    epoch: await epochHeight(),
    token_id: id,
    vault_near_before_stake: held.toString(),
    pool_before: poolBefore,
    after_stake: afterStake,
    sealed_after_stake: sealed,
    first_batch: firstBatch,
    second_request: secondAsk,
    second_request_left_the_pool_alone: secondAsk.pool.unstaked_balance === firstBatch.pool.unstaked_balance,
    owner_after: (await view<{ owner_id: string }>(BEARER, "vault", { token_id: id })).owner_id,
    steps,
  };
  console.log(JSON.stringify({ ...report, steps: undefined }, null, 2));
  saveReport("testnet-staking-run", report);
}

async function status() {
  const [s, pool, epoch] = await Promise.all([staking(), poolAccount(), epochHeight()]);
  const ids = (await view<{ token_id: string }[]>(BEARER, "nft_tokens", { from_index: "0", limit: 100 })).map((t) => t.token_id);
  const vaults = [];
  for (const id of ids) {
    const mine = await stakeOf(id);
    if (mine) vaults.push({ token_id: id, ...mine, worth_now: (await worth(id)).toString() });
  }
  const report = { measured_at: new Date().toISOString(), contract: BEARER, pool: POOL, epoch, staking: s, pool_account: pool, unlocks_at_epoch: s.unbonding === "0" ? null : s.unbonding_epoch + 4, vaults };
  console.log(JSON.stringify(report, null, 2));
  for (const v of vaults) console.log(`vault ${v.token_id}: worth ${near(v.worth_now)} NEAR now; queued ${near(v.queued)}, unbonding ${near(v.unbonding)}, ready ${near(v.ready)}`);
  return report;
}

async function processUnstaking() {
  const before = await status();
  const nearBefore = Object.fromEntries(await Promise.all(before.vaults.map(async (v) => [v.token_id, (await vaultNear(v.token_id)).toString()])));
  await tx(account(PARENT!), "process_unstaking", {}, 0n, "anyone moves unstaking along");
  const after = await status();
  const nearAfter = Object.fromEntries(await Promise.all(before.vaults.map(async (v) => [v.token_id, (await vaultNear(v.token_id)).toString()])));
  saveReport("testnet-staking-process", { measured_at: new Date().toISOString(), before, after, vault_near_before: nearBefore, vault_near_after: nearAfter, steps });
}

const cmd = process.argv[2];
if (cmd === "migrate") await migrate();
else if (cmd === "deploy") await deploy();
else if (cmd === "run") await run();
else if (cmd === "status") await status();
else if (cmd === "process") await processUnstaking();
else console.log("usage: node spike/staking-testnet.ts migrate|deploy|run|status|process");
