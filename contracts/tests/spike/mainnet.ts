/**
 * One Bearer vault on NEAR mainnet, with a real transfer on Base mainnet.
 *
 * The contract is the exact build locked on testnet (contracts/res/bearer.wasm, reproducibly built
 * from 71f194e), initialised for mainnet: NEAR's MPC signer `v1.signer` and Base (chain 8453).
 * Bitcoin mainnet isn't possible with this build: it refuses `bc1` addresses on purpose.
 *
 * Every step that spends NEAR or ETH is run by the person whose accounts they are, and refuses to
 * run unless CONFIRM_MAINNET names that step. Read-only steps need no confirmation.
 *
 *   MAINNET_PARENT=you.near node spike/mainnet.ts plan                              # read-only
 *   CONFIRM_MAINNET=deploy    … node spike/mainnet.ts deploy     # parent creates bearer.<parent>, ~3.6 NEAR
 *   CONFIRM_MAINNET=create    … node spike/mainnet.ts create     # holder mints vault 1, 0.05 NEAR
 *   (the holder sends a little Base ETH to the vault's address, from their own wallet)
 *   node spike/mainnet.ts status                                                    # read-only
 *   CONFIRM_MAINNET=handover  … node spike/mainnet.ts handover   # holder hands it on, sealed
 *   CONFIRM_MAINNET=withdraw  BASE_TO=0x… node spike/mainnet.ts withdraw  # recipient opens it; MPC signs
 *   CONFIRM_MAINNET=broadcast … node spike/mainnet.ts broadcast  # the signed transfer, sent to Base
 *   CONFIRM_LOCK=bearer.<parent> node spike/mainnet.ts lock      # delete the contract's key
 *
 * Accounts: MAINNET_PARENT (creates the contract account), MAINNET_CONTRACT (default
 * bearer.<parent>), MAINNET_HOLDER (default the parent), MAINNET_RECIPIENT (a second account).
 * Keys come from ~/.near-credentials/mainnet, never the repo, and are never printed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, KeyPair, PublicKey, actions } from "near-api-js";
import { decodeFunctionResult, encodeFunctionData, getAddress, parseTransaction, recoverTransactionAddress, type TransactionSerializedEIP1559 } from "viem";

const RPC = process.env.NEAR_MAINNET_RPC ?? "https://rpc.mainnet.fastnear.com";
const BASE_RPC = process.env.BASE_MAINNET_RPC ?? "https://mainnet.base.org";
const BASE_CHAIN_ID = 8453;
const SIGNER = "v1.signer";
/** What bearer.testnet runs: the locked, reproducible build. Mainnet runs the same bytes. */
const TESTNET_TWIN = "bearer.testnet";
const WASM = join(import.meta.dirname, "..", "..", "res", "bearer.wasm");
const BASE_URI = "https://bearer-near.vercel.app/nft/mainnet";

const PARENT = process.env.MAINNET_PARENT;
const CONTRACT = process.env.MAINNET_CONTRACT ?? (PARENT ? `bearer.${PARENT}` : undefined);
const HOLDER = process.env.MAINNET_HOLDER ?? PARENT;
const RECIPIENT = process.env.MAINNET_RECIPIENT;
const TOKEN_ID = process.env.MAINNET_TOKEN_ID ?? "1";
const CREDS = join(homedir(), ".near-credentials", "mainnet");

const MILLI = 10n ** 21n;
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
/** 345 KB of code at 1 NEAR per 100 KB is 3.45 NEAR; the rest covers state and the contract's own gas. */
const CONTRACT_NEAR = BigInt(Math.round(Number(process.env.MAINNET_CONTRACT_NEAR ?? "3.6") * 1000)) * MILLI;
/** The same settings as bearer.testnet, with Base mainnet in place of Base Sepolia. */
const CONFIG = {
  evm_chain_ids: [BASE_CHAIN_ID],
  max_btc_inputs: 4,
  create_deposit: (50n * MILLI).toString(),
  withdraw_deposit: (10n * MILLI).toString(),
  mpc_sign_deposit: "1",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const explorer = (hash: string) => `https://nearblocks.io/txns/${hash}`;
const baseExplorer = (hash: string) => `https://basescan.org/tx/${hash}`;
const near = (yocto: bigint) => `${(Number(yocto / 10n ** 18n) / 1e6).toFixed(6)} NEAR`;
const eth = (wei: bigint) => `${(Number(wei / 10n ** 9n) / 1e9).toFixed(9)} ETH`;

function need<T>(value: T | null | undefined, what: string): T {
  if (!value) throw new Error(`Set ${what}.`);
  return value;
}

function confirm(step: string) {
  if (process.env.CONFIRM_MAINNET !== step) throw new Error(`This step spends real funds on mainnet. Run it again with CONFIRM_MAINNET=${step}.`);
}

/** near-cli writes <id>.json; near-cli-rs's legacy keychain also writes <id>/<public key>.json. */
function keyFile(id: string) {
  const flat = join(CREDS, `${id}.json`);
  if (existsSync(flat)) return flat;
  const dir = join(CREDS, id);
  const file = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(".json")) : undefined;
  return file ? join(dir, file) : null;
}

function account(id: string) {
  const file = keyFile(id);
  if (!file) throw new Error(`No key for ${id} in ${CREDS}. Import it first (near-cli-rs: near account import-account, then save to the legacy keychain).`);
  const { private_key } = JSON.parse(readFileSync(file, "utf8"));
  return new Account(id, RPC, private_key);
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const body = await res.json();
    const err = body.error ?? body.result?.error;
    if (err && attempt < 20 && /TIMEOUT|UNKNOWN_TRANSACTION|timeout|429/i.test(JSON.stringify(err))) {
      await sleep(1500);
      continue;
    }
    if (err) throw new Error(`${method}: ${JSON.stringify(err).slice(0, 400)}`);
    return body.result as T;
  }
}

async function view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", { request_type: "call_function", finality: "final", account_id: contractId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
}

const viewAccount = (id: string) => rpc<{ amount: string; locked: string; code_hash: string; storage_usage: number }>("query", { request_type: "view_account", finality: "final", account_id: id });
const keyCount = async (id: string) => (await rpc<{ keys: unknown[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: id })).keys.length;
async function exists(id: string) {
  try {
    await viewAccount(id);
    return true;
  } catch {
    return false;
  }
}

async function baseRpc<T>(method: string, params: unknown[]): Promise<T> {
  const body = await fetch(BASE_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
  if (body.error) throw new Error(`Base ${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
  return body.result as T;
}

/** base58(sha256(wasm)), NEAR's code hash. */
function codeHashOf(bytes: Buffer) {
  const digest = createHash("sha256").update(bytes).digest();
  const a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${digest.toString("hex")}`);
  let s = "";
  while (n > 0n) {
    s = a[Number(n % 58n)] + s;
    n /= 58n;
  }
  return s;
}

type Outcome = {
  transaction: { hash: string };
  status: { SuccessValue?: string; Failure?: unknown };
  receipts_outcome: { outcome: { executor_id: string; gas_burnt: number; status: Record<string, unknown>; logs: string[] } }[];
};

async function send(who: Account, receiverId: string, acts: ReturnType<typeof actions.functionCall>[], label: string) {
  const signed = await who.createSignedTransaction({ receiverId, actions: acts });
  const r = await rpc<Outcome>("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "FINAL" });
  const failures = [r.status.Failure, ...r.receipts_outcome.map((x) => x.outcome.status.Failure)].filter(Boolean);
  const gas = r.receipts_outcome.reduce((s, x) => s + BigInt(x.outcome.gas_burnt), 0n);
  console.log(`${label}: ${failures.length ? `FAILED ${JSON.stringify(failures).slice(0, 300)}` : "ok"} · ${(Number(gas / 10n ** 9n) / 1000).toFixed(1)} Tgas · ${explorer(r.transaction.hash)}`);
  if (failures.length) throw new Error(`${label} failed`);
  return r;
}

function saveReport(name: string, data: unknown) {
  const dir = join(import.meta.dirname, "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${new Date().toISOString().replace(/[:]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`report: ${file}`);
}

type VaultView = { token_id: string; owner_id: string; state: { kind: string }; signatures_requested: number; withdrawal_count: number; evm_address: string | null; keys: unknown };
type Withdrawal = { index: number; status: string; error: string | null; signed_raw_tx: string | null; payload_hashes: string[] };

const isSealed = (v: VaultView) => v.state.kind === "sealed" && v.signatures_requested === 0;

/* ---------- commands ---------- */

async function plan() {
  const wasm = readFileSync(WASM);
  const hash = codeHashOf(wasm);
  const twin = await fetch("https://test.rpc.fastnear.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: TESTNET_TWIN } }) }).then((r) => r.json());
  console.log(`build: contracts/res/bearer.wasm, ${wasm.length.toLocaleString("en-US")} bytes, code hash ${hash} (${twin.result?.code_hash === hash ? "the same as" : "DIFFERENT from"} ${TESTNET_TWIN})`);
  console.log(`signer: ${SIGNER} ${await view<string>(SIGNER, "version")}`);
  console.log(`Base: chain ${parseInt(await baseRpc<string>("eth_chainId", []), 16)} at ${BASE_RPC}`);
  for (const [role, id] of [["parent", PARENT], ["contract", CONTRACT], ["holder", HOLDER], ["recipient", RECIPIENT]] as const) {
    if (!id) {
      console.log(`${role}: not set`);
      continue;
    }
    const there = await exists(id);
    const balance = there ? near(BigInt((await viewAccount(id)).amount)) : "";
    console.log(`${role}: ${id} · ${there ? `exists, ${balance}` : "doesn't exist yet"} · key on this machine: ${keyFile(id) ? "yes" : "no"}`);
  }
  console.log(`
Costs, all real:
  deploy     the parent sends ${near(CONTRACT_NEAR)} to ${CONTRACT ?? "bearer.<parent>"}: ~3.45 NEAR of it pays for the code's storage
             and stays there; after the lock nobody can take any of it out
  create     the holder attaches 0.05 NEAR (the vault's storage) and ~0.01 NEAR of gas
  deposit    the holder sends a little ETH on Base to the vault's address, from their own wallet
  handover   1 yoctoNEAR and ~0.001 NEAR of gas
  withdraw   the recipient attaches 0.01 NEAR + 1 yoctoNEAR (the record) and ~0.02 NEAR of gas
  broadcast  Base gas, paid from the vault's ETH: a fraction of a cent`);
}

async function deploy() {
  confirm("deploy");
  const parent = need(PARENT, "MAINNET_PARENT");
  const id = need(CONTRACT, "MAINNET_CONTRACT");
  const wasm = readFileSync(WASM);
  const hash = codeHashOf(wasm);

  if (!(await exists(id))) {
    const kp = KeyPair.fromRandom("ed25519");
    mkdirSync(CREDS, { recursive: true });
    // Saved before the account exists, so the key can't be lost if the script stops halfway.
    writeFileSync(join(CREDS, `${id}.json`), JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
    const r = (await account(parent).createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey(), nearToTransfer: CONTRACT_NEAR })) as unknown as Outcome;
    console.log(`${id}: created by ${parent} with ${near(CONTRACT_NEAR)} · ${explorer(r.transaction.hash)}`);
  }
  if ((await viewAccount(id)).code_hash !== hash) {
    const r = (await account(id).deployContract(wasm)) as unknown as Outcome;
    console.log(`${id}: deployed contracts/res/bearer.wasm · ${explorer(r.transaction.hash)}`);
  }
  let initialised = true;
  try {
    await view(id, "get_config");
  } catch {
    initialised = false;
  }
  if (!initialised) await send(account(id), id, [actions.functionCall("new", { signer_id: SIGNER, config: CONFIG, base_uri: BASE_URI }, 30n * TGAS, 0n)], `${id}: initialise for ${SIGNER} and Base`);

  const a = await viewAccount(id);
  const report = { measured_at: new Date().toISOString(), contract: id, code_hash: a.code_hash, same_as_testnet_build: a.code_hash === hash, signer: SIGNER, signer_version: await view<string>(SIGNER, "version"), config: await view(id, "get_config"), metadata: await view(id, "nft_metadata"), balance: near(BigInt(a.amount)), storage_bytes: a.storage_usage, keys: await keyCount(id) };
  console.log(JSON.stringify(report, null, 2));
  saveReport("mainnet-deploy", report);
}

async function create() {
  confirm("create");
  const holder = need(HOLDER, "MAINNET_HOLDER");
  const id = need(CONTRACT, "MAINNET_CONTRACT");
  const name = process.env.MAINNET_VAULT_NAME ?? "The first mainnet vault";
  const r = await send(account(holder), id, [actions.functionCall("create_vault", { name, finish: "champagne" }, 100n * TGAS, 50n * MILLI)], `${holder} creates a vault`);
  const tokenId = JSON.parse(Buffer.from(r.status.SuccessValue ?? "", "base64").toString() || "null") as string | null;
  let v: VaultView | null = null;
  for (let i = 0; i < 60 && !v?.evm_address; i++) {
    if (i) await sleep(1000);
    v = await view<VaultView | null>(id, "vault", { token_id: tokenId ?? TOKEN_ID });
  }
  console.log(`vault ${v?.token_id}: owner ${v?.owner_id}, Base address ${v?.evm_address}`);
  console.log(`Next: send a little ETH on Base mainnet (chain ${BASE_CHAIN_ID}) to ${v?.evm_address}, from your own wallet.`);
  saveReport("mainnet-create", { measured_at: new Date().toISOString(), contract: id, holder, tx: explorer(r.transaction.hash), vault: v });
}

async function status() {
  const id = need(CONTRACT, "MAINNET_CONTRACT");
  const v = await view<VaultView | null>(id, "vault", { token_id: TOKEN_ID });
  if (!v) return console.log(`${id}: no vault ${TOKEN_ID}`);
  console.log(`vault ${v.token_id}: owner ${v.owner_id}, state ${JSON.stringify(v.state)}, signatures ${v.signatures_requested}, withdrawals ${v.withdrawal_count}`);
  if (v.evm_address) {
    const [balance, nonce] = await Promise.all([baseRpc<string>("eth_getBalance", [v.evm_address, "latest"]), baseRpc<string>("eth_getTransactionCount", [v.evm_address, "latest"])]);
    console.log(`Base ${v.evm_address}: ${eth(BigInt(balance))}, nonce ${parseInt(nonce, 16)}`);
  }
  const ws = await view<Withdrawal[]>(id, "withdrawals", { token_id: TOKEN_ID, from_index: 0, limit: 20 });
  for (const w of ws) console.log(`withdrawal ${w.index}: ${w.status}${w.error ? ` (${w.error})` : ""}`);
  console.log(`${id}: ${await keyCount(id)} key(s)`);
}

async function handover() {
  confirm("handover");
  const id = need(CONTRACT, "MAINNET_CONTRACT");
  const holder = need(HOLDER, "MAINNET_HOLDER");
  const recipient = need(RECIPIENT, "MAINNET_RECIPIENT");
  if (!(await exists(recipient))) throw new Error(`${recipient} doesn't exist`);
  const v = need(await view<VaultView | null>(id, "vault", { token_id: TOKEN_ID }), `a vault ${TOKEN_ID}`);
  if (v.owner_id !== holder) throw new Error(`vault ${TOKEN_ID} is ${v.owner_id}'s, not ${holder}'s`);
  if (!isSealed(v)) throw new Error(`vault ${TOKEN_ID} isn't sealed with 0 signatures: ${JSON.stringify(v.state)}, ${v.signatures_requested}`);
  const balance = v.evm_address ? BigInt(await baseRpc<string>("eth_getBalance", [v.evm_address, "latest"])) : 0n;
  if (!balance) throw new Error(`the vault's Base address ${v.evm_address} holds nothing yet; deposit first`);
  const r = await send(account(holder), id, [actions.functionCall("nft_transfer", { receiver_id: recipient, token_id: TOKEN_ID }, 30n * TGAS, ONE_YOCTO)], `${holder} hands vault ${TOKEN_ID} to ${recipient}, sealed, holding ${eth(balance)}`);
  const after = await view<VaultView>(id, "vault", { token_id: TOKEN_ID });
  saveReport("mainnet-handover", { measured_at: new Date().toISOString(), contract: id, from: holder, to: recipient, base_balance_wei: balance.toString(), tx: explorer(r.transaction.hash), after });
}

/** The OP-stack L1 data fee comes on top of gas, so the vault keeps an upper bound of it back. */
async function l1FeeUpperBound(size: number) {
  const abi = [{ type: "function", name: "getL1FeeUpperBound", stateMutability: "view", inputs: [{ name: "_unsignedTxSize", type: "uint256" }], outputs: [{ type: "uint256" }] }] as const;
  const data = encodeFunctionData({ abi, functionName: "getL1FeeUpperBound", args: [BigInt(size)] });
  const out = await baseRpc<`0x${string}`>("eth_call", [{ to: "0x420000000000000000000000000000000000000F", data }, "latest"]);
  return decodeFunctionResult({ abi, functionName: "getL1FeeUpperBound", data: out });
}

async function withdraw() {
  confirm("withdraw");
  const id = need(CONTRACT, "MAINNET_CONTRACT");
  const recipient = need(RECIPIENT, "MAINNET_RECIPIENT");
  const to = getAddress(need(process.env.BASE_TO, "BASE_TO (the Base address to withdraw to)"));
  const v = need(await view<VaultView | null>(id, "vault", { token_id: TOKEN_ID }), `a vault ${TOKEN_ID}`);
  if (v.owner_id !== recipient) throw new Error(`vault ${TOKEN_ID} is ${v.owner_id}'s, not ${recipient}'s`);
  const from = need(v.evm_address, "a vault with keys");

  const [balanceHex, nonceHex, block, tipHex] = await Promise.all([
    baseRpc<string>("eth_getBalance", [from, "latest"]),
    baseRpc<string>("eth_getTransactionCount", [from, "pending"]),
    baseRpc<{ baseFeePerGas: string }>("eth_getBlockByNumber", ["latest", false]),
    baseRpc<string>("eth_maxPriorityFeePerGas", []),
  ]);
  const balance = BigInt(balanceHex);
  const tip = BigInt(tipHex) > 1_000_000n ? BigInt(tipHex) : 1_000_000n;
  const maxFee = 2n * BigInt(block.baseFeePerGas) + tip;
  const l1 = await l1FeeUpperBound(150);
  const keep = 21_000n * maxFee + 2n * l1;
  const amount = balance - keep;
  if (amount <= 0n) throw new Error(`the vault holds ${eth(balance)}, less than the ${eth(keep)} its fees need`);
  const params = { chain_id: String(BASE_CHAIN_ID), nonce: String(parseInt(nonceHex, 16)), to, amount_wei: amount.toString(), gas_limit: "21000", max_fee_per_gas: maxFee.toString(), max_priority_fee_per_gas: tip.toString() };
  console.log(`withdrawing ${eth(amount)} of ${eth(balance)} to ${to}; keeping ${eth(keep)} for gas and the L1 fee`);

  const index = v.withdrawal_count;
  const acts = [actions.functionCall("withdraw_evm", { token_id: TOKEN_ID, params }, 150n * TGAS, 10n * MILLI + ONE_YOCTO)];
  if (isSealed(v)) acts.unshift(actions.functionCall("break_seal", { token_id: TOKEN_ID }, 30n * TGAS, ONE_YOCTO));
  const r = await send(account(recipient), id, acts, `${recipient} ${isSealed(v) ? "breaks the seal and " : ""}asks for the transfer to be signed`);

  let w: Withdrawal | undefined;
  for (let i = 0; i < 240; i++) {
    w = (await view<Withdrawal[]>(id, "withdrawals", { token_id: TOKEN_ID, from_index: index, limit: 1 }))[0];
    if (w && w.status !== "pending") break;
    await sleep(500);
  }
  if (!w?.signed_raw_tx) throw new Error(`withdrawal ${index}: ${w?.status} ${w?.error ?? ""}`);
  const raw = `0x${w.signed_raw_tx.replace(/^0x/, "")}` as TransactionSerializedEIP1559;
  const tx = parseTransaction(raw);
  const signer = await recoverTransactionAddress({ serializedTransaction: raw });
  const checks = { from_vault: signer === getAddress(from), chain: tx.chainId === BASE_CHAIN_ID, to: tx.to && getAddress(tx.to) === to, value: tx.value === amount };
  console.log(`signed: ${JSON.stringify(checks)}`);
  if (!Object.values(checks).every(Boolean)) throw new Error("the signed transaction isn't the one asked for");
  saveReport("mainnet-withdraw", { measured_at: new Date().toISOString(), contract: id, by: recipient, tx: explorer(r.transaction.hash), index, params, payload_hashes: w.payload_hashes, raw_tx: raw, checks });
}

async function broadcast() {
  confirm("broadcast");
  const id = need(CONTRACT, "MAINNET_CONTRACT");
  const v = need(await view<VaultView | null>(id, "vault", { token_id: TOKEN_ID }), `a vault ${TOKEN_ID}`);
  const index = Number(process.env.MAINNET_WITHDRAWAL ?? v.withdrawal_count - 1);
  const w = (await view<Withdrawal[]>(id, "withdrawals", { token_id: TOKEN_ID, from_index: index, limit: 1 }))[0];
  if (!w?.signed_raw_tx) throw new Error(`withdrawal ${index} isn't signed`);
  const raw = `0x${w.signed_raw_tx.replace(/^0x/, "")}`;
  const hash = await baseRpc<string>("eth_sendRawTransaction", [raw]);
  console.log(`sent to Base: ${baseExplorer(hash)}`);
  let receipt: { status: string; blockNumber: string; gasUsed: string; effectiveGasPrice: string; l1Fee?: string } | null = null;
  for (let i = 0; i < 60 && !receipt; i++) {
    if (i) await sleep(2000);
    receipt = await baseRpc("eth_getTransactionReceipt", [hash]);
  }
  if (!receipt) throw new Error(`no receipt yet for ${hash}; run status later`);
  console.log(`block ${parseInt(receipt.blockNumber, 16)}, status ${receipt.status === "0x1" ? "success" : "FAILED"}`);
  saveReport("mainnet-broadcast", { measured_at: new Date().toISOString(), contract: id, index, base_tx: baseExplorer(hash), hash, block: parseInt(receipt.blockNumber, 16), status: receipt.status, gas_used: parseInt(receipt.gasUsed, 16), effective_gas_price_wei: BigInt(receipt.effectiveGasPrice).toString(), l1_fee_wei: receipt.l1Fee ? BigInt(receipt.l1Fee).toString() : null });
}

/** Deletes every key on the contract account (T11), only if it runs exactly contracts/res/bearer.wasm. */
async function lock() {
  const id = need(CONTRACT, "MAINNET_CONTRACT");
  if (process.env.CONFIRM_LOCK !== id) throw new Error(`Locking ${id} can't be undone. Run again with CONFIRM_LOCK=${id}.`);
  const expected = codeHashOf(readFileSync(WASM));
  const { code_hash } = await viewAccount(id);
  if (code_hash !== expected) throw new Error(`${id} runs ${code_hash}, not contracts/res/bearer.wasm (${expected}); refusing to lock`);
  type Keys = { keys: { public_key: string }[] };
  const { keys } = await rpc<Keys>("query", { request_type: "view_access_key_list", finality: "final", account_id: id });
  if (!keys.length) return console.log(`${id} is already locked`);
  const own = (JSON.parse(readFileSync(need(keyFile(id), `a key file for ${id}`), "utf8")) as { public_key: string }).public_key;
  const ordered = [...keys.filter((k) => k.public_key !== own), ...keys.filter((k) => k.public_key === own)];
  const r = (await account(id).signAndSendTransaction({ receiverId: id, actions: ordered.map((k) => actions.deleteKey(PublicKey.fromString(k.public_key))), waitUntil: "FINAL" })) as unknown as Outcome;
  const after = await keyCount(id);
  const report = { measured_at: new Date().toISOString(), contract: id, code_hash, deleted_keys: ordered.map((k) => k.public_key), tx: explorer(r.transaction.hash), keys_after: after };
  console.log(JSON.stringify(report, null, 2));
  saveReport("mainnet-lock", report);
  if (after) throw new Error(`${id} still has ${after} key(s)`);
}

const [cmd] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = { plan, deploy, create, status, handover, withdraw, broadcast, lock };
if (commands[cmd]) await commands[cmd]();
else console.log(`usage: node spike/mainnet.ts ${Object.keys(commands).join("|")}`);
