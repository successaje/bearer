import { USD_PRICES } from "@/lib/config";
import type { BaseUnits, ChainTag } from "@/lib/bearer/types";

const DECIMALS: Record<ChainTag, number> = { btc: 8, evm: 9, sol: 9 };
const DISPLAY_DECIMALS: Record<ChainTag, number> = { btc: 8, evm: 6, sol: 4 };

export const CHAIN_META: Record<
  ChainTag,
  { name: string; network: string; unit: string; asset: string; detail: string }
> = {
  btc: {
    name: "Bitcoin",
    network: "testnet4",
    unit: "tBTC",
    asset: "Bitcoin",
    detail: "testnet4 · Native SegWit",
  },
  evm: { name: "Base", network: "Sepolia", unit: "ETH", asset: "ETH on Base", detail: "Sepolia · ETH" },
  sol: { name: "Solana", network: "devnet", unit: "SOL", asset: "SOL", detail: "devnet · SOL" },
};

export function toDecimal(chain: ChainTag, amount: BaseUnits) {
  return amount / 10 ** DECIMALS[chain];
}

/** Plain decimal string with no exponent notation, for prefilling inputs. */
export function toDecimalString(chain: ChainTag, amount: BaseUnits) {
  return toDecimal(chain, amount)
    .toFixed(DECIMALS[chain])
    .replace(/\.?0+$/, "");
}

export function fromDecimal(chain: ChainTag, value: string): BaseUnits | null {
  const trimmed = value.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > DECIMALS[chain]) return null;
  const padded = (whole || "0") + frac.padEnd(DECIMALS[chain], "0");
  const n = Number(padded);
  return Number.isSafeInteger(n) ? n : null;
}

export function formatAmount(chain: ChainTag, amount: BaseUnits) {
  const value = toDecimal(chain, amount);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: DISPLAY_DECIMALS[chain],
  });
}

export function toUsd(chain: ChainTag, amount: BaseUnits) {
  return toDecimal(chain, amount) * USD_PRICES[chain];
}

export function formatUsd(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "tb1q8v4zyx7c…" → "tb1q 8v4z yx7c …", keeping 0x together for EVM. */
export function chunkAddress(address: string) {
  const prefix = address.startsWith("0x") ? "0x" : "";
  const body = address.slice(prefix.length);
  const groups = body.match(/.{1,4}/g) ?? [];
  if (prefix) {
    return `${prefix}${groups[0] ?? ""} ${groups.slice(1).join(" ")}`.trim();
  }
  return groups.join(" ");
}

export function truncateMiddle(value: string, head = 6, tail = 4) {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function relativeTime(at: number, now: number) {
  const diff = Math.max(0, now - at);
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDate(at);
}

export function formatDate(at: number) {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function cardNumber(id: string) {
  return `No. ${id.padStart(4, "0")}`;
}
