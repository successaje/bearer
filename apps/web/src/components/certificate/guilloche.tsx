/**
 * Guilloche, drawn the way banknote engravers do it: hypotrochoids (spirograph curves) for the
 * rosettes and phase-shifted sine waves for the border. Pure math, so it prints crisply at any
 * size and needs no images.
 */

/** The curve a spirograph draws. Closes after `r / gcd(R, r)` turns. */
function hypotrochoid(R: number, r: number, d: number, scale = 1) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const turns = r / gcd(R, r);
  const steps = Math.ceil(turns * 180);
  const k = (R - r) / r;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * 2 * Math.PI;
    const x = ((R - r) * Math.cos(t) + d * Math.cos(k * t)) * scale;
    const y = ((R - r) * Math.sin(t) - d * Math.sin(k * t)) * scale;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

const ROSETTE_LAYERS: [number, number, number, number][] = [
  // R, r, d, stroke width
  [60, 22, 34, 0.35],
  [60, 22, 26, 0.3],
  [48, 18, 20, 0.28],
  [36, 14, 12, 0.25],
];

/** A banknote rosette, centred on (0, 0) with radius ≈ 100 × `size`/100. */
export function Rosette({ x, y, size, opacity = 1 }: { x: number; y: number; size: number; opacity?: number }) {
  const scale = size / 100;
  return (
    <g transform={`translate(${x} ${y})`} opacity={opacity} fill="none" stroke="currentColor">
      {ROSETTE_LAYERS.map(([R, r, d, w]) => (
        <path key={`${R}-${r}-${d}`} d={hypotrochoid(R, r, d, scale)} strokeWidth={w * scale} />
      ))}
      <circle r={size * 0.98} strokeWidth={0.4 * scale} />
    </g>
  );
}

function wave(x0: number, x1: number, y: number, amp: number, len: number, phase: number) {
  const steps = Math.ceil(((x1 - x0) / len) * 24);
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    pts.push(`${x.toFixed(2)},${(y + amp * Math.sin(((x - x0) / len) * 2 * Math.PI + phase)).toFixed(2)}`);
  }
  return `M${pts.join("L")}`;
}

/**
 * The certificate's frame in millimetres (A4 landscape, 297 × 210): ruled outer and inner
 * borders, a band of interlaced waves between them, and a rosette in each corner.
 */
export function CertificateFrame() {
  const W = 297;
  const H = 210;
  const outer = 7;
  const inner = 15;
  const mid = (outer + inner) / 2;
  const amp = (inner - outer) / 2 - 0.9;
  const phases = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3];
  const len = 9;
  const bands: string[] = [];
  for (const p of phases) {
    bands.push(wave(inner, W - inner, mid, amp, len, p)); // top
    bands.push(wave(inner, W - inner, H - mid, amp, len, p)); // bottom
  }
  // Vertical bands: draw horizontally, then rotate into place.
  const side: string[] = phases.map((p) => wave(inner, H - inner, 0, amp, len, p));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className="absolute inset-0 size-full">
      <g fill="none" stroke="currentColor">
        <rect x={outer - 2.2} y={outer - 2.2} width={W - 2 * (outer - 2.2)} height={H - 2 * (outer - 2.2)} strokeWidth={0.5} />
        <rect x={outer} y={outer} width={W - 2 * outer} height={H - 2 * outer} strokeWidth={0.25} />
        <rect x={inner} y={inner} width={W - 2 * inner} height={H - 2 * inner} strokeWidth={0.25} />
        <rect x={inner + 1.6} y={inner + 1.6} width={W - 2 * (inner + 1.6)} height={H - 2 * (inner + 1.6)} strokeWidth={0.12} />
        <g strokeWidth={0.14} opacity={0.85}>
          {bands.map((d, i) => (
            <path key={i} d={d} />
          ))}
          {side.map((d, i) => (
            <g key={`s${i}`}>
              <path d={d} transform={`translate(${mid} 0) rotate(90)`} />
              <path d={d} transform={`translate(${W - mid} 0) rotate(90)`} />
            </g>
          ))}
        </g>
      </g>
      {[
        [mid, mid],
        [W - mid, mid],
        [mid, H - mid],
        [W - mid, H - mid],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={8.6} fill="var(--paper)" />
          <Rosette x={x} y={y} size={7.8} />
        </g>
      ))}
    </svg>
  );
}

/** The big faint watermark rosette behind the text. */
export function Watermark() {
  return (
    <svg viewBox="-100 -100 200 200" aria-hidden className="absolute left-1/2 top-1/2 h-[78%] -translate-x-1/2 -translate-y-1/2">
      <Rosette x={0} y={0} size={98} />
    </svg>
  );
}
