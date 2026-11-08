import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256, sha3_256 } from "@noble/hashes/sha3.js";
import { base58, bech32, hex } from "@scure/base";
import type { ChainTag } from "@bearer/sdk";

/**
 * NEAR MPC key derivation, as v1.signer-prod.testnet computes `derived_public_key`. Checked on
 * 2026-11-08 against the signer's own answers for both domains (docs/features/derive.md).
 *
 *   ε = SHA3-256("near-mpc-recovery v0.1.0 epsilon derivation:" ‖ predecessor ‖ "," ‖ path)
 *   secp256k1 (domain 0): key = root + ε·G, ε read big-endian mod n
 *   Ed25519   (domain 1): key = root + ε·B, ε read little-endian mod ℓ
 */
export const EPSILON_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";

const utf8 = new TextEncoder();
const toBig = (b: Uint8Array) => BigInt(`0x${hex.encode(b) || "0"}`);

export function epsilon(predecessor: string, path: string) {
  return sha3_256(utf8.encode(`${EPSILON_PREFIX}${predecessor},${path}`));
}

/** Root keys arrive NEAR-style: `secp256k1:<base58 of 64 bytes x‖y>` or `ed25519:<base58 of 32>`. */
export function parseNearKey(key: string) {
  const [curve, body] = key.split(":");
  return { curve, bytes: base58.decode(body) };
}

export function nearKey(curve: "secp256k1" | "ed25519", bytes: Uint8Array) {
  return `${curve}:${base58.encode(bytes)}`;
}

/** 64-byte uncompressed (x‖y) secp256k1 key. */
export function deriveSecp256k1(root: Uint8Array, eps: Uint8Array) {
  const point = secp256k1.Point.fromHex(`04${hex.encode(root)}`);
  const n = secp256k1.Point.CURVE().n;
  const derived = point.add(secp256k1.Point.BASE.multiply(toBig(eps) % n));
  return derived.toBytes(false).slice(1);
}

/** 32-byte Ed25519 key. */
export function deriveEd25519(root: Uint8Array, eps: Uint8Array) {
  const point = ed25519.Point.fromHex(hex.encode(root));
  const l = ed25519.Point.CURVE().n;
  const tweak = toBig(eps.slice().reverse()) % l;
  return point.add(ed25519.Point.BASE.multiply(tweak)).toBytes();
}

function compress(key64: Uint8Array) {
  const out = new Uint8Array(33);
  out[0] = key64[63] & 1 ? 0x03 : 0x02;
  out.set(key64.slice(0, 32), 1);
  return out;
}

export const btcAddress = (key64: Uint8Array) => bech32.encode("tb", [0, ...bech32.toWords(ripemd160(sha256(compress(key64))))]);
export const evmAddress = (key64: Uint8Array) => `0x${hex.encode(keccak_256(key64).slice(12))}`;
export const solAddress = (key32: Uint8Array) => base58.encode(key32);

export interface Derived {
  chain: ChainTag;
  path: string;
  epsilon: string;
  key: string;
  address: string;
}

/** Everything for one vault, from the two root keys and the contract's account ID. */
export function deriveVault(contract: string, tokenId: string, root0: string, root1: string): Derived[] {
  const secpRoot = parseNearKey(root0).bytes;
  const edRoot = parseNearKey(root1).bytes;
  return (["btc", "evm", "sol"] as const).map((chain) => {
    const path = `bearer:v3:${tokenId}:${chain}`;
    const eps = epsilon(contract, path);
    if (chain === "sol") {
      const key = deriveEd25519(edRoot, eps);
      return { chain, path, epsilon: hex.encode(eps), key: nearKey("ed25519", key), address: solAddress(key) };
    }
    const key = deriveSecp256k1(secpRoot, eps);
    return {
      chain,
      path,
      epsilon: hex.encode(eps),
      key: nearKey("secp256k1", key),
      address: chain === "btc" ? btcAddress(key) : evmAddress(key),
    };
  });
}
