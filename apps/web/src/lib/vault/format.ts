import type { ChainTag } from "@bearer/sdk";
import { USD_PRICES } from "@/lib/config";

/** Base-unit decimals: sats, wei, lamports. */
const DECIMALS: Record<ChainTag, number> = { btc: 8, evm: 18, sol: 9 };
const DISPLAY_DECIMALS: Record<ChainTag, number> = { btc: 8, evm: 6, sol: 4 };

export const CHAIN_META: Record<
  ChainTag,
  { name: string; network: string; unit: string; asset: string; detail: string; source: string }
> = {
  btc: {
    name: "Bitcoin",
    network: "testnet4",
    unit: "tBTC",
    asset: "Bitcoin",
    detail: "testnet4 · Native SegWit",
    source: "mempool.space testnet4",
  },
  evm: { name: "Base", network: "Sepolia", unit: "ETH", asset: "ETH on Base", detail: "Sepolia · ETH", source: "Base Sepolia RPC" },
  sol: { name: "Solana", network: "devnet", unit: "SOL", asset: "SOL", detail: "devnet · SOL", source: "Solana devnet RPC" },
};

export function toDecimal(chain: ChainTag, base: string | bigint): number {
  return Number(BigInt(base)) / 10 ** DECIMALS[chain];
}

/** Exact decimal string, e.g. for prefilling "Max". */
export function toDecimalString(chain: ChainTag, base: string | bigint): string {
  const d = DECIMALS[chain];
  const v = BigInt(base);
  const whole = v / 10n ** BigInt(d);
  const frac = (v % 10n ** BigInt(d)).toString().padStart(d, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Parses a user-typed decimal into base units, or null if it isn't valid. */
export function fromDecimal(chain: ChainTag, value: string): bigint | null {
  const v = value.trim();
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [whole, frac = ""] = v.split(".");
  if (frac.length > DECIMALS[chain]) return null;
  return BigInt(whole || "0") * 10n ** BigInt(DECIMALS[chain]) + BigInt(frac.padEnd(DECIMALS[chain], "0") || "0");
}

export function formatAmount(chain: ChainTag, base: string | bigint) {
  const value = toDecimal(chain, base);
  const smallest = 10 ** -DISPLAY_DECIMALS[chain];
  // Real fees can be far below display precision; never round a non-zero amount to 0.
  if (value > 0 && value < smallest) return `< ${smallest.toFixed(DISPLAY_DECIMALS[chain])}`;
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: DISPLAY_DECIMALS[chain] });
}

export function toUsd(chain: ChainTag, base: string | bigint) {
  return toDecimal(chain, base) * USD_PRICES[chain];
}

export function formatUsd(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Groups an address in fours, keeping `0x` attached. */
export function chunkAddress(address: string) {
  const prefix = address.startsWith("0x") ? "0x" : "";
  const groups = address.slice(prefix.length).match(/.{1,4}/g) ?? [];
  return prefix ? `${prefix}${groups[0] ?? ""} ${groups.slice(1).join(" ")}`.trim() : groups.join(" ");
}

export function truncateMiddle(value: string, head = 6, tail = 4) {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Contract timestamps are nanosecond strings. */
export function nsToMs(ns: string) {
  return Number(BigInt(ns) / 1_000_000n);
}

export function relativeTime(at: number, now: number) {
  const s = Math.floor(Math.max(0, now - at) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} d ago` : formatDate(at);
}

export function formatDate(at: number) {
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** `3f9a…c21e` for a NEAR implicit account (64 hex characters, as a Bearer link's); other accounts as they are. */
export const shortAccount = (id: string) => (/^[0-9a-f]{64}$/.test(id) ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

export function vaultNumber(id: string) {
  return `No. ${id.padStart(4, "0")}`;
}

const YOCTO = 10n ** 24n;

/** yoctoNEAR → "12 NEAR", "0.015 NEAR": up to `digits` decimals, trailing zeros dropped. */
export function formatNear(yocto: string | bigint, digits = 5): string {
  const v = BigInt(yocto);
  const frac = (v % YOCTO).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return `${(v / YOCTO).toLocaleString("en-US")}${frac ? `.${frac}` : ""} NEAR`;
}

/** "12.5" → yoctoNEAR, or null unless it's a plain number with at most 24 decimals. */
export function parseNear(input: string): string | null {
  const t = input.trim();
  if (!/^\d+(\.\d{1,24})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return (BigInt(whole) * YOCTO + BigInt(frac.padEnd(24, "0"))).toString();
}

/** Base units → "1,234.5": `decimals` from the token, at most `digits` shown, trailing zeros dropped. */
export function formatUnits(amount: string | bigint, decimals: number, digits = 6): string {
  const v = BigInt(amount);
  const unit = 10n ** BigInt(decimals);
  const frac = decimals ? (v % unit).toString().padStart(decimals, "0").slice(0, digits).replace(/0+$/, "") : "";
  return `${(v / unit).toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

/** "12.5" → base units, or null unless it's a plain number with at most `decimals` decimals. */
export function parseUnits(input: string, decimals: number): string | null {
  const t = input.trim();
  if (!new RegExp(`^\\d+(\\.\\d{1,${Math.max(decimals, 1)}})?$`).test(t) || (decimals === 0 && t.includes("."))) return null;
  const [whole, frac = ""] = t.split(".");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0")).toString();
}
