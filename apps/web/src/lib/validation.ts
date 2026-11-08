import { NEAR_ACCOUNT_SUFFIX } from "@/lib/config";
import type { ChainTag } from "@bearer/sdk";

const NEAR_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function validateNearAccount(value: string): string | null {
  const id = value.trim().toLowerCase();
  if (!id) return "Enter a NEAR account, like theo.testnet.";
  if (id.length < 2 || id.length > 64 || !NEAR_ACCOUNT_RE.test(id)) {
    return "That isn't a valid NEAR account name.";
  }
  if (!id.endsWith(NEAR_ACCOUNT_SUFFIX)) {
    return "Bearer runs on NEAR testnet. Accounts end in .testnet.";
  }
  return null;
}

/** Validates the name part of a new `name.testnet` account. */
export function validateNewAccountName(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return "Use at least 2 characters.";
  if (n.length > 32) return "Use 32 characters or fewer.";
  if (!/^([a-z\d]+[-_])*[a-z\d]+$/.test(n)) {
    return "Use lowercase letters, numbers, - or _.";
  }
  return null;
}

const BECH32_CHARS = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function validateAddress(chain: ChainTag, value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter a destination address.";
  switch (chain) {
    case "btc": {
      const lower = v.toLowerCase();
      if (lower.startsWith("bc1") || /^[13]/.test(v)) {
        return "That looks like a Bitcoin mainnet address. Bearer uses testnet4 (addresses start with tb1).";
      }
      if (!lower.startsWith("tb1") || !BECH32_CHARS.test(lower.slice(3)) || v.length < 42 || v.length > 62) {
        return "Enter a Bitcoin testnet4 address starting with tb1.";
      }
      return null;
    }
    case "evm":
      return /^0x[0-9a-fA-F]{40}$/.test(v) ? null : "Enter a Base address: 0x followed by 40 hex characters.";
    case "sol":
      return BASE58.test(v) && v.length >= 32 && v.length <= 44 ? null : "Enter a Solana address (base58, 32–44 characters).";
  }
}

/** Accepts "42", "#42", "No. 0042" or a link containing /v/42 (or the older /c/42). */
export function parseVaultRef(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  const fromUrl = v.match(/\/[vc]\/(\d+)/);
  if (fromUrl) return String(Number(fromUrl[1]));
  const digits = v.replace(/^(no\.?|#)\s*/i, "");
  if (/^\d{1,9}$/.test(digits)) return String(Number(digits));
  return null;
}
