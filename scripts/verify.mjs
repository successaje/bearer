#!/usr/bin/env node
/**
 * Checks the README's claims against the public chains: NEAR testnet, Bitcoin testnet4, Base
 * Sepolia and Solana devnet. Read-only: no keys, no transactions, nothing to install (Node 22+).
 *
 *   pnpm verify                      # or: node scripts/verify.mjs
 *   pnpm verify --json report.json   # also writes every result, with its source, as JSON
 *
 * Each line is ✓ (the chain agrees), ✗ (it doesn't) or ? (a public endpoint didn't answer; run it
 * again). Exits 1 if anything is ✗.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const EP = {
  near: "https://test.rpc.fastnear.com",
  archival: "https://archival-rpc.testnet.fastnear.com",
  archivalFallback: "https://archival-rpc.testnet.near.org",
  esplora: "https://blockstream.info/testnet4/api",
  base: "https://sepolia.base.org",
  solana: "https://api.devnet.solana.com",
};

const BEARER = "bearer.testnet";
const ALICE = "alice.bearer-1108-ffb3.testnet";
const BOB = "bob.bearer-1108-ffb3.testnet";
const NEAR = 10n ** 24n;

/* ---------- outcomes: the chain disagrees (✗), or a source didn't answer (?) ---------- */

class Contradicted extends Error {}
class Unreachable extends Error {}

function expect(ok, message) {
  if (!ok) throw new Contradicted(message);
}

/* ---------- reading the chains ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** JSON (or text) from a public endpoint, retried on timeouts, 429 and 5xx; null on 404. */
async function get(url, init, asText = false) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!res.ok) throw new Unreachable(`${new URL(url).host} answered HTTP ${res.status}: ${text.slice(0, 120)}`);
      if (asText) return text.trim();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (e) {
      if (e instanceof Unreachable) throw e;
      last = e;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw new Unreachable(`${new URL(url).host}: ${last?.message ?? "no answer"}`);
}

async function rpc(url, method, params) {
  const body = await get(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (body?.error) throw new Unreachable(`${new URL(url).host} ${method}: ${JSON.stringify(body.error).slice(0, 160)}`);
  return body?.result;
}

const near = (method, params) => rpc(EP.near, method, params);

async function view(account, method, args = {}) {
  const r = await near("query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

// The free archival nodes rate-limit bursts, so their requests go one at a time.
let archivalTail = Promise.resolve();
const oneAtATime = (f) => {
  const run = archivalTail.then(f, f);
  archivalTail = run.then(() => sleep(200), () => sleep(200));
  return run;
};

/** A NEAR transaction from an archival node (FastNear, then NEAR's own); null if it doesn't exist. */
const nearTx = (hash, sender) =>
  oneAtATime(async () => {
    let last;
    for (const url of [EP.archival, EP.archivalFallback]) {
      try {
        return await rpc(url, "tx", { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" });
      } catch (e) {
        if (/UNKNOWN_TRANSACTION|doesn't exist|not found/i.test(e.message)) return null;
        last = e;
      }
    }
    throw last;
  });

const calls = (tx) => tx.transaction.actions.map((a) => a.FunctionCall).filter(Boolean);
const argsOf = (call) => JSON.parse(Buffer.from(call.args, "base64").toString());
const tokensBurnt = (tx) => [tx.transaction_outcome, ...tx.receipts_outcome].reduce((n, o) => n + BigInt(o.outcome.tokens_burnt), 0n);
const gasBurnt = (tx) => [tx.transaction_outcome, ...tx.receipts_outcome].reduce((n, o) => n + o.outcome.gas_burnt, 0);

const esplora = (path) => get(`${EP.esplora}${path}`, undefined, path.endsWith("/hex"));
const base = (method, params) => rpc(EP.base, method, params);
const solana = (method, params) => rpc(EP.solana, method, params);

const memo = (f) => {
  const seen = new Map();
  return (key) => {
    if (!seen.has(key)) seen.set(key, f(key));
    return seen.get(key);
  };
};
const vault = memo((id) => view(BEARER, "vault", { token_id: id }));

/* ---------- formatting ---------- */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = `1${s}`;
  }
  return s;
}

const short = (h) => `${h.slice(0, 8)}…`;
const fmtNear = (yocto) => `${(Number(yocto) / 1e24).toFixed(6).replace(/0+$/, "")} NEAR`;
const sats = (n) => `${Number(n).toLocaleString("en-US")} sats`;

/* ---------- the claims ---------- */

const checks = [];
const claim = (group, text, source, run) => checks.push({ group, text, source, run });

// 1. The three contracts are locked and run the builds committed in contracts/res.

const LOCKED = [
  { account: BEARER, wasm: "bearer.wasm", lockTx: "J87dPH7D1LG7PLwvyzqwFbBKMsQ7pAd7Nxfn1DrvsaVT" },
  { account: "bearer-market.testnet", wasm: "market.wasm", lockTx: "G8t9cc9xKa7ymc84hCtk8xeRG2JKBao8auFLKLg1SHVK" },
  { account: "bearer-schedule.testnet", wasm: "schedule.wasm", lockTx: "6wAyfjD218s7DvCwuzK7nEtAdLDQK5eZujY3caDJRekx" },
];
const SUMS = readFileSync(join(ROOT, "contracts/res/SHA256SUMS"), "utf8");

for (const c of LOCKED) {
  const group = `Locked contract: ${c.account}`;

  claim(group, "No access keys: nobody can change or upgrade it", "NEAR RPC view_access_key_list", async () => {
    const { keys } = await near("query", { request_type: "view_access_key_list", finality: "final", account_id: c.account });
    expect(keys.length === 0, `${keys.length} access key(s): ${keys.map((k) => k.public_key).join(", ")}`);
    return "0 access keys";
  });

  claim(group, `Runs exactly contracts/res/${c.wasm}`, "NEAR RPC view_account, contracts/res/SHA256SUMS", async () => {
    const sha = createHash("sha256").update(readFileSync(join(ROOT, "contracts/res", c.wasm))).digest();
    const listed = SUMS.split("\n").find((l) => l.trim().endsWith(c.wasm))?.split(/\s+/)[0];
    expect(listed === sha.toString("hex"), `SHA256SUMS lists ${listed}, the file hashes to ${sha.toString("hex")}`);
    const { code_hash } = await near("query", { request_type: "view_account", finality: "final", account_id: c.account });
    expect(code_hash === base58(sha), `on chain ${code_hash}, the committed wasm is ${base58(sha)}`);
    return `code hash ${code_hash} = base58(sha256(${c.wasm}))`;
  });

  claim(group, "Names the commit it was built from, and that commit is in this repository", "contract_source_metadata, git", async () => {
    const meta = await view(c.account, "contract_source_metadata");
    const rev = meta.build_info?.source_code_snapshot?.match(/rev=([0-9a-f]{40})/)?.[1];
    expect(rev, `no commit in its source metadata: ${JSON.stringify(meta).slice(0, 120)}`);
    try {
      execFileSync("git", ["cat-file", "-e", `${rev}^{commit}`], { cwd: ROOT, stdio: "ignore" });
    } catch {
      throw new Unreachable(`commit ${rev} isn't in this checkout (a shallow clone?); fetch full history to check it`);
    }
    const [image, digest] = meta.build_info.build_environment.split("@");
    return `reproducible build of ${rev.slice(0, 7)} in ${image}${digest ? ", pinned by digest" : ""}`;
  });

  claim(group, "Its only key was deleted in a transaction of its own", `NEAR archival RPC, tx ${short(c.lockTx)}`, async () => {
    const tx = await nearTx(c.lockTx, c.account);
    expect(tx, `transaction ${c.lockTx} not found`);
    expect(tx.status.SuccessValue !== undefined, `it failed: ${JSON.stringify(tx.status)}`);
    const actions = tx.transaction.actions;
    expect(actions.length > 0 && actions.every((a) => a.DeleteKey), `its actions were ${JSON.stringify(actions).slice(0, 120)}`);
    return `tx ${short(c.lockTx)}: ${actions.length} DeleteKey, succeeded`;
  });
}

// 2. Bitcoin that changed hands without a Bitcoin transaction (vault No. 0006).

const G6 = "Bitcoin that changed hands without a Bitcoin transaction (vault No. 0006)";
const HANDOVER = "H3XPWh2n5cvDKaqKS8pY4kSCjXDCaPgG3fp6E8beJJYj";
const BTC_SPEND = "6002c967889d8185b4457837db9c44369b06af0208998cb445a64cea2b5e1e23";
const SOL_SPEND = "5FQ1wbWQrcLEpb4aqBgpCb3KC5D1UQvPR1aWFjaeEfLBW3eNqFQp2aLMxMKd4NwSeBy86sznnyDvAgoXe4T5XSqm";

claim(G6, "Handed from finishr.testnet to takaba.testnet in one NEAR transaction, for under 0.0004 NEAR", `NEAR archival RPC, tx ${short(HANDOVER)}`, async () => {
  const tx = await nearTx(HANDOVER, "finishr.testnet");
  expect(tx, "transaction not found");
  expect(tx.status.SuccessValue !== undefined, `it failed: ${JSON.stringify(tx.status)}`);
  const [call, ...rest] = calls(tx);
  const args = call && argsOf(call);
  expect(call?.method_name === "nft_transfer" && !rest.length && tx.transaction.receiver_id === BEARER, "it isn't one nft_transfer to bearer.testnet");
  expect(args.token_id === "6" && args.receiver_id === "takaba.testnet", `it moved ${args.token_id} to ${args.receiver_id}`);
  const fee = tokensBurnt(tx);
  expect(fee < 4n * 10n ** 20n, `it burnt ${fmtNear(fee)}`);
  return `nft_transfer of No. 0006, ${(gasBurnt(tx) / 1e12).toFixed(2)} Tgas, ${fmtNear(fee)} burnt`;
});

claim(G6, "Nothing moved on Bitcoin while it changed hands: the coin deposited stayed put until the new holder's withdrawal spent it", "Blockstream Esplora (testnet4)", async () => {
  const [v, spend] = await Promise.all([vault("6"), esplora(`/tx/${BTC_SPEND}`)]);
  const input = spend.vin[0];
  expect(input.prevout.scriptpubkey_address === v.btc_address, `the withdrawal spends ${input.prevout.scriptpubkey_address}`);
  const [outspend, funding, txs] = await Promise.all([
    esplora(`/tx/${input.txid}/outspend/${input.vout}`),
    esplora(`/tx/${input.txid}`),
    esplora(`/address/${v.btc_address}/txs`),
  ]);
  expect(outspend?.spent && outspend.txid === BTC_SPEND, `the deposited coin was spent by ${outspend?.txid ?? "nothing"}`);
  // Anything that left the address before or alongside the withdrawal would be a spend the old owner made.
  const earlier = txs.filter(
    (t) => t.txid !== BTC_SPEND && t.status.confirmed && t.status.block_height <= spend.status.block_height && t.vin.some((i) => i.prevout?.scriptpubkey_address === v.btc_address),
  );
  expect(!earlier.length, `earlier spends from ${v.btc_address}: ${earlier.map((t) => short(t.txid)).join(", ")}`);
  return `${sats(input.prevout.value)} deposited in block ${funding.status.block_height.toLocaleString("en-US")} (${short(input.txid)}:${input.vout}); first spent by ${short(BTC_SPEND)}, in block ${spend.status.block_height.toLocaleString("en-US")}`;
});

claim(G6, "That spend is byte for byte the withdrawal the contract signed after takaba.testnet opened the vault", "bearer.testnet withdrawals view, Esplora raw tx", async () => {
  const v = await vault("6");
  expect(v.state.kind === "opened" && v.state.by === "takaba.testnet", `state ${JSON.stringify(v.state)}`);
  const [w] = await view(BEARER, "withdrawals", { token_id: "6", from_index: 0, limit: 1 });
  expect(w?.params.chain === "btc" && w.status === "signed", `withdrawal 0 is ${JSON.stringify(w?.params?.chain)} ${w?.status}`);
  expect(BigInt(w.requested_at_ns) >= BigInt(v.state.at_ns), "it was requested before the seal was broken");
  const raw = await esplora(`/tx/${BTC_SPEND}/hex`);
  expect(raw?.toLowerCase() === w.signed_raw_tx.toLowerCase(), "the confirmed transaction's bytes differ from the contract's signed record");
  return `withdrawal 0 of No. 0006 = tx ${short(BTC_SPEND)} (${raw.length / 2} bytes)`;
});

claim(G6, "It confirmed in testnet4 block 160,228, paying 300,000 sats to sealed vault No. 0009", "Blockstream Esplora (testnet4)", async () => {
  const [tx, v9] = await Promise.all([esplora(`/tx/${BTC_SPEND}`), vault("9")]);
  expect(tx?.status.confirmed && tx.status.block_height === 160228, `status ${JSON.stringify(tx?.status)}`);
  const out = tx.vout.find((o) => o.scriptpubkey_address === v9.btc_address);
  expect(out?.value === 300000, `No. 0009's address got ${out?.value ?? 0} sats`);
  return `block 160,228; ${sats(out.value)} to ${v9.btc_address}, fee ${sats(tx.fee)}`;
});

claim(G6, "0.5 SOL also went to vault No. 0009, finalized in devnet slot 520,527,063", "Solana devnet RPC", async () => {
  const [tx, v6, v9] = await Promise.all([
    solana("getTransaction", [SOL_SPEND, { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 }]),
    vault("6"),
    vault("9"),
  ]);
  if (!tx) throw new Unreachable("the devnet RPC no longer returns this transaction (devnet keeps limited history)");
  expect(tx.meta.err === null && tx.slot === 520527063, `slot ${tx.slot}, error ${JSON.stringify(tx.meta.err)}`);
  const keys = tx.transaction.message.accountKeys;
  expect(keys[0] === v6.sol_address, `paid by ${keys[0]}, not No. 0006's ${v6.sol_address}`);
  const i = keys.indexOf(v9.sol_address);
  const got = i < 0 ? 0 : tx.meta.postBalances[i] - tx.meta.preBalances[i];
  expect(got === 500_000_000, `No. 0009's address got ${got} lamports`);
  return `slot 520,527,063, from No. 0006's ${short(v6.sol_address)} to No. 0009's ${short(v9.sol_address)}: 0.5 SOL`;
});

claim(G6, "Vault No. 0009 is sealed, has never had a withdrawal requested, and holds those coins", "bearer.testnet vault view, Esplora, Solana RPC", async () => {
  const v = await vault("9");
  expect(v.state.kind === "sealed" && v.signatures_requested === 0 && v.withdrawal_count === 0, `state ${v.state.kind}, ${v.signatures_requested} signatures`);
  const [addr, lamports] = await Promise.all([esplora(`/address/${v.btc_address}`), solana("getBalance", [v.sol_address, { commitment: "finalized" }])]);
  const held = addr.chain_stats.funded_txo_sum - addr.chain_stats.spent_txo_sum;
  expect(held >= 300000, `its Bitcoin address holds ${held} sats`);
  expect(lamports.value >= 500_000_000, `its Solana address holds ${lamports.value} lamports`);
  return `sealed, 0 signatures; ${sats(held)} and ${lamports.value / 1e9} SOL at its addresses`;
});

// 3. A funded withdrawal through a browser wallet (vault No. 0005).

const G5 = "A withdrawal through a browser wallet (vault No. 0005)";
const WALLET_TX = "9ioTWzebJRgkTaRLG9ZVNQzFKdyX9RSqkxMKwjN4UKwf";
const BASE_SPEND = "0x167897cae482d693f5a321ec459c3204270efcd735d11bb5ff95c0ea0ab65017";

claim(G5, "finishr.testnet broke the seal and requested a Base withdrawal in one NEAR transaction", `NEAR archival RPC, tx ${short(WALLET_TX)}`, async () => {
  const tx = await nearTx(WALLET_TX, "finishr.testnet");
  expect(tx, "transaction not found");
  expect(tx.status.SuccessValue !== undefined, `it failed: ${JSON.stringify(tx.status)}`);
  const methods = calls(tx).map((c) => c.method_name);
  expect(methods.includes("break_seal") && methods.includes("withdraw_evm"), `its calls were ${methods.join(", ")}`);
  return `${methods.join(" + ")}, ${(gasBurnt(tx) / 1e12).toFixed(1)} Tgas`;
});

claim(G5, "Base Sepolia confirmed it in block 56,685,109: 0.0002 ETH from the vault to a separate address", "Base Sepolia RPC", async () => {
  const [tx, receipt, v, [w]] = await Promise.all([
    base("eth_getTransactionByHash", [BASE_SPEND]),
    base("eth_getTransactionReceipt", [BASE_SPEND]),
    vault("5"),
    view(BEARER, "withdrawals", { token_id: "5", from_index: 0, limit: 1 }),
  ]);
  expect(tx && receipt?.status === "0x1" && Number(receipt.blockNumber) === 56685109, `receipt ${JSON.stringify(receipt?.status)} in ${receipt?.blockNumber}`);
  expect(tx.from.toLowerCase() === v.evm_address.toLowerCase(), `sent from ${tx.from}, not No. 0005's ${v.evm_address}`);
  expect(BigInt(tx.value) === 2n * 10n ** 14n && tx.to.toLowerCase() === w.params.to.toLowerCase(), `${tx.value} wei to ${tx.to}`);
  expect(tx.to.toLowerCase() !== v.evm_address.toLowerCase(), "it paid the vault itself");
  return `block 56,685,109; 0.0002 ETH from ${short(v.evm_address)} to ${short(tx.to)}, as the contract's withdrawal 0 says`;
});

// 4. Two signatures for one nonce on a real chain (T10, vault No. 0001).

const G1 = "Two signatures for one nonce on Base Sepolia (T10, vault No. 0001)";
const NONCE_TXS = ["0xcda94fc2657424ccc34d972c4015e517f12a75bfaca0aeeeea52d7b89ffded00", "0xec7e7f860048c298ddfa502c01d1925e2f4e786d84354afc0d83334e702f8b60"];

claim(G1, "The contract signed two Base withdrawals for nonce 0", "bearer.testnet withdrawals view", async () => {
  const ws = await view(BEARER, "withdrawals", { token_id: "1", from_index: 15, limit: 2 });
  expect(ws.length === 2 && ws.every((w) => w.params.chain === "evm" && w.params.nonce === "0" && w.status === "signed"), `withdrawals 15 and 16: ${JSON.stringify(ws.map((w) => [w.params.nonce, w.status]))}`);
  return `withdrawals 15 and 16, both nonce 0, ${ws.map((w) => `${Number(w.params.amount_wei) / 1e9} gwei`).join(" and ")}`;
});

claim(G1, "Base Sepolia confirmed one, in block 56,635,535, and never the other", "Base Sepolia RPC", async () => {
  const [receipt, tx, other, v] = await Promise.all([
    base("eth_getTransactionReceipt", [NONCE_TXS[0]]),
    base("eth_getTransactionByHash", [NONCE_TXS[0]]),
    base("eth_getTransactionByHash", [NONCE_TXS[1]]),
    vault("1"),
  ]);
  expect(receipt?.status === "0x1" && Number(receipt.blockNumber) === 56635535 && tx.nonce === "0x0", `first: ${receipt?.status} in ${receipt?.blockNumber}, nonce ${tx?.nonce}`);
  expect(tx.from.toLowerCase() === v.evm_address.toLowerCase(), `sent from ${tx.from}`);
  expect(other === null, `the second is on chain too, in ${other?.blockNumber}`);
  return `${short(NONCE_TXS[0])} confirmed at nonce 0; ${short(NONCE_TXS[1])} unknown to Base Sepolia`;
});

// 5. The seal rule, for every vault, and the recorded attacks.

const GS = "The seal rule on bearer.testnet";

claim(GS, "No sealed vault has ever had a withdrawal requested", "bearer.testnet nft_tokens and vault views", async () => {
  const tokens = await view(BEARER, "nft_tokens", { from_index: "0", limit: 100 });
  const vaults = await Promise.all(tokens.map((t) => vault(t.token_id)));
  const sealed = vaults.filter((v) => v.state.kind === "sealed");
  const broken = sealed.filter((v) => v.signatures_requested !== 0 || v.withdrawal_count !== 0);
  expect(!broken.length, `sealed with withdrawals: ${broken.map((v) => v.token_id).join(", ")}`);
  return `${vaults.length} vaults: ${sealed.length} sealed, each with 0 signatures; ${vaults.length - sealed.length} opened`;
});

const ATTACKS = [
  ["A former owner tries to withdraw (vault No. 0001)", "F9X8pHP1m2dKZq1JqZixnC9uao9gLL9YusifzEeo8RHz", ALICE, "ERR_NOT_OWNER"],
  ["A former owner tries to break the seal (vault No. 0004)", "2BQmo5kJmdRxMyaRUbT8zvT56jGMsh3ZZCCexqCPA6Zm", ALICE, "ERR_NOT_OWNER"],
  ["An opened vault is transferred (vault No. 0001)", "6GutSDN8MNpS4vq1FGAHeusLehLSpgz7aS4f9VUpA7Ed", BOB, "ERR_VAULT_OPENED"],
  ["A sealed vault is withdrawn from (vault No. 0004)", "44XdgiB2NDJYBrh5mx2PJZd5Z3hRfJR5gVPhXWFMKPP8", BOB, "ERR_VAULT_SEALED"],
  ["Arbitrary bytes are sent to be signed", "4FA4AK5psEtSx1h8fW2P5DRM43HV5AnWYwMmhi88QLHv", BOB, "MethodNotFound"],
];
for (const [what, hash, signer, error] of ATTACKS) {
  claim(GS, `Refused: ${what}`, `NEAR archival RPC, tx ${short(hash)}`, async () => {
    const tx = await nearTx(hash, signer);
    expect(tx, "transaction not found");
    const failure = JSON.stringify(tx.status.Failure ?? null);
    expect(failure.includes(error), tx.status.Failure ? `failed with ${failure.slice(0, 120)}` : "it succeeded");
    return `failed with ${error}`;
  });
}

// 6. The market and the schedule.

const GM = "Market and schedule";
const SALE = "GCuy9zAFHGeN8ZsjgvUyaF8Uzz4xvW4UvNessKMMYv6F";
const RELEASE = "76eGYPzRDspJi3YXLXVGU1zDnj8wcNF14kSz8Vu2HUpt";

const inOrder = (custody, names) => {
  const ids = custody.map((c) => c.account_id);
  return ids.some((_, i) => names.every((n, j) => ids[i + j] === n));
};

claim(GM, "Vault No. 0004 sold on the market for 0.1 NEAR, from alice to bob, still sealed", `NEAR archival RPC, tx ${short(SALE)}`, async () => {
  const [tx, v] = await Promise.all([nearTx(SALE, BOB), vault("4")]);
  expect(tx, "transaction not found");
  const [call] = calls(tx);
  expect(tx.status.SuccessValue !== undefined && tx.transaction.receiver_id === "bearer-market.testnet" && call?.method_name === "buy", "it isn't a successful buy on bearer-market.testnet");
  expect(argsOf(call).token_id === "4" && BigInt(call.deposit) === NEAR / 10n, `it bought ${argsOf(call).token_id} for ${fmtNear(call.deposit)}`);
  expect(inOrder(v.custody, [ALICE, "bearer-market.testnet", BOB]), "its custody doesn't show alice → market → bob");
  expect(v.signatures_requested === 0, `${v.signatures_requested} signatures`);
  return "buy(4) with 0.1 NEAR; custody alice → market → bob; 0 signatures";
});

claim(GM, "Vault No. 0007 was handed to bob on its date by a third account, still sealed", `NEAR archival RPC, tx ${short(RELEASE)}`, async () => {
  const [tx, v] = await Promise.all([nearTx(RELEASE, "bearer-1108-ffb3.testnet"), vault("7")]);
  expect(tx, "transaction not found");
  const [call] = calls(tx);
  expect(tx.status.SuccessValue !== undefined && tx.transaction.receiver_id === "bearer-schedule.testnet" && call?.method_name === "release", "it isn't a successful release on bearer-schedule.testnet");
  expect(![ALICE, BOB].includes(tx.transaction.signer_id), `released by ${tx.transaction.signer_id}`);
  expect(inOrder(v.custody, [ALICE, "bearer-schedule.testnet", BOB]), "its custody doesn't show alice → schedule → bob");
  expect(v.state.kind === "sealed" && v.signatures_requested === 0, `state ${v.state.kind}, ${v.signatures_requested} signatures`);
  return `release(7) by ${tx.transaction.signer_id}; custody alice → schedule → bob; sealed, 0 signatures`;
});

// 7. Bearer links: a vault sent as a link, then passed on (docs/features/bearer-links.md).

claim("Bearer links", "Vault No. 0010 passed through three links and on to an account, still sealed", "bearer.testnet vault view", async () => {
  const v = await vault("10");
  const ids = v.custody.map((c) => c.account_id);
  const isLink = (id) => /^[0-9a-f]{64}$/.test(id);
  const last = ids[ids.length - 1];
  expect(ids.filter(isLink).length >= 3, `its custody has ${ids.filter(isLink).length} link accounts`);
  expect(!isLink(last) && ids.findIndex(isLink) < ids.length - 1, `it ends with ${last}`);
  expect(v.state.kind === "sealed" && v.signatures_requested === 0, `state ${v.state.kind}, ${v.signatures_requested} signatures`);
  return `custody ${ids.map((id) => (isLink(id) ? `${id.slice(0, 4)}…` : id)).join(" → ")}; sealed, 0 signatures`;
});

// 8. Signed through the earlier test contract and accepted by each chain.

const GE = "Signed through an earlier test contract and accepted on each chain";

claim(GE, "Bitcoin: confirmed in testnet4 block 159,948", "Blockstream Esplora (testnet4)", async () => {
  const tx = await esplora("/tx/ce01f9fffdf0f362641a4f6882257295ae63de6146c5a3478704ef809bf958b6");
  expect(tx?.status.confirmed && tx.status.block_height === 159948, `status ${JSON.stringify(tx?.status)}`);
  return `ce01f9ff… in block 159,948, ${tx.vin.length} input(s)`;
});

claim(GE, "Base Sepolia: confirmed", "Base Sepolia RPC", async () => {
  const r = await base("eth_getTransactionReceipt", ["0xb347d755df6105ef2deb58158533f31fa5687586992308ee2fed0e4622ee20e3"]);
  expect(r?.status === "0x1", `receipt ${JSON.stringify(r?.status)}`);
  return `0xb347d755… in block ${Number(r.blockNumber).toLocaleString("en-US")}`;
});

claim(GE, "Solana devnet: finalized in slot 520,280,234", "Solana devnet RPC", async () => {
  const sig = "jQCk6nNLGvbAfkrxGizGhvqiUpnUZeA4b58tU3SEFdNA3La2g5PqTY6uod3zWMJk7yB9wfvZebVzFa73oEdgrmt";
  const tx = await solana("getTransaction", [sig, { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  if (!tx) throw new Unreachable("the devnet RPC no longer returns this transaction (devnet keeps limited history)");
  expect(tx.meta.err === null && tx.slot === 520280234, `slot ${tx.slot}, error ${JSON.stringify(tx.meta.err)}`);
  return "jQCk6nNL… in slot 520,280,234";
});

/* ---------- run ---------- */

const tty = process.stdout.isTTY;
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const MARK = { pass: paint(32, "✓"), fail: paint(31, "✗"), unknown: paint(33, "?") };

console.log("Bearer: checking the README's claims against NEAR testnet, Bitcoin testnet4, Base Sepolia and Solana devnet.");
console.log("Read-only: no keys, no transactions.\n");

const started = Date.now();
const results = [];
// A few at a time: the free public endpoints rate-limit bursts.
const queue = checks.map((c, i) => ({ ...c, i }));
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        results[c.i] = { ...c, status: "pass", detail: await c.run() };
      } catch (e) {
        results[c.i] = { ...c, status: e instanceof Contradicted ? "fail" : "unknown", detail: e.message };
      }
    }
  }),
);

let group = null;
for (const r of results) {
  if (r.group !== group) {
    console.log(`${group ? "\n" : ""}${paint(1, r.group)}`);
    group = r.group;
  }
  console.log(`  ${MARK[r.status]} ${r.text}`);
  console.log(paint(2, `      ${r.detail}  [${r.source}]`));
}

const count = (s) => results.filter((r) => r.status === s).length;
console.log(
  `\n${results.length} claims in ${((Date.now() - started) / 1000).toFixed(0)} s: ${count("pass")} ✓, ${count("fail")} ✗, ${count("unknown")} couldn't be checked${count("unknown") ? " (run again)" : ""}.`,
);

const jsonAt = process.argv.indexOf("--json");
if (jsonAt > 0 && process.argv[jsonAt + 1]) {
  const report = {
    checked_at: new Date().toISOString(),
    endpoints: EP,
    results: results.map(({ group: g, text, source, status, detail }) => ({ group: g, claim: text, status, detail, source })),
  };
  writeFileSync(process.argv[jsonAt + 1], `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${process.argv[jsonAt + 1]}`);
}

process.exit(count("fail") ? 1 : 0);
