import type { Finish, VaultView } from "@bearer/sdk";

/**
 * The vault as a standalone SVG: what wallets show as the token's `media`, so it must work inside
 * an <img> with no CSS, no web fonts and no external references.
 */

const W = 600;
const H = 378; // 1.586, a card

interface Look {
  kind: "linear" | "radial";
  stops: [string, number][];
  text: string;
  muted: string;
  rings: string;
}

const LOOKS: Record<Finish, Look> = {
  obsidian: { kind: "radial", stops: [["#2c2c34", 0], ["#17171c", 0.42], ["#0d0d10", 1]], text: "#f4f4f5", muted: "#a1a1aa", rings: "rgba(255,255,255,0.05)" },
  champagne: { kind: "linear", stops: [["#f1e2ae", 0], ["#d6b651", 0.38], ["#a8841d", 0.72], ["#7c6012", 1]], text: "#2b2108", muted: "rgba(43,33,8,0.72)", rings: "rgba(60,40,0,0.1)" },
  graphite: { kind: "linear", stops: [["#4a4b52", 0], ["#2a2b30", 0.45], ["#17181b", 1]], text: "#f4f4f5", muted: "#b4b4bc", rings: "rgba(255,255,255,0.05)" },
  ivory: { kind: "linear", stops: [["#fbf8ef", 0], ["#e9e3d2", 0.55], ["#cfc6ac", 1]], text: "#2b2108", muted: "rgba(43,33,8,0.62)", rings: "rgba(60,40,0,0.1)" },
  midnight: { kind: "radial", stops: [["#2a3a66", 0], ["#16203d", 0.45], ["#0b1022", 1]], text: "#f4f4f5", muted: "#aeb8d6", rings: "rgba(255,255,255,0.05)" },
  sage: { kind: "radial", stops: [["#3b4a40", 0], ["#1f2922", 0.45], ["#101612", 1]], text: "#f4f4f5", muted: "#b3c2b8", rings: "rgba(255,255,255,0.05)" },
};

const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const stops = (list: [string, number][]) => list.map(([c, o]) => `<stop offset="${o}" stop-color="${c}"/>`).join("");

/** The wax seal: intact gold with the monogram, or split in two dull halves once opened. */
export function sealSvg(opened: boolean, x: number, y: number, size: number, idPrefix = "s") {
  const k = size / 100;
  if (opened) {
    return `<g transform="translate(${x} ${y}) scale(${k})">
      <defs><radialGradient id="${idPrefix}-dull" cx="36%" cy="30%" r="80%">${stops([["#CFC3A0", 0], ["#8F815A", 0.5], ["#4A4128", 1]])}</radialGradient></defs>
      <path d="M50 8A42 42 0 0 0 50 92L44 74 52 60 42 46 50 30Z" fill="url(#${idPrefix}-dull)" transform="translate(-5 2) rotate(-7 50 50)"/>
      <path d="M56 8A42 42 0 0 1 56 92L50 74 58 60 48 46 56 30Z" fill="url(#${idPrefix}-dull)" transform="translate(5 -2) rotate(7 50 50)"/>
    </g>`;
  }
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <defs><radialGradient id="${idPrefix}-wax" cx="36%" cy="30%" r="80%">${stops([["#F6E3A1", 0], ["#D4AF3A", 0.42], ["#7A5E10", 1]])}</radialGradient></defs>
    <circle cx="50" cy="50" r="41" fill="url(#${idPrefix}-wax)" stroke="url(#${idPrefix}-wax)" stroke-width="12" stroke-dasharray="0.01 8.577" stroke-linecap="round"/>
    <circle cx="50" cy="50" r="30" fill="none" stroke="#6B520E" stroke-opacity="0.5" stroke-width="1.6"/>
    <path d="M40 34h12a8 8 0 0 1 0 16H40z M40 50h14a8 8 0 0 1 0 16H40z" fill="none" stroke="#5A4409" stroke-width="5" stroke-linejoin="round"/>
  </g>`;
}

/**
 * The words on the card and their colours. Renderers with no system fonts (the Open Graph image,
 * rasterised on a Linux server) draw these themselves over `cardSvg(vault, { text: false })`.
 */
export function cardText(vault: VaultView) {
  const look = LOOKS[vault.finish] ?? LOOKS.obsidian;
  const opened = vault.state.kind === "opened";
  return {
    opened,
    name: (vault.name ?? `Vault ${vault.token_id}`).slice(0, 32),
    serial: `No. ${vault.token_id.padStart(4, "0")}`,
    state: opened ? "OPENED · CAN'T CHANGE HANDS" : "SEALED · 0 SIGNATURES EVER REQUESTED",
    text: look.text,
    muted: look.muted,
    /** The state pill: its tint as "r,g,b", and its text colour. */
    pill: { rgb: opened ? "143,129,90" : "31,157,85", color: opened ? look.muted : "#2BB673" },
  };
}

export function cardSvg(vault: VaultView, { text = true }: { text?: boolean } = {}): string {
  const look = LOOKS[vault.finish] ?? LOOKS.obsidian;
  const words = cardText(vault);
  const opened = words.opened;
  const name = esc(words.name);
  const { serial, state, pill } = words;
  const fill =
    look.kind === "radial"
      ? `<radialGradient id="bg" cx="0" cy="0" r="1.3" gradientUnits="objectBoundingBox">${stops(look.stops)}</radialGradient>`
      : `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">${stops(look.stops)}</linearGradient>`;
  // Engraved rings, like the guilloche on the web card.
  const rings = Array.from({ length: 70 }, (_, i) => `<circle cx="${W * 0.86}" cy="${H * 0.16}" r="${(i + 1) * 9}"/>`).join("");
  const pillW = opened ? 272 : 348;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`Bearer vault ${serial}, ${name}: ${opened ? "opened" : "sealed"}`)}">
  <defs>
    ${fill}
    <clipPath id="card"><rect width="${W}" height="${H}" rx="31"/></clipPath>
  </defs>
  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <g fill="none" stroke="${look.rings}" stroke-width="1">${rings}</g>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="30.5" fill="none" stroke="${look.text}" stroke-opacity="0.14"/>
  ${text ? `<text x="37" y="58" font-family="${SANS}" font-size="16.8" font-weight="600" letter-spacing="4.4" fill="${look.muted}">BEARER</text>` : ""}
  ${sealSvg(opened, W - 37 - 69, 30, 69)}
  ${
    text
      ? `<text x="37" y="${H * 0.55}" font-family="${SANS}" font-size="32" font-weight="500" fill="${look.text}">${name}</text>
  <text x="37" y="${H * 0.55 + 30}" font-family="${MONO}" font-size="18" fill="${look.muted}">${serial}</text>
  <g transform="translate(37 ${H - 70})">
    <rect width="${pillW}" height="34" rx="17" fill="rgb(${pill.rgb})" fill-opacity="0.18" stroke="rgb(${pill.rgb})" stroke-opacity="0.55"/>
    <text x="16" y="22" font-family="${MONO}" font-size="12.5" font-weight="600" letter-spacing="1.2" fill="${pill.color}">${state}</text>
  </g>`
      : ""
  }
</svg>`;
}
