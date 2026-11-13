/**
 * NEP-413 signed messages for the holders' page: the browser asks the wallet (or the open Bearer
 * link's key) to sign one, and the server checks it. Shared by both sides, so they hash the same
 * bytes. Spec: https://github.com/near/NEPs/blob/master/neps/nep-0413.md
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64 } from "@scure/base";

/** 2^31 + 413: the prefix that keeps a signed message from ever being a valid transaction. */
const TAG = 2 ** 31 + 413;

/** How long a signed request stays good: long enough to sign, too short to reuse later. */
export const MAX_AGE_MS = 5 * 60 * 1000;

/** What the wallet shows and signs. Naming the vault means a signature for one opens no other. */
export const holderMessage = (tokenId: string) => `Open the holders' page of Bearer vault No. ${tokenId.padStart(4, "0")}`;

/** 32 bytes: the time in milliseconds (8 bytes, big-endian), then 24 random bytes. */
export function newNonce(now = Date.now()) {
  const nonce = new Uint8Array(32);
  new DataView(nonce.buffer).setBigUint64(0, BigInt(now));
  crypto.getRandomValues(nonce.subarray(8));
  return nonce;
}

export const nonceTime = (nonce: Uint8Array) => Number(new DataView(nonce.buffer, nonce.byteOffset, 32).getBigUint64(0));

function borshString(s: string) {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

/** The SHA-256 of the tag and the Borsh-encoded payload: what the key signs. */
export function payloadHash(message: string, nonce: Uint8Array, recipient: string) {
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, TAG, true);
  const parts = [tag, borshString(message), nonce, borshString(recipient), new Uint8Array([0])]; // no callbackUrl
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return sha256(bytes);
}

/** Wallets return the signature in base64 (the standard); a few use base58 or an `ed25519:` prefix. */
export function decodeSignature(s: string) {
  const raw = s.includes(":") ? s.slice(s.indexOf(":") + 1) : s;
  for (const decode of [base64.decode, base58.decode]) {
    try {
      const b = decode(raw);
      if (b.length === 64) return b;
    } catch {}
  }
  throw new Error("ERR_BAD_SIGNATURE_FORMAT");
}

export function decodePublicKey(s: string) {
  if (!s.startsWith("ed25519:")) throw new Error("ERR_KEY_NOT_ED25519");
  const b = base58.decode(s.slice("ed25519:".length));
  if (b.length !== 32) throw new Error("ERR_BAD_PUBLIC_KEY");
  return b;
}

export function verifySignature(signature: string, publicKey: string, message: string, nonce: Uint8Array, recipient: string) {
  return ed25519.verify(decodeSignature(signature), payloadHash(message, nonce, recipient), decodePublicKey(publicKey));
}

/** Signs with an open Bearer link's own key, which is a full-access key of the link's account. */
export function signWithSeed(seed: Uint8Array, publicKey: Uint8Array, message: string, nonce: Uint8Array, recipient: string) {
  return {
    publicKey: `ed25519:${base58.encode(publicKey)}`,
    signature: base64.encode(ed25519.sign(payloadHash(message, nonce, recipient), seed)),
  };
}

/** What the page sends to /api/holders. */
export interface HolderRequest {
  tokenId: string;
  accountId: string;
  publicKey: string;
  signature: string;
  /** base64 of the 32-byte nonce */
  nonce: string;
}

export type HolderResult =
  | { ok: true; accountId: string; tokenId: string; blockHeight: number; holderSince: string | null; room: { title: string; body: string[] } }
  | { ok: false; reason: "not_holder"; accountId: string; holder: string; heldUntil: string | null; blockHeight: number }
  | { ok: false; reason: "bad_request" | "bad_signature" | "expired" | "not_full_access" | "no_vault" | "rpc"; message: string };
