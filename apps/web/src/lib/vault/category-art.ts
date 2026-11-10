import type { CategoryId } from "./category";

/**
 * The art for each category, as SVG drawn in a 200 × 200 box. It brings its own colours, so it
 * reads on every finish, and uses no fonts, so it works in wallets and link previews too.
 * `p` prefixes the gradient ids, so several cards on one page don't share them.
 */

const lin = (id: string, stops: [string, number][], x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([c, o]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;

const ground = (rx: number, cx = 100) => `<ellipse cx="${cx}" cy="184" rx="${rx}" ry="8" fill="#000" fill-opacity=".22"/>`;

const sparkle = (x: number, y: number, s = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0-10l2.6 7.4L10 0l-7.4 2.6L0 10l-2.6-7.4L-10 0l7.4-2.6z" fill="#fff" fill-opacity=".85"/>`;

/** A ₿ drawn with strokes, centred on (x, y), `s` = 1 for a coin about 26 wide. */
const btc = (x: number, y: number, s: number, color: string) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-4-9v18M-6-9h7a4.5 4.5 0 0 1 0 9h-7M-6 0h8a4.5 4.5 0 0 1 0 9h-8M-2-12v3M2-12v3M-2 9v3M2 9v3"/>
  </g>`;

const coin = (p: string, x: number, y: number, r: number, mark = false) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${p}-coin)"/><circle cx="${x}" cy="${y}" r="${r * 0.74}" fill="none" stroke="#a9780f" stroke-opacity=".7" stroke-width="${Math.max(1.2, r / 9)}"/>${mark ? btc(x, y, r / 13, "#7a560a") : ""}`;

const COIN = (p: string) => lin(`${p}-coin`, [["#fff1b3", 0], ["#f2c14e", 0.5], ["#c08a12", 1]], 1, 1);

const ART: Record<CategoryId, (p: string) => string> = {
  gift: (p) => `
    <defs>${lin(`${p}-box`, [["#ff7a7a", 0], ["#d9465e", 1]])}${lin(`${p}-lid`, [["#ff9a9a", 0], ["#e2566b", 1]])}${lin(`${p}-rib`, [["#ffe9a3", 0], ["#e6a822", 1]])}</defs>
    ${ground(66)}
    <rect x="38" y="92" width="124" height="88" rx="10" fill="url(#${p}-box)"/>
    <rect x="88" y="92" width="24" height="88" fill="url(#${p}-rib)"/>
    <rect x="38" y="98" width="124" height="7" fill="#000" fill-opacity=".14"/>
    <rect x="30" y="70" width="140" height="30" rx="8" fill="url(#${p}-lid)"/>
    <rect x="86" y="70" width="28" height="30" fill="url(#${p}-rib)"/>
    <path d="M100 70C88 44 58 34 52 50S78 72 100 70Z" fill="url(#${p}-rib)"/>
    <path d="M100 70C112 44 142 34 148 50S122 72 100 70Z" fill="url(#${p}-rib)"/>
    <path d="M98 68C90 58 72 50 64 56M102 68C110 58 128 50 136 56" fill="none" stroke="#b77d10" stroke-opacity=".45" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="100" cy="70" r="10" fill="#f2c14e"/><circle cx="97" cy="67" r="3" fill="#fff" fill-opacity=".6"/>
    ${sparkle(160, 36)}${sparkle(40, 50, 0.6)}`,

  birthday: (p) => `
    <defs>${lin(`${p}-base`, [["#f9b8cf", 0], ["#e0779d", 1]])}${lin(`${p}-top`, [["#9be0d1", 0], ["#4fb3a0", 1]])}${lin(`${p}-flame`, [["#fff3b0", 0], ["#ffb02e", 0.6], ["#ff6a3d", 1]])}</defs>
    ${ground(72)}
    <ellipse cx="100" cy="174" rx="80" ry="11" fill="#efe9df"/>
    <rect x="34" y="118" width="132" height="56" rx="10" fill="url(#${p}-base)"/>
    <path d="M34 128q0-10 10-10h112q10 0 10 10v8q-8 10-16 0t-16 4q-8 10-16-2t-18 4q-10 10-18-4t-16 2q-8 10-16-4t-16 0z" fill="#fff6ea"/>
    <rect x="56" y="86" width="88" height="36" rx="9" fill="url(#${p}-top)"/>
    <path d="M56 94q0-8 8-8h72q8 0 8 8v6q-6 8-12 0t-12 2q-8 8-16-2t-16 2q-8 8-14-2t-12 0z" fill="#fff6ea"/>
    <g fill="#ffd166">${[76, 100, 124].map((x) => `<rect x="${x - 4}" y="60" width="8" height="28" rx="2"/>`).join("")}</g>
    <g stroke="#ef5b7b" stroke-width="2.2">${[76, 100, 124].map((x) => `<path d="M${x - 4} 68l8-4M${x - 4} 76l8-4M${x - 4} 84l8-4"/>`).join("")}</g>
    ${[76, 100, 124].map((x) => `<path d="M${x} 40c6 7 7 12 0 17-7-5-6-10 0-17z" fill="url(#${p}-flame)"/>`).join("")}
    <g fill="#fff">${[[48, 150], [70, 160], [128, 148], [150, 162], [110, 164]].map(([x, y]) => `<rect x="${x}" y="${y}" width="7" height="3" rx="1.5" transform="rotate(${(x * 7) % 90} ${x} ${y})" fill-opacity=".85"/>`).join("")}</g>`,

  prize: (p) => `
    <defs>${lin(`${p}-gold`, [["#fff1b3", 0], ["#f2c14e", 0.45], ["#b8860b", 1]], 1, 1)}</defs>
    ${ground(58)}
    <rect x="58" y="160" width="84" height="20" rx="4" fill="#5b3a1f"/>
    <rect x="72" y="164" width="56" height="11" rx="2" fill="url(#${p}-gold)"/>
    <path d="M88 128h24l6 26H82z" fill="url(#${p}-gold)"/>
    <rect x="74" y="150" width="52" height="11" rx="3" fill="url(#${p}-gold)"/>
    <path d="M52 52H38c0 26 12 38 26 42M148 52h14c0 26-12 38-26 42" fill="none" stroke="url(#${p}-gold)" stroke-width="9" stroke-linecap="round"/>
    <path d="M50 38h100v22c0 40-22 66-50 72-28-6-50-32-50-72z" fill="url(#${p}-gold)"/>
    <rect x="50" y="38" width="100" height="8" rx="3" fill="#fff6cc" fill-opacity=".75"/>
    <path d="M100 62l6.5 13.2 14.5 2.1-10.5 10.2 2.5 14.5L100 95.2l-13 6.8 2.5-14.5L79 77.3l14.5-2.1z" fill="#fff8dc" fill-opacity=".92"/>
    <path d="M62 56c2 24 10 42 24 54" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/>
    ${sparkle(160, 34)}${sparkle(36, 30, 0.6)}`,

  savings: (p) => `
    <defs>${lin(`${p}-pig`, [["#ffd0e0", 0], ["#f48fb1", 0.55], ["#e0648f", 1]], 1, 1)}${COIN(p)}</defs>
    ${ground(64, 96)}
    <g fill="#e57399">${[58, 80, 110, 132].map((x) => `<rect x="${x}" y="148" width="16" height="32" rx="6"/>`).join("")}</g>
    <path d="M32 118c-14-6-16 12-5 11 7-1 5-11-3-7" fill="none" stroke="#e0648f" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="96" cy="124" rx="66" ry="50" fill="url(#${p}-pig)"/>
    <path d="M70 86l-8-28 30 18z" fill="#f06b98"/>
    <ellipse cx="160" cy="128" rx="15" ry="19" fill="#f48fb1"/><ellipse cx="160" cy="128" rx="11" ry="15" fill="#f9b1c9"/>
    <ellipse cx="156" cy="127" rx="2.4" ry="4" fill="#b84a72"/><ellipse cx="164" cy="127" rx="2.4" ry="4" fill="#b84a72"/>
    <circle cx="134" cy="106" r="5" fill="#3a1f2b"/><circle cx="135.5" cy="104.5" r="1.6" fill="#fff"/>
    <ellipse cx="68" cy="104" rx="20" ry="10" fill="#fff" fill-opacity=".35" transform="rotate(-24 68 104)"/>
    <rect x="80" y="76" width="34" height="7" rx="3.5" fill="#9e3a62"/>
    ${coin(p, 97, 44, 19, true)}
    ${sparkle(140, 30, 0.7)}`,

  capsule: (p) => `
    <defs>${lin(`${p}-wood`, [["#c98b4a", 0], ["#7a4a1f", 1]])}${lin(`${p}-sand`, [["#ffe39a", 0], ["#e9b949", 1]])}</defs>
    ${ground(56)}
    <rect x="56" y="38" width="7" height="130" rx="3" fill="url(#${p}-wood)"/><rect x="137" y="38" width="7" height="130" rx="3" fill="url(#${p}-wood)"/>
    <path d="M68 40h64c0 34-22 46-22 62s22 28 22 62H68c0-34 22-46 22-62S68 74 68 40z" fill="#d7ecff" fill-opacity=".38" stroke="#eef7ff" stroke-opacity=".8" stroke-width="2"/>
    <path d="M76 56h48c-2 18-16 28-24 36-8-8-22-18-24-36z" fill="url(#${p}-sand)"/>
    <rect x="98.6" y="92" width="2.8" height="58" fill="#e9b949"/>
    <path d="M72 162c4-14 15-22 28-24 13 2 24 10 28 24z" fill="url(#${p}-sand)"/>
    <path d="M76 46c2 14 7 24 15 32" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>
    <rect x="48" y="26" width="104" height="15" rx="5" fill="url(#${p}-wood)"/><rect x="48" y="164" width="104" height="15" rx="5" fill="url(#${p}-wood)"/>
    ${sparkle(164, 60, 0.7)}${sparkle(34, 120, 0.5)}`,

  letter: (p) => `
    <defs>${lin(`${p}-heart`, [["#ff7f9e", 0], ["#d6336c", 1]], 1, 1)}${lin(`${p}-paper`, [["#fffaf2", 0], ["#f1e4cc", 1]])}</defs>
    ${ground(70)}
    <g transform="rotate(-7 100 114)">
      <rect x="30" y="62" width="140" height="100" rx="8" fill="url(#${p}-paper)"/>
      <path d="M30 156l54-42M170 156l-54-42" stroke="#e3d2b6" stroke-width="3"/>
      <path d="M33 66h134l-67 50z" fill="#efe0c4"/>
      <path d="M33 66l67 50 67-50" fill="none" stroke="#e3d2b6" stroke-width="2.5"/>
      <path d="M100 138c-14-10-24-18-24-28a12 12 0 0 1 24-4 12 12 0 0 1 24 4c0 10-10 18-24 28z" fill="url(#${p}-heart)"/>
      <path d="M86 110a6 6 0 0 1 8-4" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2.5" stroke-linecap="round"/>
    </g>
    <path d="M158 44c-6-5-10-7-10-11a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 4-4 6-10 11z" fill="#ff8fab"/>
    <path d="M44 40c-4-3-6-5-6-7a3 3 0 0 1 6-.7 3 3 0 0 1 6 .7c0 2-2 4-6 7z" fill="#ffb3c6"/>`,

  pizza: (p) => `
    <defs>${lin(`${p}-crust`, [["#f6c27a", 0], ["#c9822b", 1]])}${lin(`${p}-cheese`, [["#ffe887", 0], ["#f7b733", 1]])}${lin(`${p}-pep`, [["#e85d5d", 0], ["#b83232", 1]], 1, 1)}</defs>
    ${ground(48)}
    <path d="M42 62Q100 36 158 62L100 178z" fill="url(#${p}-cheese)"/>
    <path d="M130 100q5 0 5 9v12a5 5 0 0 1-10 0v-16q0-5 5-5z" fill="#f7c948"/>
    <path d="M30 50Q100 18 170 50l-10 18Q100 40 40 68z" fill="url(#${p}-crust)"/>
    <path d="M44 52Q100 30 156 52" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>
    ${[[76, 80, 12], [122, 78, 11], [102, 140, 9]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${p}-pep)"/>`).join("")}
    <circle cx="100" cy="108" r="14" fill="url(#${p}-pep)"/>${btc(100, 108, 0.95, "#ffe6e6")}
    <path d="M124 126c8-7 18-5 21 1-6 7-16 7-21-1z" fill="#3fa34d"/><path d="M126 126l17 0" stroke="#2c7a37" stroke-width="1.5"/>
    ${sparkle(168, 92, 0.6)}`,

  moon: (p) => `
    <defs>${lin(`${p}-moon`, [["#fff8dc", 0], ["#f2d27a", 1]], 1, 1)}${lin(`${p}-body`, [["#ffffff", 0], ["#c9d4e2", 1]], 1, 0)}${lin(`${p}-fire`, [["#fff3b0", 0], ["#ff9f1c", 0.5], ["#ff5e3a", 1]])}
      <mask id="${p}-cres"><rect width="200" height="200" fill="#fff"/><circle cx="168" cy="40" r="26" fill="#000"/></mask></defs>
    <circle cx="150" cy="54" r="30" fill="url(#${p}-moon)" stroke="#d9a93a" stroke-opacity=".55" stroke-width="2" mask="url(#${p}-cres)"/>
    ${sparkle(46, 34, 0.55)}${sparkle(176, 120, 0.5)}${sparkle(120, 20, 0.4)}
    <g transform="rotate(40 92 116)">
      <path d="M78 128h28c0 16-8 28-14 36-6-8-14-20-14-36z" fill="url(#${p}-fire)"/>
      <path d="M72 106l-18 28 20-6zM112 106l18 28-20-6z" fill="#ef4f4f"/>
      <path d="M92 50c19 16 25 46 20 78H72c-5-32 1-62 20-78z" fill="url(#${p}-body)"/>
      <path d="M92 50c8 7 13 16 16 26H76c3-10 8-19 16-26z" fill="#ef4f4f"/>
      <circle cx="92" cy="94" r="11" fill="#5ab0ff" stroke="#e6edf5" stroke-width="4"/>
      <circle cx="88" cy="90" r="3" fill="#fff" fill-opacity=".7"/>
    </g>`,

  treasure: (p) => `
    <defs>${lin(`${p}-wood`, [["#a0692f", 0], ["#5e3a1a", 1]])}${lin(`${p}-band`, [["#ffe08a", 0], ["#c9942a", 1]])}${COIN(p)}</defs>
    ${ground(72)}
    <ellipse cx="100" cy="94" rx="64" ry="34" fill="#ffe08a" fill-opacity=".35"/>
    <path d="M36 98Q36 50 100 46Q164 50 164 98z" fill="url(#${p}-wood)"/>
    <path d="M36 98Q36 50 100 46Q164 50 164 98" fill="none" stroke="url(#${p}-band)" stroke-width="6"/>
    ${coin(p, 70, 102, 13)}${coin(p, 128, 100, 13)}${coin(p, 86, 92, 13)}${coin(p, 114, 90, 13)}${coin(p, 100, 100, 15, true)}
    <rect x="34" y="104" width="132" height="70" rx="8" fill="url(#${p}-wood)"/>
    <rect x="34" y="104" width="132" height="11" fill="url(#${p}-band)"/>
    <rect x="56" y="104" width="10" height="70" fill="url(#${p}-band)"/><rect x="134" y="104" width="10" height="70" fill="url(#${p}-band)"/>
    <rect x="89" y="120" width="22" height="26" rx="4" fill="url(#${p}-band)"/><path d="M100 128v8" stroke="#5e3a1a" stroke-width="4" stroke-linecap="round"/>
    ${sparkle(160, 54)}${sparkle(42, 62, 0.6)}${sparkle(150, 136, 0.45)}`,
};

/** The inside of a 200 × 200 SVG for this category. */
export function categoryArt(id: CategoryId, prefix: string) {
  return ART[id](prefix.replace(/[^a-zA-Z0-9_-]/g, ""));
}
