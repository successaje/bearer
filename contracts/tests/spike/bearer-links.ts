/**
 * Bearer links on bearer.testnet: sealed vaults sent as links (apps/web/src/lib/vault/bearer-link.ts).
 *
 *   node spike/bearer-links.ts treasury              # the parent creates and opens a treasury vault; prints its Bitcoin address
 *   node spike/bearer-links.ts mint <count> <sats>   # each link: a sealed vault handed to a fresh key's account, paid from the treasury
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

type Link = { n: number; token_id: string; account: string; seed: string; url: string; btc_sats: number; btc_txid: string | null; minted_at: string };
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
  const line = (l: Link) => `- No. ${l.token_id.padStart(4, "0")} · ${l.btc_sats.toLocaleString("en-US")} sats · ${l.url}`;
  const md = [
    "# Bearer links (testnet)",
    "",
    "Each link holds a sealed vault on bearer.testnet. Anyone who opens a link can take its vault, so share each one once.",
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

async function utxos(address: string) {
  return (await (await fetch(`${ESPLORA}/address/${address}/utxo`)).json()) as Utxo[];
}

async function feeRate() {
  const estimates = (await (await fetch(`${ESPLORA}/fee-estimates`)).json()) as Record<string, number>;
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
    await call(parent, "break_seal", { token_id: v.token_id }, 30n * TGAS, ONE_YOCTO);
    state.treasury = v.token_id;
    save(state);
  }
  const v = await view<Vault>("vault", { token_id: state.treasury });
  const coins = await utxos(v.btc_address as string);
  console.log(`treasury: vault No. ${v.token_id.padStart(4, "0")}, ${v.state.kind}, held by ${v.owner_id}`);
  console.log(`Bitcoin testnet4 address: ${v.btc_address}`);
  console.log(`holds ${coins.reduce((s, c) => s + c.value, 0)} sats in ${coins.length} coin(s), ${coins.filter((c) => !c.status.confirmed).length} unconfirmed`);
}

async function mint(count: number, sats: number) {
  const state = load();
  if (!state.treasury && sats > 0) throw new Error("run `treasury` first and fund it");
  const parent = account(PARENT as string);
  const treasuryVault = state.treasury ? await view<Vault>("vault", { token_id: state.treasury }) : null;
  for (let i = 0; i < count; i++) {
    const n = state.links.length + 1;
    const seed = randomBytes(32);
    const id = Buffer.from(ed25519.getPublicKey(seed)).toString("hex");
    const v = await createVault(parent, "A Bearer link", FINISHES[n % FINISHES.length]);
    await parent.transfer({ receiverId: id, amount: LINK_NEAR });
    await call(parent, "nft_transfer", { receiver_id: id, token_id: v.token_id }, 30n * TGAS, ONE_YOCTO);
    const paid = sats > 0 && treasuryVault ? await payFromTreasury(parent, treasuryVault, v.btc_address as string, sats) : null;
    const link: Link = {
      n,
      token_id: v.token_id,
      account: id,
      seed: base58(seed),
      url: `${SITE}/claim#${base58(seed)}`,
      btc_sats: paid ? sats : 0,
      btc_txid: paid?.txid ?? null,
      minted_at: new Date().toISOString(),
    };
    state.links.push(link);
    save(state);
    console.log(`link ${n}: vault No. ${v.token_id.padStart(4, "0")} → ${id.slice(0, 8)}…, ${paid ? `${sats} sats in ${paid.txid} (fee ${paid.fee})` : "no Bitcoin"}`);
  }
  console.log(`links written to ${join(DIR, "links.md")} (owner-only)`);
}

async function status() {
  const state = load();
  const ready = new Set<number>();
  for (const l of state.links) {
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
