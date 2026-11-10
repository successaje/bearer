/**
 * Bearer links on bearer.testnet: sealed vaults sent as links (apps/web/src/lib/vault/bearer-link.ts).
 *
 *   node spike/bearer-links.ts treasury              # the parent creates and opens a treasury vault; prints its Bitcoin address
 *   node spike/bearer-links.ts mint <count> <sats>   # each link: a sealed vault handed to a fresh key's account, paid from the treasury;
 *                                                    # finishes any link a stopped run left halfway first
 *   node spike/bearer-links.ts status                # which links still hold their vault
 *
 * A link is https://bearer-near.vercel.app/claim#<seed>: the seed's NEAR implicit account holds
 * the vault and LINK_NEAR for fees. The seeds are written to ~/.near-credentials/bearer-links/
 * (owner-only), never to the repo or the terminal. The parent is BEARER_TESTNET_PARENT, as in
 * testnet-sign.ts; its key is in ~/.near-credentials/testnet.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Account, actions } from "near-api-js";

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const ESPLORA = process.env.ESPLORA_API ?? "https://blockstream.info/testnet4/api";
const SITE = process.env.BEARER_SITE ?? "https://bearer-near.vercel.app";
const CONTRACT = "bearer.testnet";
const PARENT = process.env.BEARER_TESTNET_PARENT;
if (!PARENT) throw new Error("Set BEARER_TESTNET_PARENT to a faucet-created testnet account.");

const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const CREATE_DEPOSIT = 5n * 10n ** 22n; // 0.05 NEAR
const WITHDRAW_DEPOSIT = 10n ** 22n; // 0.01 NEAR
/** NEAR each link's account gets for fees: enough to break the seal and withdraw on every chain, or pass it on. */
const LINK_NEAR = BigInt(process.env.LINK_NEAR_YOCTO ?? 2n * 10n ** 23n); // 0.2 NEAR: a call's gas is taken up front (break_seal + withdraw_btc, about 0.12)
const FINISHES = ["champagne", "ivory", "sage", "midnight", "obsidian"];

const DIR = join(homedir(), ".near-credentials", "bearer-links");
const STATE = join(DIR, "links.json");

/**
 * A link is written here, key first, before any transaction. `done: false` marks one an
 * interruption left halfway; the next `mint` finishes it. Links from before this field are done.
 */
type Link = { n: number; token_id: string | null; account: string; seed: string; url: string; btc_sats: number; btc_txid: string | null; minted_at: string; done?: boolean; name?: string; note?: string };
type State = { treasury: string | null; links: Link[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- state, owner-only ---------- */

function load(): State {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { treasury: null, links: [] };
}

/** Writes the state and links.md, owner-only. `ready` (from `status`) splits the links into ready and used. */
function save(state: State, ready?: Set<number>) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  chmodSync(DIR, 0o700);
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(STATE, 0o600);
  const line = (l: Link) => `- No. ${(l.token_id ?? "????").padStart(4, "0")} · ${l.btc_sats.toLocaleString("en-US")} sats${l.note ? ` · ${l.note}` : ""} · ${l.url}${l.done === false ? " (unfinished: run mint again)" : ""}`;
  const md = [
    "# Bearer links (testnet)",
    "",
    "Each link holds a sealed vault on bearer.testnet. Anyone who opens a link can take its vault, so share each one once,",
    "with one person, and never post one publicly. Every link here is a key, used ones included: a used link can still",
    "hold an opened vault or leftover NEAR. Keep this file private.",
    "",
    ...(ready
      ? [
          "## Ready to share (still in its link, sealed)",
          "",
          ...state.links.filter((l) => ready.has(l.n)).map(line),
          "",
          "## Used (moved on or opened)",
          "",
          ...state.links.filter((l) => !ready.has(l.n)).map(line),
        ]
      : state.links.map(line)),
    "",
  ].join("\n");
  writeFileSync(join(DIR, "links.md"), md, { mode: 0o600 });
  chmodSync(join(DIR, "links.md"), 0o600);
}

/* ---------- NEAR ---------- */

function account(id: string) {
  const { private_key } = JSON.parse(readFileSync(join(homedir(), ".near-credentials", "testnet", `${id}.json`), "utf8"));
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
    if (err) throw new Error(`${method}: ${JSON.stringify(err).slice(0, 300)}`);
    return body.result as T;
  }
}

async function view<T>(method: string, args: object): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: CONTRACT,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

type Vault = { token_id: string; owner_id: string; state: { kind: string }; btc_address: string | null; withdrawal_count: number };
type Outcome = { transaction: { hash: string }; status: { SuccessValue?: string; Failure?: unknown } };

async function call(from: Account, method: string, args: object, gas: bigint, deposit: bigint) {
  const o = (await from.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall(method, args, gas, deposit)],
    waitUntil: "EXECUTED_OPTIMISTIC",
  })) as unknown as Outcome;
  if (o.status.Failure) throw new Error(`${method}: ${JSON.stringify(o.status.Failure).slice(0, 300)}`);
  const value = o.status.SuccessValue ? Buffer.from(o.status.SuccessValue, "base64").toString() : "";
  return { hash: o.transaction.hash, value: value ? JSON.parse(value) : null };
}

/** Creates a vault and waits for its derived addresses. */
async function createVault(from: Account, name: string, finish: string) {
  const { value: id } = await call(from, "create_vault", { name, finish }, 60n * TGAS, CREATE_DEPOSIT);
  for (let i = 0; i < 40; i++) {
    const v = await view<Vault>("vault", { token_id: id });
    if (v.btc_address) return v;
    await sleep(750);
  }
  throw new Error(`vault ${id}'s keys didn't arrive`);
}

/* ---------- Bitcoin testnet4 ---------- */

type Utxo = { txid: string; vout: number; value: number; status: { confirmed: boolean } };

/** JSON from Esplora; a refusal (HTTP 429 when it rate-limits) stops the run, which `mint` can resume. */
async function esplora<T>(path: string): Promise<T> {
  const res = await fetch(`${ESPLORA}${path}`);
  if (!res.ok) throw new Error(`${new URL(ESPLORA).host} answered HTTP ${res.status} for ${path}; run mint again, or set ESPLORA_API`);
  return (await res.json()) as T;
}

async function utxos(address: string) {
  return esplora<Utxo[]>(`/address/${address}/utxo`);
}

async function feeRate() {
  const estimates = await esplora<Record<string, number>>("/fee-estimates");
  const fastest = Object.entries(estimates).sort(([a], [b]) => Number(a) - Number(b))[0]?.[1] ?? 0;
  return Math.max(2, Math.ceil(fastest));
}

/**
 * Pays `sats` from the (opened) treasury to `to`, broadcasts it, and waits until Esplora shows
 * the change, so the next payment can spend it before it confirms.
 */
async function payFromTreasury(parent: Account, treasury: Vault, to: string, sats: number) {
  const coins = (await utxos(treasury.btc_address as string)).sort((a, b) => b.value - a.value).slice(0, 4);
  const rate = await feeRate();
  const fee = Math.ceil(rate * (11 + 68 * coins.length + 31 * 2));
  const total = coins.reduce((s, c) => s + c.value, 0);
  if (total < sats + fee + 546) throw new Error(`the treasury holds ${total} sats; this needs ${sats + fee} plus change`);
  const inputs = coins.map((c) => ({ txid: c.txid, vout: c.vout, value_sat: String(c.value) }));
  const index = (await view<Vault>("vault", { token_id: treasury.token_id })).withdrawal_count;
  const n = BigInt(inputs.length);
  await call(parent, "withdraw_btc", { token_id: treasury.token_id, params: { inputs, to_address: to, amount_sat: String(sats), fee_sat: String(fee) } }, (15n * n + 60n) * TGAS, (WITHDRAW_DEPOSIT + ONE_YOCTO) * n);
  let w: { status: string; signed_raw_tx: string | null; error: string | null } | undefined;
  for (let i = 0; i < 120; i++) {
    [w] = await view<(typeof w)[]>("withdrawals", { token_id: treasury.token_id, from_index: index, limit: 1 });
    if (w && w.status !== "pending") break;
    await sleep(1000);
  }
  if (!w?.signed_raw_tx) throw new Error(`the treasury withdrawal wasn't signed: ${w?.status} ${w?.error ?? ""}`);
  const res = await fetch(`${ESPLORA}/tx`, { method: "POST", body: w.signed_raw_tx });
  const txid = (await res.text()).trim();
  if (!res.ok) throw new Error(`broadcast refused: ${txid.slice(0, 200)}`);
  for (let i = 0; i < 30 && !(await utxos(treasury.btc_address as string)).some((u) => u.txid === txid); i++) await sleep(2000);
  return { txid, fee };
}

/* ---------- commands ---------- */

async function treasury() {
  const state = load();
  const parent = account(PARENT as string);
  if (!state.treasury) {
    const v = await createVault(parent, "Bearer links treasury", "graphite");
    state.treasury = v.token_id;
    save(state);
  }
  let v = await view<Vault>("vault", { token_id: state.treasury });
  if (v.state.kind === "sealed") {
    await call(parent, "break_seal", { token_id: v.token_id }, 30n * TGAS, ONE_YOCTO);
    v = await view<Vault>("vault", { token_id: state.treasury });
  }
  const coins = await utxos(v.btc_address as string);
  console.log(`treasury: vault No. ${v.token_id.padStart(4, "0")}, ${v.state.kind}, held by ${v.owner_id}`);
  console.log(`Bitcoin testnet4 address: ${v.btc_address}`);
  console.log(`holds ${coins.reduce((s, c) => s + c.value, 0)} sats in ${coins.length} coin(s), ${coins.filter((c) => !c.status.confirmed).length} unconfirmed`);
}

/** Stops the run after a step, to test that `mint` finishes the link next time (LINKS_CRASH_AFTER=key|vault|funded|handed). */
function crashAfter(step: string) {
  if (process.env.LINKS_CRASH_AFTER === step) throw new Error(`stopped after "${step}" (LINKS_CRASH_AFTER)`);
}

/**
 * Brings a saved link to done. Every step first checks whether it already happened, so it also
 * finishes a link that an interruption stopped anywhere.
 */
async function complete(state: State, link: Link, parent: Account, treasuryVault: Vault | null) {
  if (!link.token_id) {
    const v = await createVault(parent, link.name ?? "A Bearer link", FINISHES[link.n % FINISHES.length]);
    link.token_id = v.token_id;
    save(state);
  }
  crashAfter("vault");
  const v = await view<Vault>("vault", { token_id: link.token_id });
  const funded = await rpc("query", { request_type: "view_account", finality: "final", account_id: link.account }).then(() => true, () => false);
  if (!funded) await parent.transfer({ receiverId: link.account, amount: LINK_NEAR });
  crashAfter("funded");
  if (v.owner_id !== link.account) {
    if (v.owner_id !== PARENT) throw new Error(`vault ${link.token_id} is held by ${v.owner_id}, not the parent or the link`);
    await call(parent, "nft_transfer", { receiver_id: link.account, token_id: link.token_id }, 30n * TGAS, ONE_YOCTO);
  }
  crashAfter("handed");
  if (link.btc_sats > 0 && !link.btc_txid) {
    if (!treasuryVault) throw new Error("run `treasury` first and fund it");
    // A run stopped after broadcasting leaves the payment on chain: look before paying again.
    const seen = await esplora<{ txid: string; vout: { scriptpubkey_address?: string }[] }[]>(`/address/${v.btc_address}/txs`);
    const earlier = seen.find((t) => t.vout.some((o) => o.scriptpubkey_address === v.btc_address));
    link.btc_txid = earlier?.txid ?? (await payFromTreasury(parent, treasuryVault, v.btc_address as string, link.btc_sats)).txid;
    save(state);
  }
  link.done = true;
  save(state);
  console.log(`link ${link.n}: vault No. ${link.token_id.padStart(4, "0")} → ${link.account.slice(0, 8)}…, ${link.btc_txid ? `${link.btc_sats} sats in ${link.btc_txid}` : "no Bitcoin"}`);
}

async function mint(count: number, sats: number) {
  const state = load();
  if (!state.treasury && sats > 0) throw new Error("run `treasury` first and fund it");
  const parent = account(PARENT as string);
  const treasuryVault = state.treasury ? await view<Vault>("vault", { token_id: state.treasury }) : null;
  // First, finish any link an interruption left halfway.
  for (const l of state.links.filter((x) => x.done === false)) {
    console.log(`link ${l.n} was left unfinished; finishing it`);
    await complete(state, l, parent, treasuryVault);
  }
  for (let i = 0; i < count; i++) {
    const seed = randomBytes(32);
    const link: Link = {
      n: state.links.length + 1,
      token_id: null,
      account: Buffer.from(ed25519.getPublicKey(seed)).toString("hex"),
      seed: base58(seed),
      url: `${SITE}/claim#${base58(seed)}`,
      btc_sats: sats,
      btc_txid: null,
      minted_at: new Date().toISOString(),
      done: false,
      // LINK_NAME names the vault (a leading emoji picks its card art); LINK_NOTE labels it in links.md.
      ...(process.env.LINK_NAME ? { name: process.env.LINK_NAME } : {}),
      ...(process.env.LINK_NOTE ? { note: process.env.LINK_NOTE } : {}),
    };
    // The key is on disk before anything is sent, so no step can strand a vault or its coins.
    state.links.push(link);
    save(state);
    crashAfter("key");
    await complete(state, link, parent, treasuryVault);
  }
  console.log(`links written to ${join(DIR, "links.md")} (owner-only)`);
}

async function status() {
  const state = load();
  const ready = new Set<number>();
  for (const l of state.links) {
    if (!l.token_id || l.done === false) {
      console.log(`link ${l.n}: unfinished; run mint again to finish it`);
      continue;
    }
    const v = await view<Vault>("vault", { token_id: l.token_id });
    const still = v.owner_id === l.account && v.state.kind === "sealed";
    if (still) ready.add(l.n);
    console.log(`link ${l.n}: No. ${l.token_id.padStart(4, "0")} ${v.owner_id === l.account ? `in the link (${v.state.kind})` : `moved on: now held by ${v.owner_id.length === 64 ? `${v.owner_id.slice(0, 8)}…` : v.owner_id}, ${v.state.kind}`}`);
  }
  save(state, ready);
  console.log(`${ready.size} ready to share; ${join(DIR, "links.md")} updated (owner-only)`);
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(buf: Uint8Array) {
  let n = BigInt(`0x${Buffer.from(buf).toString("hex")}`);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = `1${s}`;
  }
  return s;
}

const cmd = process.argv[2];
if (cmd === "treasury") await treasury();
else if (cmd === "mint") await mint(Number(process.argv[3] ?? 1), Number(process.argv[4] ?? 0));
else if (cmd === "status") await status();
else console.log("usage: node spike/bearer-links.ts treasury | mint <count> <sats> | status");
