"use client";

import type { FunctionCall, WalletAdapter } from "@bearer/sdk";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64, hex } from "@scure/base";
import { NEAR_RPC } from "@/lib/config";

/**
 * A Bearer link, `/claim#<key>`, is a vault you can send in a message. The key is an ed25519 seed;
 * its NEAR implicit account (the public key in hex) holds the vault and a little NEAR for fees.
 * Whoever has the link controls that account, so the link is the vault, like cash. The key sits
 * after the `#`, which browsers never send to a server, and in this tab's sessionStorage while
 * the link is open. Handing the vault on moves it to another account, so an old copy of the link
 * is left with nothing.
 */
export interface LinkKey {
  seed: Uint8Array;
  publicKey: Uint8Array;
  accountId: string;
}

/** Reads a link's key: a base58 seed, or a NEAR `ed25519:` secret key. */
export function parseLinkKey(text: string): LinkKey | null {
  try {
    const raw = base58.decode(text.trim().replace(/^#/, "").replace(/^ed25519:/, ""));
    if (raw.length !== 32 && raw.length !== 64) return null;
    const seed = raw.slice(0, 32);
    const publicKey = ed25519.getPublicKey(seed);
    if (raw.length === 64 && hex.encode(raw.slice(32)) !== hex.encode(publicKey)) return null;
    return { seed, publicKey, accountId: hex.encode(publicKey) };
  } catch {
    return null;
  }
}

export function newLinkKey(): LinkKey {
  return parseLinkKey(base58.encode(ed25519.utils.randomSecretKey())) as LinkKey;
}

export const linkUrl = (key: LinkKey) => `${window.location.origin}/claim#${base58.encode(key.seed)}`;

/** `3f9a…c21e`: implicit accounts are 64 hex characters. */
export const shortAccount = (id: string) => (/^[0-9a-f]{64}$/.test(id) ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

/* ---------- this tab's open link ---------- */

const SESSION_KEY = "bearer:link";

export function storedLinkKey(): LinkKey | null {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    return s ? parseLinkKey(s) : null;
  } catch {
    return null;
  }
}

export function storeLinkKey(key: LinkKey | null) {
  try {
    if (key) sessionStorage.setItem(SESSION_KEY, base58.encode(key.seed));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Blocked storage: the link lasts until the page reloads.
  }
}

/* ---------- signing NEAR transactions with the link's key ---------- */

type Action = { kind: "call"; call: FunctionCall } | { kind: "transfer"; yocto: bigint };

/** Borsh, just enough for a NEAR transaction with function calls and transfers. */
class Borsh {
  private out: number[] = [];
  u8(n: number) {
    this.out.push(n & 0xff);
    return this;
  }
  u32(n: number) {
    for (let i = 0; i < 4; i++) this.out.push((n >>> (8 * i)) & 0xff);
    return this;
  }
  uint(n: bigint, bytes: number) {
    for (let i = 0; i < bytes; i++) this.out.push(Number((n >> BigInt(8 * i)) & 0xffn));
    return this;
  }
  fixed(b: Uint8Array) {
    for (const x of b) this.out.push(x);
    return this;
  }
  bytes(b: Uint8Array) {
    return this.u32(b.length).fixed(b);
  }
  string(s: string) {
    return this.bytes(new TextEncoder().encode(s));
  }
  done() {
    return Uint8Array.from(this.out);
  }
}

function encodeTransaction(key: LinkKey, nonce: bigint, receiverId: string, blockHash: Uint8Array, actions: Action[]) {
  // Transaction V0: signer, public key (0 = ed25519), nonce, receiver, block hash, actions.
  const w = new Borsh().string(key.accountId).u8(0).fixed(key.publicKey).uint(nonce, 8).string(receiverId).fixed(blockHash).u32(actions.length);
  for (const a of actions) {
    if (a.kind === "call") {
      const args = new TextEncoder().encode(JSON.stringify(a.call.args));
      w.u8(2).string(a.call.methodName).bytes(args).uint(a.call.gas, 8).uint(a.call.deposit, 16);
    } else {
      w.u8(3).uint(a.yocto, 16);
    }
  }
  return w.done();
}

class RpcError extends Error {}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  // Queries report some errors (a missing account or key) inside the result.
  const error = body.error ?? body.result?.error;
  if (error) throw new RpcError(typeof error === "string" ? error : JSON.stringify(error));
  return body.result as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Outcome = { transaction: { hash: string }; status?: { SuccessValue?: string; Failure?: unknown } };

/** Reads what the link's account holds in NEAR: its balance and the part storage keeps. */
export async function linkBalance(accountId: string, finality: "final" | "optimistic" = "final"): Promise<{ yocto: bigint; spendable: bigint } | null> {
  try {
    const a = await rpc<{ amount: string; storage_usage: number }>("query", { request_type: "view_account", finality, account_id: accountId });
    const reserved = BigInt(a.storage_usage) * 10n ** 19n;
    return { yocto: BigInt(a.amount), spendable: BigInt(a.amount) > reserved ? BigInt(a.amount) - reserved : 0n };
  } catch (e) {
    if (/UNKNOWN_ACCOUNT|does not exist/.test(String(e))) return null;
    throw e;
  }
}

// The last nonce each account used from this tab: the RPC can lag a transaction just sent.
const lastNonces = new Map<string, bigint>();

/** The link's key as a wallet: builds, signs and sends each transaction in the browser. */
export function linkWallet(key: LinkKey): WalletAdapter & { transfer(receiverId: string, yocto: bigint): Promise<{ txHash: string }> } {
  const publicKey = `ed25519:${base58.encode(key.publicKey)}`;

  async function accessKey() {
    // A link funded a moment ago may not be visible yet.
    for (let i = 0; ; i++) {
      try {
        return await rpc<{ nonce: number; block_hash: string }>("query", {
          request_type: "view_access_key",
          finality: "optimistic",
          account_id: key.accountId,
          public_key: publicKey,
        });
      } catch (e) {
        if (i >= 5 || !/does not exist|UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY/.test(String(e))) {
          throw new Error(/does not exist|UNKNOWN/.test(String(e)) ? "This link's account doesn't exist on NEAR testnet." : String(e));
        }
        await sleep(1500);
      }
    }
  }

  async function send(receiverId: string, actions: Action[]) {
    const access = await accessKey();
    const last = lastNonces.get(key.accountId) ?? 0n;
    const nonce = BigInt(access.nonce) >= last ? BigInt(access.nonce) + 1n : last + 1n;
    lastNonces.set(key.accountId, nonce);
    const tx = encodeTransaction(key, nonce, receiverId, base58.decode(access.block_hash), actions);
    const hash = sha256(tx);
    const signed = new Uint8Array(tx.length + 65);
    signed.set(tx);
    signed[tx.length] = 0; // ed25519
    signed.set(ed25519.sign(hash, key.seed), tx.length + 1);

    // Wait for every receipt, the MPC signer's included; ask again if the RPC times out.
    let outcome: Outcome | null = null;
    try {
      outcome = await rpc<Outcome>("send_tx", { signed_tx_base64: base64.encode(signed), wait_until: "EXECUTED_OPTIMISTIC" });
    } catch (e) {
      if (!/TIMEOUT/i.test(String(e))) throw e;
    }
    for (let i = 0; !outcome?.status && i < 90; i++) {
      await sleep(1000);
      try {
        outcome = await rpc<Outcome>("tx", { tx_hash: base58.encode(hash), sender_account_id: key.accountId, wait_until: "EXECUTED_OPTIMISTIC" });
      } catch (e) {
        if (!/TIMEOUT|UNKNOWN_TRANSACTION/i.test(String(e))) throw e;
      }
    }
    if (!outcome?.status) throw new Error("The transaction was sent but hasn't finished yet. Check the vault page in a moment.");
    if (outcome.status.Failure) throw new Error(JSON.stringify(outcome.status.Failure));
    const value = outcome.status.SuccessValue ? new TextDecoder().decode(base64.decode(outcome.status.SuccessValue)) : "";
    return { txHash: outcome.transaction.hash, returnValue: value ? JSON.parse(value) : null };
  }

  return {
    accountId: () => key.accountId,
    send: (receiverId, calls) => send(receiverId, calls.map((call) => ({ kind: "call", call }))),
    async sendMany(txs) {
      const out = [];
      for (const t of txs) out.push(await send(t.receiverId, t.calls.map((call) => ({ kind: "call" as const, call }))));
      return out;
    },
    transfer: (receiverId, yocto) => send(receiverId, [{ kind: "transfer", yocto }]),
  };
}
