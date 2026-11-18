/**
 * House of Stake's Top Level Account contracts (houseofstake/tla-contracts), stood up on NEAR testnet
 * under a Bearer-owned stand-in for a TLA, bearer-tla.testnet. House of Stake's own testnet fleet
 * (hosdemo.testnet) can't rent names: its NEAR/USD rate stopped updating on 27 Aug 2026.
 *
 *   node spike/tla-testnet.ts fleet     # deploy and wire the fleet (idempotent)
 *   node spike/tla-testnet.ts status    # what's deployed, and whether it rents
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
import { Account, KeyPair, actions } from "near-api-js";

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
  console.log("TLA:", JSON.stringify(await view(REGISTRY, "get_tla", { tla_id: ROOT })));
  console.log("readiness:", JSON.stringify(await view(REGISTRY, "deployment_readiness")));
  const price = await view<{ total_yocto: string }>(REGISTRY, "get_rent_price", { tla_id: ROOT, name: "vault-0001" }).catch((e) => ({ error: String(e).slice(0, 160) }));
  console.log("a name costs:", JSON.stringify(price));
}

const [cmd] = process.argv.slice(2);
if (cmd === "fleet") await fleet();
else if (cmd === "status") await status();
else console.log("usage: node spike/tla-testnet.ts fleet|status");
