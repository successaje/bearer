/** "12 May 2027, 09:00" in the reader's own time zone. */
export function formatWhen(ms: number) {
  return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "in 182 days", "in 3 h", "in 4 min", or "now" once it has passed. */
export function untilText(at: number, now: number) {
  const s = Math.floor((at - now) / 1000);
  if (s <= 0) return "now";
  if (s < 60) return `in ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.floor(h / 24)} days`;
}

export const nsToMsNumber = (ns: string) => Number(BigInt(ns) / 1_000_000n);
