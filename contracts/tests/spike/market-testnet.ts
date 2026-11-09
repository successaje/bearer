/**
 * The market on NEAR testnet, against the locked Bearer contract (bearer.testnet).
 *
 *   node spike/market-testnet.ts setup                 # deploy contracts/res/market.wasm and initialise
 *   node spike/market-testnet.ts sale <token> <NEAR>   # alice lists the vault, bob buys it
 *   CONFIRM_LOCK=<market> node spike/market-testnet.ts lock   # delete every key; only if the code is MARKET_WASM
 *
 * Keys come from ~/.near-credentials/testnet, never the repo. Every number in the report is
 * measured on testnet; nothing is estimated.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, PublicKey, actions } from "near-api-js";

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const PARENT = process.env.BEARER_TESTNET_PARENT;
if (!PARENT) throw new Error("Set BEARER_TESTNET_PARENT to the faucet-created parent of the test accounts.");
const BEARER = process.env.BEARER_CONTRACT_ID ?? "bearer.testnet";
const MARKET = process.env.MARKET_CONTRACT_ID ?? "bearer-market.testnet";
const ALICE = `alice.${PARENT}`;
const BOB = `bob.${PARENT}`;
const MARKET_WASM = process.env.MARKET_WASM ?? join(import.meta.dirname, "..", "..", "res", "market.wasm");
const CREDS = join(homedir(), ".near-credentials", "testnet");

const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const LISTING_DEPOSIT = 10n ** 22n; // 0.01 NEAR, as in the sandbox tests

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

function account(id: string) {
  const { private_key } = JSON.parse(readFileSync(join(CREDS, `${id}.json`), "utf8"));
  return new Account(id, RPC, private_key);
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
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
  rpc<{ amount: string; storage_usage: number; code_hash: string }>("query", { request_type: "view_account", finality: "final", account_id: id });

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

type Outcome = {
  transaction: { hash: string };
  status: { SuccessValue?: string; Failure?: unknown };
  transaction_outcome: { outcome: { gas_burnt: number } };
  receipts_outcome: { outcome: { executor_id: string; gas_burnt: number; status: Record<string, unknown>; logs: string[] } }[];
};

async function call(from: Account, receiverId: string, methodName: string, args: object, deposit: bigint, gas: bigint) {
  const r = (await from.signAndSendTransaction({
    receiverId,
    actions: [actions.functionCall(methodName, args, gas, deposit)],
    waitUntil: "FINAL",
  })) as unknown as Outcome;
  const tgas = (r.transaction_outcome.outcome.gas_burnt + r.receipts_outcome.reduce((s, x) => s + x.outcome.gas_burnt, 0)) / 1e12;
  const failed = r.receipts_outcome.filter((x) => "Failure" in x.outcome.status).map((x) => x.outcome.executor_id);
  const events = r.receipts_outcome.flatMap((x) => x.outcome.logs).filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice(11)).event);
  return { hash: r.transaction.hash, tx: explorer(r.transaction.hash), tgas: Math.round(tgas * 1000) / 1000, failed, events, outcome: r };
}

function saveReport(name: string, data: unknown) {
  const dir = join(import.meta.dirname, "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${new Date().toISOString().replace(/[:]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`report: ${file}`);
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

type Vault = { owner_id: string; state: { kind: string }; signatures_requested: number; custody: { account_id: string }[] };
type Listing = { seller: string; price: string; deposit: string; state: { kind: string } } | null;

/* ---------- commands ---------- */

async function setup() {
  const wasm = readFileSync(MARKET_WASM);
  const market = account(MARKET);
  if ((await viewAccount(MARKET)).code_hash !== codeHashOf(wasm)) {
    await market.deployContract(wasm);
    console.log(`deployed ${MARKET_WASM}`);
  }
  let hash = "";
  for (let i = 0; i < 20 && hash !== codeHashOf(wasm); i++) {
    if (i) await sleep(1000);
    hash = (await viewAccount(MARKET)).code_hash;
  }
  try {
    await view(MARKET, "get_config");
    console.log("already initialised");
  } catch {
    const r = await call(market, MARKET, "new", { nft_contract: BEARER, listing_deposit: LISTING_DEPOSIT.toString() }, 0n, 30n * TGAS);
    console.log(`initialised: ${r.tx}`);
  }
  console.log(`${MARKET}: code ${hash} (${hash === codeHashOf(wasm) ? "matches" : "DIFFERS from"} ${MARKET_WASM})`);
  console.log(JSON.stringify(await view(MARKET, "get_config")));
}

async function sale(tokenId: string, priceNear: string) {
  if (!tokenId || !priceNear) throw new Error("usage: sale <token> <price in NEAR>");
  const price = BigInt(Math.round(Number(priceNear) * 1000)) * 10n ** 21n;
  const alice = account(ALICE);
  const bob = account(BOB);

  const before = await view<Vault>(BEARER, "vault", { token_id: tokenId });
  if (before.owner_id !== ALICE || before.state.kind !== "sealed") throw new Error(`vault ${tokenId} must be sealed and alice's`);

  // 1. Listing: the deposit, then the vault itself through Bearer's transfer gate.
  const deposit = await call(alice, MARKET, "deposit_for_listing", {}, LISTING_DEPOSIT, 30n * TGAS);
  const list = await call(
    alice,
    BEARER,
    "nft_transfer_call",
    { receiver_id: MARKET, token_id: tokenId, msg: JSON.stringify({ price: price.toString() }) },
    ONE_YOCTO,
    100n * TGAS,
  );
  const listing = await view<Listing>(MARKET, "listing", { token_id: tokenId });
  const held = await view<Vault>(BEARER, "vault", { token_id: tokenId });
  console.log(`listed: ${list.tx} · owner ${held.owner_id}, ${held.state.kind} · ${JSON.stringify(listing)}`);
  if (!listing) throw new Error("listing missing");

  // 2. Purchase. Alice signs nothing from here on, so her balance change is exactly what she's paid.
  const aliceBefore = await settledBalance(ALICE);
  const started = Date.now();
  const buy = await call(bob, MARKET, "buy", { token_id: tokenId }, price, 100n * TGAS);
  const finalAfterMs = Date.now() - started;
  const after = await view<Vault>(BEARER, "vault", { token_id: tokenId });
  const listingAfter = await view<Listing>(MARKET, "listing", { token_id: tokenId });
  const aliceAfter = await settledBalance(ALICE);
  console.log(`bought: ${buy.tx} · ${buy.tgas} Tgas · events ${buy.events.join(", ")} · failed receipts: ${buy.failed.length}`);
  console.log(`vault ${tokenId}: owner ${after.owner_id}, ${after.state.kind}, ${after.signatures_requested} signatures`);
  console.log(`alice received ${Number(aliceAfter - aliceBefore) / 1e24} NEAR (price + deposit = ${Number(price + LISTING_DEPOSIT) / 1e24})`);

  saveReport("testnet-market-sale", {
    measured_at: new Date().toISOString(),
    bearer: BEARER,
    market: MARKET,
    market_code_hash: (await viewAccount(MARKET)).code_hash,
    token_id: tokenId,
    price_yocto: price.toString(),
    listing_deposit_yocto: LISTING_DEPOSIT.toString(),
    seller: ALICE,
    buyer: BOB,
    deposit_tx: deposit.tx,
    list: { tx: list.tx, tgas: list.tgas, events: list.events, failed_receipts: list.failed, listing },
    buy: { tx: buy.tx, tgas: buy.tgas, events: buy.events, failed_receipts: buy.failed, final_after_ms: finalAfterMs },
    vault_after: { owner_id: after.owner_id, state: after.state, signatures_requested: after.signatures_requested, custody: after.custody.map((c) => c.account_id) },
    listing_after: listingAfter,
    seller_received_yocto: (aliceAfter - aliceBefore).toString(),
    seller_received_expected_yocto: (price + LISTING_DEPOSIT).toString(),
    seller_paid_exactly: aliceAfter - aliceBefore === price + LISTING_DEPOSIT,
  });
}

/** Deletes every access key on the market account (M9). Same guards as Bearer's lock. */
async function lock() {
  if (process.env.CONFIRM_LOCK !== MARKET) throw new Error(`Locking ${MARKET} can't be undone. Run again with CONFIRM_LOCK=${MARKET}.`);
  const expected = codeHashOf(readFileSync(MARKET_WASM));
  const { code_hash } = await viewAccount(MARKET);
  if (code_hash !== expected) throw new Error(`${MARKET} runs ${code_hash}, not ${MARKET_WASM} (${expected}); refusing to lock`);
  type Keys = { keys: { public_key: string; access_key: { permission: unknown } }[] };
  const keyList = () => rpc<Keys>("query", { request_type: "view_access_key_list", finality: "final", account_id: MARKET });
  const { keys } = await keyList();
  if (!keys.length) return console.log(`${MARKET} is already locked`);
  const own = (JSON.parse(readFileSync(join(CREDS, `${MARKET}.json`), "utf8")) as { public_key: string }).public_key;
  const ordered = [...keys.filter((k) => k.public_key !== own), ...keys.filter((k) => k.public_key === own)];
  const r = (await account(MARKET).signAndSendTransaction({
    receiverId: MARKET,
    actions: ordered.map((k) => actions.deleteKey(PublicKey.fromString(k.public_key))),
    waitUntil: "FINAL",
  })) as unknown as Outcome;
  const after = await keyList();
  const report = { measured_at: new Date().toISOString(), contract: MARKET, code_hash, wasm: MARKET_WASM, deleted_keys: ordered.map((k) => k.public_key), tx: explorer(r.transaction.hash), keys_after: after.keys.length };
  console.log(JSON.stringify(report, null, 2));
  saveReport("testnet-market-lock", report);
  if (after.keys.length) throw new Error(`${MARKET} still has ${after.keys.length} key(s)`);
}

const cmd = process.argv[2];
if (cmd === "setup") await setup();
else if (cmd === "sale") await sale(process.argv[3] ?? "", process.argv[4] ?? "");
else if (cmd === "lock") await lock();
else console.log("usage: node spike/market-testnet.ts setup|sale <token> <NEAR>|lock");
