/**
 * Vault names on NEAR testnet: contracts/names on bearer-names.testnet, renting from House of
 * Stake's TLA contracts under bearer-tla.testnet (spike/tla-testnet.ts), for vaults on the locked
 * Bearer contract (bearer.testnet).
 *
 *   node spike/names-testnet.ts setup   # deploy NAMES_WASM and initialise
 *   node spike/names-testnet.ts run     # name vaults, fund them, and show who can take the NEAR out
 *   node spike/names-testnet.ts refusal # alice asks to name a vault she doesn't hold; her deposit comes back (N2, N7)
 *   node spike/names-testnet.ts reclaim # bring back the refunds the registry holds for the contract (N7)
 *   CONFIRM_LOCK=bearer-names.testnet node spike/names-testnet.ts lock   # delete every key
 *
 * Keys come from ~/.near-credentials/testnet, never the repo. Every number in the report is
 * measured on testnet.
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
const NAMES = process.env.NAMES_CONTRACT_ID ?? "bearer-names.testnet";
const TLA = process.env.TLA_ROOT ?? "bearer-tla.testnet";
const REGISTRY = `registry.${TLA}`;
const FUNDS = process.env.TLA_FUNDS ?? "bearer-tla-funds.testnet";
const ALICE = `alice.${PARENT}`;
const BOB = `bob.${PARENT}`;
/** Opened, held by bob. */
const OPENED_VAULT = process.env.NAMES_OPENED_VAULT ?? "1";
const NAMES_WASM = process.env.NAMES_WASM ?? join(import.meta.dirname, "..", "..", "res", "names.wasm");
const CREDS = join(homedir(), ".near-credentials", "testnet");

const MILLI = 10n ** 21n;
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const CREATE_DEPOSIT = 50n * MILLI;

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
  rpc<{ amount: string; code_hash: string; global_contract_account_id?: string }>("query", { request_type: "view_account", finality: "final", account_id: id });
const keysOf = async (id: string) => (await rpc<{ keys: unknown[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: id })).keys.length;
const balance = async (id: string) => BigInt((await viewAccount(id)).amount);

type Outcome = {
  transaction: { hash: string };
  status: { SuccessValue?: string; Failure?: unknown };
  transaction_outcome: { outcome: { gas_burnt: number } };
  receipts_outcome: { outcome: { executor_id: string; gas_burnt: number; status: Record<string, unknown>; logs: string[] } }[];
};

const steps: Record<string, unknown>[] = [];

/** Signs here and sends with send_tx; returns the outcome and the NEP-297 events it logged. */
async function tx(who: Account, receiverId: string, method: string, args: object, deposit: bigint, label: string, opts: { expect?: string; event?: string; gas?: bigint } = {}) {
  const signed = await who.createSignedTransaction({ receiverId, actions: [actions.functionCall(method, args, opts.gas ?? 300n * TGAS, deposit)] });
  const r = await rpc<Outcome>("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "FINAL" });
  const failures = [r.status.Failure, ...r.receipts_outcome.map((x) => x.outcome.status.Failure)].filter(Boolean);
  const code = failures.length ? (JSON.stringify(failures).match(/ERR_[A-Z_]+/)?.[0] ?? "failed") : null;
  const events = r.receipts_outcome
    .flatMap((x) => x.outcome.logs)
    .filter((l) => l.startsWith("EVENT_JSON:"))
    .map((l) => JSON.parse(l.slice(11)) as { standard: string; event: string; data: Record<string, unknown>[] });
  const ours = events.filter((e) => e.standard === "bearer_names");
  const tgas = (r.transaction_outcome.outcome.gas_burnt + r.receipts_outcome.reduce((s, x) => s + x.outcome.gas_burnt, 0)) / 1e12;
  const step = { step: label, by: who.accountId, call: `${receiverId}.${method}`, tx: explorer(r.transaction.hash), tgas: Math.round(tgas * 1000) / 1000, refused: code, events: events.map((e) => `${e.standard}:${e.event}`), bearer_names: ours };
  steps.push(step);
  console.log(`${label}: ${code ? `refused, ${code}` : "ok"} · ${step.tgas} Tgas · ${step.events.join(", ") || "no events"} · ${step.tx}`);
  if (opts.expect !== undefined ? code !== opts.expect : code) throw new Error(`${label}: expected ${opts.expect ?? "success"}, got ${code ?? "success"}`);
  if (opts.event && !ours.some((e) => e.event === opts.event)) throw new Error(`${label}: expected a ${opts.event} event, got ${ours.map((e) => e.event).join(", ") || "none"}`);
  return { r, ours };
}

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

const label = (tokenId: string) => `vault-${tokenId.padStart(4, "0")}`;
const near = (yocto: bigint) => `${(Number(yocto / 10n ** 18n) / 1e6).toFixed(6)} NEAR`;

/* ---------- commands ---------- */

async function setup() {
  const wasm = readFileSync(NAMES_WASM);
  const s = account(NAMES);
  if ((await viewAccount(NAMES)).code_hash !== codeHashOf(wasm)) await s.deployContract(wasm);
  let hash = "";
  for (let i = 0; i < 20 && hash !== codeHashOf(wasm); i++) {
    if (i) await sleep(1000);
    hash = (await viewAccount(NAMES)).code_hash;
  }
  try {
    await view(NAMES, "get_config");
    console.log("already initialised");
  } catch {
    await tx(s, NAMES, "new", { nft_contract: BEARER, registry: REGISTRY, tla: TLA }, 0n, "initialise");
  }
  console.log(`${NAMES}: code ${hash} (${hash === codeHashOf(wasm) ? "matches" : "DIFFERS from"} ${relative(join(import.meta.dirname, "..", "..", ".."), NAMES_WASM)})`);
  console.log(JSON.stringify(await view(NAMES, "get_config")));
}

async function nameVault(who: Account, tokenId: string) {
  const existing = await view<string | null>(NAMES, "name_of", { token_id: tokenId });
  if (existing) return existing;
  const price = await view<{ total_yocto: string }>(REGISTRY, "get_rent_price", { tla_id: TLA, name: label(tokenId) });
  await tx(who, NAMES, "name_vault", { token_id: tokenId, label: label(tokenId) }, BigInt(price.total_yocto), `${who.accountId.split(".")[0]} names vault ${tokenId} "${label(tokenId)}" (${near(BigInt(price.total_yocto))})`, { event: "named", gas: 240n * TGAS });
  return (await view<string | null>(NAMES, "name_of", { token_id: tokenId })) as string;
}

async function describe(name: string) {
  const [a, keys, ext, item, token] = await Promise.all([
    viewAccount(name),
    keysOf(name),
    view<string[]>(name, "w_extensions"),
    view<Record<string, unknown>>(name, "nft_item_info"),
    view<Record<string, unknown>>(REGISTRY, "nft_token", { token_id: name }),
  ]);
  const d = { account: name, balance: near(BigInt(a.amount)), code: a.global_contract_account_id ?? a.code_hash, access_keys: keys, extensions: ext, item_owner: item.owner_id, item_status: item.status, registry_token_owner: (token as { owner_id?: string })?.owner_id };
  console.log(`  ${name}: ${d.balance}, ${keys} access keys, runs ${d.code}; owner ${d.item_owner} (${d.item_status}); extensions ${ext.join(", ")}`);
  return d;
}

async function run() {
  const alice = account(ALICE);
  const bob = account(BOB);
  const funds = account(FUNDS);
  const stranger = account(PARENT!);
  const facts: Record<string, unknown> = {};

  // 1. An opened vault: named, funded, and only its holder takes the NEAR out.
  const v1 = await view<{ owner_id: string; state: { kind: string } }>(BEARER, "vault", { token_id: OPENED_VAULT });
  if (v1.owner_id !== BOB || v1.state.kind !== "opened") throw new Error(`vault ${OPENED_VAULT} isn't bob's opened vault`);
  const name1 = await nameVault(bob, OPENED_VAULT);
  facts.opened = await describe(name1);
  await funds.transfer({ receiverId: name1, amount: 50n * MILLI });
  console.log(`  ${FUNDS} paid 0.05 NEAR into ${name1}`);
  await tx(stranger, NAMES, "name_vault", { token_id: OPENED_VAULT, label: "someone-else" }, 11n * MILLI, "a stranger names vault 1 again", { expect: "ERR_ALREADY_NAMED", gas: 30n * TGAS });
  await tx(alice, NAMES, "withdraw", { token_id: OPENED_VAULT, receiver_id: ALICE, amount: (10n * MILLI).toString() }, ONE_YOCTO, "alice takes NEAR out of vault 1's name", { event: "withdrawal_refused", gas: 100n * TGAS });
  const before1 = await balance(name1);
  await tx(bob, NAMES, "withdraw", { token_id: OPENED_VAULT, receiver_id: BOB, amount: (20n * MILLI).toString() }, ONE_YOCTO, "bob, holding opened vault 1, takes out 0.02 NEAR", { event: "withdrawn", gas: 100n * TGAS });
  await sleep(3000);
  const after1 = await balance(name1);
  console.log(`  ${name1}: ${near(before1)} → ${near(after1)}`);
  facts.withdrawn_yocto = (before1 - after1).toString();

  // 2. A sealed vault: named and funded by alice, handed to bob with its NEAR still inside.
  const r = await tx(alice, BEARER, "create_vault", { name: "Named on a TLA", finish: "ivory" }, CREATE_DEPOSIT, "alice creates a sealed vault", { gas: 100n * TGAS });
  const sealedId = JSON.parse(Buffer.from(r.r.status.SuccessValue as string, "base64").toString()) as string;
  const name2 = await nameVault(alice, sealedId);
  await funds.transfer({ receiverId: name2, amount: 30n * MILLI });
  console.log(`  ${FUNDS} paid 0.03 NEAR into ${name2}`);
  facts.sealed = await describe(name2);
  await tx(alice, NAMES, "withdraw", { token_id: sealedId, receiver_id: ALICE, amount: (10n * MILLI).toString() }, ONE_YOCTO, `alice takes NEAR out of sealed vault ${sealedId}'s name`, { event: "withdrawal_refused", gas: 100n * TGAS });
  await tx(alice, BEARER, "nft_transfer", { receiver_id: BOB, token_id: sealedId }, ONE_YOCTO, `alice hands sealed vault ${sealedId} to bob`, { gas: 30n * TGAS });
  await tx(alice, NAMES, "withdraw", { token_id: sealedId, receiver_id: ALICE, amount: (10n * MILLI).toString() }, ONE_YOCTO, "alice, its former holder, tries again", { event: "withdrawal_refused", gas: 100n * TGAS });
  await tx(bob, NAMES, "withdraw", { token_id: sealedId, receiver_id: BOB, amount: (10n * MILLI).toString() }, ONE_YOCTO, "bob, holding it still sealed", { event: "withdrawal_refused", gas: 100n * TGAS });
  await tx(bob, BEARER, "break_seal", { token_id: sealedId }, ONE_YOCTO, `bob breaks vault ${sealedId}'s seal`, { gas: 30n * TGAS });
  const before2 = await balance(name2);
  await tx(bob, NAMES, "withdraw", { token_id: sealedId, receiver_id: BOB, amount: (20n * MILLI).toString() }, ONE_YOCTO, "bob, holding it opened, takes out 0.02 NEAR", { event: "withdrawn", gas: 100n * TGAS });
  await sleep(3000);
  const after2 = await balance(name2);
  console.log(`  ${name2}: ${near(before2)} → ${near(after2)}`);
  facts.sealed_after = await describe(name2);

  saveReport("testnet-names-run", { measured_at: new Date().toISOString(), contract: NAMES, registry: REGISTRY, tla: TLA, opened_vault: OPENED_VAULT, sealed_vault: sealedId, facts, steps });
}

/** alice asks to name a vault someone else holds: refused, and refunded at once from the contract (N2, N7). */
async function refusal() {
  const alice = account(ALICE);
  let target = "";
  for (let id = 2; id <= 40 && !target; id++) {
    const v = await view<{ owner_id: string } | null>(BEARER, "vault", { token_id: String(id) });
    if (v && v.owner_id !== ALICE && !(await view<string | null>(NAMES, "name_of", { token_id: String(id) }))) target = String(id);
  }
  if (!target) throw new Error("no unnamed vault held by someone other than alice");
  const price = BigInt((await view<{ total_yocto: string }>(REGISTRY, "get_rent_price", { tla_id: TLA, name: label(target) })).total_yocto);
  const { r } = await tx(alice, NAMES, "name_vault", { token_id: target, label: label(target) }, price, `alice names vault ${target}, which she doesn't hold`, { event: "naming_refused", gas: 240n * TGAS });
  const refund = r.receipts_outcome.find((x) => x.outcome.executor_id === ALICE && x.outcome.status.SuccessValue !== undefined);
  console.log(`  name_of(${target}) = ${await view(NAMES, "name_of", { token_id: target })}; held for claim: ${await view(NAMES, "claimable_of", { account_id: ALICE })}; refund receipt to alice: ${refund ? "yes" : "no"}`);
  saveReport("testnet-names-refusal", { measured_at: new Date().toISOString(), contract: NAMES, vault: target, attached_yocto: price.toString(), steps });
}

/** Anyone brings back what the registry holds for the names contract: the quote's padding on each rent (N7). */
async function reclaim() {
  const pending = async () => BigInt(await view<string>(REGISTRY, "get_pending_refund", { account_id: NAMES }));
  const before = { pending: await pending(), balance: await balance(NAMES) };
  console.log(`  ${REGISTRY} holds ${near(before.pending)} for ${NAMES}`);
  if (!before.pending) return console.log("  nothing to bring back");
  const r = await tx(account(PARENT!), NAMES, "reclaim", {}, 0n, `${PARENT} asks the registry to send it back`, { gas: 50n * TGAS });
  await sleep(3000);
  const after = { pending: await pending(), balance: await balance(NAMES) };
  console.log(`  ${REGISTRY} now holds ${near(after.pending)}; ${NAMES}: ${near(before.balance)} → ${near(after.balance)}`);
  saveReport("testnet-names-reclaim", { measured_at: new Date().toISOString(), contract: NAMES, registry: REGISTRY, pending_before_yocto: before.pending.toString(), pending_after_yocto: after.pending.toString(), balance_before_yocto: before.balance.toString(), balance_after_yocto: after.balance.toString(), tx: explorer(r.r.transaction.hash), steps });
}

/** Deletes every access key on the names account (N9). Same guards as the other contracts' locks. */
async function lock() {
  if (process.env.CONFIRM_LOCK !== NAMES) throw new Error(`Locking ${NAMES} can't be undone. Run again with CONFIRM_LOCK=${NAMES}.`);
  const expected = codeHashOf(readFileSync(NAMES_WASM));
  const { code_hash } = await viewAccount(NAMES);
  if (code_hash !== expected) throw new Error(`${NAMES} runs ${code_hash}, not the given build (${expected}); refusing to lock`);
  type Keys = { keys: { public_key: string }[] };
  const keyList = () => rpc<Keys>("query", { request_type: "view_access_key_list", finality: "final", account_id: NAMES });
  const { keys } = await keyList();
  if (!keys.length) return console.log(`${NAMES} is already locked`);
  const own = (JSON.parse(readFileSync(join(CREDS, `${NAMES}.json`), "utf8")) as { public_key: string }).public_key;
  const ordered = [...keys.filter((k) => k.public_key !== own), ...keys.filter((k) => k.public_key === own)];
  const r = (await account(NAMES).signAndSendTransaction({
    receiverId: NAMES,
    actions: ordered.map((k) => actions.deleteKey(PublicKey.fromString(k.public_key))),
    waitUntil: "FINAL",
  })) as unknown as Outcome;
  const after = await keyList();
  const report = { measured_at: new Date().toISOString(), contract: NAMES, code_hash, wasm: relative(join(import.meta.dirname, "..", "..", ".."), NAMES_WASM), deleted_keys: ordered.map((k) => k.public_key), tx: explorer(r.transaction.hash), keys_after: after.keys.length };
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-names-lock", report);
  if (after.keys.length) throw new Error(`${NAMES} still has ${after.keys.length} key(s)`);
}

const [cmd] = process.argv.slice(2);
if (cmd === "setup") await setup();
else if (cmd === "run") await run();
else if (cmd === "refusal") await refusal();
else if (cmd === "reclaim") await reclaim();
else if (cmd === "lock") await lock();
else console.log("usage: node spike/names-testnet.ts setup|run|refusal|reclaim|lock");
