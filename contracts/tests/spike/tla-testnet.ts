/**
 * House of Stake's Top Level Account contracts (houseofstake/tla-contracts), stood up on NEAR testnet
 * under a Bearer-owned stand-in for a TLA, bearer-tla.testnet. House of Stake's own testnet fleet
 * (hosdemo.testnet) can't rent names: its NEAR/USD rate stopped updating on 27 Aug 2026.
 *
 *   node spike/tla-testnet.ts fleet     # deploy and wire the fleet (idempotent)
 *   node spike/tla-testnet.ts status    # what's deployed, and whether it rents
 *   node spike/tla-testnet.ts renew     # the council renews the TLA past the last possible renewal
 *   CONFIRM_LOCK=bearer-tla.testnet node spike/tla-testnet.ts lock   # delete every fleet key
 *
 * The code isn't built here: each contract is the exact bytes House of Stake runs on hosdemo.testnet,
 * fetched from the chain and checked against the code hash pinned below (registrar, registry and
 * extension from d12a84b, recovery from 7def42e). Names use House of Stake's own published wallet,
 * the global contract on impl.hosdemo.testnet.
 *
 * Keys come from ~/.near-credentials/testnet, never the repo.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, KeyPair, PublicKey, actions } from "near-api-js";

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const ROOT = process.env.TLA_ROOT ?? "bearer-tla.testnet";
const FUNDS = process.env.TLA_FUNDS ?? "bearer-tla-funds.testnet";
const COUNCIL = `council.${ROOT}`;
const REGISTRY = `registry.${ROOT}`;
const EXTENSION = `ext.${ROOT}`;
const RECOVERY = `rec.${ROOT}`;
/** House of Stake's tenant wallet, published as a global contract by account id. */
const WALLET_IMPL = "impl.hosdemo.testnet";
const CREDS = join(homedir(), ".near-credentials", "testnet");

/** Where each contract's code is fetched from, and the code hash it must have. */
const CODE = {
  registrar: { from: "hosdemo.testnet", hash: "FDJaArRGydBTN5XyvnViokgXE4Qn81rhupNA81xXKhuv", commit: "d12a84b" },
  tla_registry: { from: "registry.hosdemo.testnet", hash: "DYKXJSzjoAbJHfN9bpR3u3ggAaZoMA8hp1bWaswcUak6", commit: "d12a84b" },
  hos_extension: { from: "ext.hosdemo.testnet", hash: "FYqeTgwQXv6Q7y1vcF63S6QB3YqVMpJYakGB32Ln7qZt", commit: "d12a84b" },
  mpc_recovery: { from: "rec.hosdemo.testnet", hash: "GqFi2eCNZ3K6VZphTe9E3nJkTfKPvVQyDAunhebbiZAm", commit: "7def42e" },
} as const;
type CodeName = keyof typeof CODE;

const NEAR = 10n ** 24n;
const MILLI = 10n ** 21n;
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const SECOND = 1_000_000_000n;
const DAY = 86_400n * SECOND;
/** House of Stake's own testnet script uses 5 USD per NEAR; on testnet it only scales tiny rents. */
const NEAR_USD_MICRO = 5_000_000n;
/** Long enough that the rate never goes stale, which is what stopped hosdemo.testnet renting. */
const MAX_RATE_AGE_NS = 100n * 365n * DAY;
/** $0.001, what House of Stake charges per name on hosdemo.testnet. */
const TESTNET_RENT_USD_MICRO = "1000";

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

async function exists(id: string) {
  try {
    await viewAccount(id);
    return true;
  } catch {
    return false;
  }
}

async function initialised(id: string, method: string, args: object = {}) {
  try {
    await view(id, method, args);
    return true;
  } catch {
    return false;
  }
}

type Outcome = {
  transaction: { hash: string };
  status: { SuccessValue?: string; Failure?: unknown };
  transaction_outcome: { outcome: { gas_burnt: number } };
  receipts_outcome: { outcome: { executor_id: string; gas_burnt: number; status: Record<string, unknown>; logs: string[] } }[];
};

const steps: Record<string, unknown>[] = [];

async function tx(who: Account, receiverId: string, method: string, args: object, deposit: bigint, label: string, gas = 300n * TGAS) {
  const signed = await who.createSignedTransaction({ receiverId, actions: [actions.functionCall(method, args, gas, deposit)] });
  const r = await rpc<Outcome>("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "FINAL" });
  const failures = [r.status.Failure, ...r.receipts_outcome.map((x) => x.outcome.status.Failure)].filter(Boolean);
  const step = { step: label, by: who.accountId, call: `${receiverId}.${method}`, tx: explorer(r.transaction.hash), failed: failures.length ? JSON.stringify(failures).slice(0, 300) : null };
  steps.push(step);
  console.log(`${label}: ${step.failed ? `FAILED ${step.failed}` : "ok"} · ${step.tx}`);
  if (step.failed) throw new Error(`${label} failed`);
  return r;
}

/** The exact bytes House of Stake runs, fetched from the chain and checked against the pinned hash. */
async function code(name: CodeName) {
  const c = CODE[name];
  const r = await rpc<{ code_base64: string; hash: string }>("query", { request_type: "view_code", finality: "final", account_id: c.from });
  if (r.hash !== c.hash) throw new Error(`${c.from} now runs ${r.hash}, not the pinned ${c.hash}`);
  return Buffer.from(r.code_base64, "base64");
}

async function deployIfNeeded(id: string, name: CodeName) {
  const { code_hash } = await viewAccount(id);
  if (code_hash === CODE[name].hash) return console.log(`${id}: already runs ${name} (${CODE[name].hash.slice(0, 8)}…)`);
  const wasm = await code(name);
  const r = (await account(id).deployContract(wasm)) as unknown as Outcome;
  console.log(`${id}: deployed ${name} from ${CODE[name].from}, ${wasm.length.toLocaleString("en-US")} bytes · ${explorer(r.transaction.hash)}`);
  steps.push({ step: `deploy ${name}`, account: id, code_hash: CODE[name].hash, source: CODE[name].from, commit: CODE[name].commit, tx: explorer(r.transaction.hash) });
}

async function subAccount(prefix: string, near: bigint) {
  const id = `${prefix}.${ROOT}`;
  if (await exists(id)) return console.log(`${id}: exists`);
  const kp = KeyPair.fromRandom("ed25519");
  await account(ROOT).createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey(), nearToTransfer: near });
  writeFileSync(join(CREDS, `${id}.json`), JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
  console.log(`${id}: created with ${Number(near / MILLI) / 1000} NEAR`);
}

function saveReport(name: string, data: unknown) {
  const dir = join(import.meta.dirname, "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${new Date().toISOString().replace(/[:]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`report: ${file}`);
}

/* ---------- commands ---------- */

async function fleet() {
  // 1. Funding: the faucet gives 10 NEAR an account, and the fleet's code needs more than one.
  if ((await exists(FUNDS)) && BigInt((await viewAccount(FUNDS)).amount) > 9_600n * MILLI) {
    const funds = account(FUNDS);
    const r = (await funds.transfer({ receiverId: ROOT, amount: 9_500n * MILLI })) as unknown as Outcome;
    console.log(`moved 9.5 NEAR from ${FUNDS} to ${ROOT} · ${explorer(r.transaction.hash)}`);
  }

  // 2. Accounts, as in House of Stake's own testnet deploy.
  await subAccount("council", 500n * MILLI);
  await subAccount("registry", 6_000n * MILLI);
  await subAccount("ext", 2_800n * MILLI);
  await subAccount("rec", 3_000n * MILLI);

  // 3. Code: the bytes House of Stake runs.
  await deployIfNeeded(ROOT, "registrar");
  await deployIfNeeded(REGISTRY, "tla_registry");
  await deployIfNeeded(EXTENSION, "hos_extension");
  await deployIfNeeded(RECOVERY, "mpc_recovery");

  // 4. Initialise each, wired to the others.
  if (!(await initialised(ROOT, "min_balance"))) {
    await tx(account(ROOT), ROOT, "new", {
      config: {
        registry: REGISTRY,
        council: COUNCIL,
        wallet_impl: WALLET_IMPL,
        hos_extension: EXTENSION,
        recovery: RECOVERY,
        chain_id: "testnet",
        min_balance: (7n * MILLI).toString(),
        min_label_len: 3,
        wallet_timeout_secs: 3600,
      },
    }, 0n, "registrar: initialise on the TLA");
  }
  if (!(await initialised(EXTENSION, "get_version"))) {
    await tx(account(EXTENSION), EXTENSION, "new", { admin: COUNCIL, registry: REGISTRY, recovery: RECOVERY, treasury: COUNCIL, council: COUNCIL }, 0n, "extension: initialise");
  }
  if (!(await initialised(RECOVERY, "threshold"))) {
    // Two watchers whose private keys are thrown away: name recovery can never run on this fleet.
    const watchers = [KeyPair.fromRandom("ed25519"), KeyPair.fromRandom("ed25519")].map((k) => k.getPublicKey().toString());
    await tx(account(RECOVERY), RECOVERY, "new", { owner: COUNCIL, signer: "v1.signer-prod.testnet", transfer_authority: EXTENSION, watchers, threshold: 2 }, 0n, "recovery: initialise, with unusable watchers");
  }
  if (!(await initialised(REGISTRY, "get_fee_config"))) {
    await tx(account(REGISTRY), REGISTRY, "new", { admin: COUNCIL, hos_extension: EXTENSION, grace_period_ns: (7n * DAY).toString(), treasury: COUNCIL, council: COUNCIL }, 0n, "registry: initialise");
  }

  // 5. The council: a rate that can't go stale, the TLA opened, recovery wired both ways.
  const council = account(COUNCIL);
  if ((await view<string>(REGISTRY, "get_near_usd_rate")) === "0") {
    await tx(council, REGISTRY, "admin_set_initial_rate", { rate: NEAR_USD_MICRO.toString() }, 0n, "registry: set the NEAR/USD rate");
  }
  // Testnet rents as on hosdemo.testnet: $0.001 a year for any name.
  const fees = await view<Record<string, string>>(REGISTRY, "get_fee_config");
  const tiers = ["rent_tier_5_usd_micro", "rent_tier_8_usd_micro", "rent_tier_10_usd_micro", "rent_tier_12plus_usd_micro", "sub_fee_per_account_usd_micro"];
  if (BigInt(fees.max_rate_age_ns) < MAX_RATE_AGE_NS || tiers.some((t) => fees[t] !== TESTNET_RENT_USD_MICRO)) {
    const config = { ...fees, max_rate_age_ns: MAX_RATE_AGE_NS.toString(), ...Object.fromEntries(tiers.map((t) => [t, TESTNET_RENT_USD_MICRO])) };
    await tx(council, REGISTRY, "update_fee_config", { config }, ONE_YOCTO, "registry: testnet rents, and a rate that never goes stale");
  }
  if ((await view<{ name: string }>(REGISTRY, "nft_metadata")).name === REGISTRY) {
    await tx(council, REGISTRY, "admin_set_nft_metadata", { name: "Bearer vault names", symbol: "BVN", icon: null, base_uri: null, reference: null }, ONE_YOCTO, "registry: name the collection");
  }
  if (!(await view<unknown>(REGISTRY, "get_tla", { tla_id: ROOT }))) {
    await tx(council, REGISTRY, "register_tla", { tla_id: ROOT, tla_type: "Open", premium_category: "Standard", licensee: null }, ONE_YOCTO, `registry: register ${ROOT} as an open TLA`);
    await tx(council, REGISTRY, "activate_open_tla", { tla_id: ROOT }, 0n, `registry: activate ${ROOT}`);
  }
  if ((await view<string | null>(RECOVERY, "registry")) !== REGISTRY) {
    await tx(council, RECOVERY, "set_registry", { registry: REGISTRY }, ONE_YOCTO, "recovery: point at the registry");
  }
  if (!(await view<string[]>(REGISTRY, "get_recovery_authorities")).includes(RECOVERY)) {
    await tx(council, REGISTRY, "add_recovery_authority", { account_id: RECOVERY }, ONE_YOCTO, "registry: accept recovery");
  }

  await status();
  saveReport("testnet-tla-fleet", { measured_at: new Date().toISOString(), root: ROOT, registry: REGISTRY, extension: EXTENSION, recovery: RECOVERY, council: COUNCIL, wallet_impl: WALLET_IMPL, code: CODE, steps });
}

async function status() {
  for (const [id, name] of [[ROOT, "registrar"], [REGISTRY, "tla_registry"], [EXTENSION, "hos_extension"], [RECOVERY, "mpc_recovery"]] as const) {
    const a = await viewAccount(id);
    console.log(`${id}: ${a.code_hash === CODE[name].hash ? `runs House of Stake's ${name} (${CODE[name].commit})` : `code ${a.code_hash}`}, ${(Number(BigInt(a.amount) / MILLI) / 1000).toFixed(3)} NEAR`);
  }
  const tla = await view<{ expires_at: string }>(REGISTRY, "get_tla", { tla_id: ROOT });
  console.log("TLA:", JSON.stringify(tla));
  console.log(`TLA ends ${date(BigInt(tla.expires_at))}; the NEAR/USD rate goes stale ${date(await rateStaleAt())}`);
  for (const id of [ROOT, REGISTRY, EXTENSION, RECOVERY, COUNCIL]) {
    const { keys } = await rpc<{ keys: unknown[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: id });
    console.log(`${id}: ${keys.length ? `${keys.length} key(s)` : "no keys"}`);
  }
  console.log("readiness:", JSON.stringify(await view(REGISTRY, "deployment_readiness")));
  const price = await view<{ total_yocto: string }>(REGISTRY, "get_rent_price", { tla_id: ROOT, name: "vault-0001" }).catch((e) => ({ error: String(e).slice(0, 160) }));
  console.log("a name costs:", JSON.stringify(price));
}

/** House of Stake's ONE_YEAR_NS: each renewal adds 365 days to the current end. */
const YEAR = 365n * DAY;
const date = (ns: bigint) => new Date(Number(ns / 1_000_000n)).toISOString().slice(0, 10);

/**
 * When the registry's NEAR/USD rate goes stale. Only the price oracle (the council) can refresh it,
 * and every renewal, of the TLA or of a name, prices rent with it; after this nothing renews.
 */
async function rateStaleAt() {
  const meta = await view<{ updated_at: string }>(REGISTRY, "get_rate_meta");
  const fees = await view<{ max_rate_age_ns: string }>(REGISTRY, "get_fee_config");
  return BigInt(meta.updated_at) + BigInt(fees.max_rate_age_ns);
}

/**
 * The council renews the TLA, a year per call, until it ends a year after the rate goes stale: a
 * name renewed at the last possible moment then keeps its whole year. A name can be renewed past
 * its TLA, but once the TLA lapses every name under it becomes reclaimable, so this is what lets
 * the council's keys go (N8).
 */
async function renew() {
  const tla = await view<{ expires_at: string; annual_rent: string; lifecycle: string }>(REGISTRY, "get_tla", { tla_id: ROOT });
  if (tla.lifecycle !== "Active") throw new Error(`${ROOT} is ${tla.lifecycle}, not Active`);
  const staleAt = await rateStaleAt();
  const target = staleAt + YEAR;
  const before = BigInt(tla.expires_at);
  const years = before >= target ? 0n : (target - before + YEAR - 1n) / YEAR;
  console.log(`${ROOT} ends ${date(before)}; the rate goes stale ${date(staleAt)}; renewing ${years} year(s), to ${date(before + years * YEAR)}`);
  if (!years) return;

  // renew_tla prices the year from the stored rate. Attach exactly that, so no refund is left at the registry.
  const rate = BigInt(await view<string>(REGISTRY, "get_near_usd_rate"));
  const rent = (BigInt(tla.annual_rent) * NEAR) / rate;
  const council = account(COUNCIL);
  const call = (gas: bigint) => actions.functionCall("renew_tla", { tla_id: ROOT }, gas, rent);

  // One call first, to measure its gas; then the rest in batches that fit a transaction.
  const send = async (n: number, gas: bigint) => {
    const signed = await council.createSignedTransaction({ receiverId: REGISTRY, actions: Array.from({ length: n }, () => call(gas)) });
    const r = await rpc<Outcome>("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "FINAL" });
    const failures = [r.status.Failure, ...r.receipts_outcome.map((x) => x.outcome.status.Failure)].filter(Boolean);
    const burnt = r.receipts_outcome.filter((x) => x.outcome.executor_id === REGISTRY).reduce((s, x) => s + BigInt(x.outcome.gas_burnt), 0n);
    const step = { step: `renew_tla × ${n}`, by: COUNCIL, call: `${REGISTRY}.renew_tla`, paid_yocto: (rent * BigInt(n)).toString(), tx: explorer(r.transaction.hash), failed: failures.length ? JSON.stringify(failures).slice(0, 300) : null };
    steps.push(step);
    console.log(`${step.step}: ${step.failed ? `FAILED ${step.failed}` : "ok"} · ${step.tx}`);
    if (step.failed) throw new Error("renewal failed");
    return burnt;
  };
  const burnt = await send(1, 30n * TGAS);
  const perCall = ((burnt * 3n) / 2n / TGAS + 1n) * TGAS;
  const perTx = Number(290n * TGAS / perCall);
  for (let left = Number(years) - 1; left > 0; left -= perTx) await send(Math.min(left, perTx), perCall);

  const after = BigInt((await view<{ expires_at: string }>(REGISTRY, "get_tla", { tla_id: ROOT })).expires_at);
  console.log(`${ROOT} now ends ${date(after)}`);
  if (after < target) throw new Error(`${ROOT} ends ${date(after)}, before ${date(target)}`);
  saveReport("testnet-tla-renew", { measured_at: new Date().toISOString(), tla: ROOT, registry: REGISTRY, by: COUNCIL, years: Number(years), rent_per_year_yocto: rent.toString(), expires_before_ns: before.toString(), expires_after_ns: after.toString(), expires_after: date(after), rate_stale_at_ns: staleAt.toString(), rate_stale_at: date(staleAt), gas_per_renewal: burnt.toString(), steps });
}

/**
 * Deletes every key on the fleet: the TLA's registrar, the registry, the extension, recovery, and
 * the council last. Every admin role on the fleet is the council, so afterwards nobody can change
 * fees or the rate, suspend the TLA, add a recovery authority, approve an upgrade or renew the TLA
 * again (N8). What stays is House of Stake's shared wallet code on impl.hosdemo.testnet (N10).
 */
async function lock() {
  if (process.env.CONFIRM_LOCK !== ROOT) throw new Error(`Locking ${ROOT}'s fleet can't be undone. Run again with CONFIRM_LOCK=${ROOT}.`);

  // Guards: the pinned code everywhere, the council the only power, and the TLA renewed for good.
  for (const [id, name] of [[ROOT, "registrar"], [REGISTRY, "tla_registry"], [EXTENSION, "hos_extension"], [RECOVERY, "mpc_recovery"]] as const) {
    const { code_hash } = await viewAccount(id);
    if (code_hash !== CODE[name].hash) throw new Error(`${id} runs ${code_hash}, not House of Stake's ${name}; refusing to lock`);
  }
  const powers = {
    admins: await view<string[]>(REGISTRY, "get_admins"),
    council: await view<string>(REGISTRY, "get_council"),
    price_oracle: await view<string>(REGISTRY, "get_price_oracle"),
    recovery_authorities: await view<string[]>(REGISTRY, "get_recovery_authorities"),
    payment_authorities: await view<string[]>(REGISTRY, "get_payment_authorities"),
    venues: await view<string[]>(REGISTRY, "get_venues"),
    approved_upgrade_hash: await view<string | null>(REGISTRY, "approved_upgrade_hash"),
    paused: await view<boolean>(REGISTRY, "is_paused"),
  };
  const expected = { admins: [COUNCIL], council: COUNCIL, price_oracle: COUNCIL, recovery_authorities: [RECOVERY], payment_authorities: [], venues: [], approved_upgrade_hash: null, paused: false };
  if (JSON.stringify(powers) !== JSON.stringify(expected)) throw new Error(`the registry's roles aren't as set up: ${JSON.stringify(powers)}`);
  const tla = await view<{ expires_at: string; lifecycle: string }>(REGISTRY, "get_tla", { tla_id: ROOT });
  const staleAt = await rateStaleAt();
  if (tla.lifecycle !== "Active" || BigInt(tla.expires_at) < staleAt + YEAR) throw new Error(`${ROOT} ends ${date(BigInt(tla.expires_at))}; run renew first`);

  type Keys = { keys: { public_key: string }[] };
  const keyList = (id: string) => rpc<Keys>("query", { request_type: "view_access_key_list", finality: "final", account_id: id });
  const locked: Record<string, unknown>[] = [];
  for (const id of [ROOT, REGISTRY, EXTENSION, RECOVERY, COUNCIL]) {
    const { keys } = await keyList(id);
    if (!keys.length) {
      console.log(`${id}: already locked`);
      locked.push({ account: id, deleted_keys: [], tx: null, keys_after: 0 });
      continue;
    }
    const own = (JSON.parse(readFileSync(join(CREDS, `${id}.json`), "utf8")) as { public_key: string }).public_key;
    const ordered = [...keys.filter((k) => k.public_key !== own), ...keys.filter((k) => k.public_key === own)];
    const r = (await account(id).signAndSendTransaction({
      receiverId: id,
      actions: ordered.map((k) => actions.deleteKey(PublicKey.fromString(k.public_key))),
      waitUntil: "FINAL",
    })) as unknown as Outcome;
    const after = await keyList(id);
    console.log(`${id}: deleted ${ordered.length} key(s), ${after.keys.length} left · ${explorer(r.transaction.hash)}`);
    locked.push({ account: id, deleted_keys: ordered.map((k) => k.public_key), tx: explorer(r.transaction.hash), keys_after: after.keys.length });
    if (after.keys.length) throw new Error(`${id} still has ${after.keys.length} key(s)`);
  }
  const report = { measured_at: new Date().toISOString(), tla: ROOT, tla_expires_at: date(BigInt(tla.expires_at)), rate_stale_at: date(staleAt), powers, locked, wallet_impl: WALLET_IMPL, not_ours: `${WALLET_IMPL} is House of Stake's; its keys stay` };
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-tla-lock", report);
}

const [cmd] = process.argv.slice(2);
if (cmd === "fleet") await fleet();
else if (cmd === "status") await status();
else if (cmd === "renew") await renew();
else if (cmd === "lock") await lock();
else console.log("usage: node spike/tla-testnet.ts fleet|status|renew|lock");
