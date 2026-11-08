/** Shared SVG gradients, rendered once in the root layout so every seal and chain icon can reference them. */
export function BrandDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" className="pointer-events-none absolute">
      <defs>
        <radialGradient id="bearer-wax" cx="36%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#F6E3A1" />
          <stop offset="42%" stopColor="#D4AF3A" />
          <stop offset="100%" stopColor="#7A5E10" />
        </radialGradient>
        <radialGradient id="bearer-wax-dark" cx="36%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#5C4A1A" />
          <stop offset="45%" stopColor="#2E2408" />
          <stop offset="100%" stopColor="#151003" />
        </radialGradient>
        <radialGradient id="bearer-wax-amber" cx="36%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#F9D08A" />
          <stop offset="45%" stopColor="#D97706" />
          <stop offset="100%" stopColor="#7A3E04" />
        </radialGradient>
        <radialGradient id="bearer-wax-dull" cx="36%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#CFC3A0" />
          <stop offset="50%" stopColor="#8F815A" />
          <stop offset="100%" stopColor="#4A4128" />
        </radialGradient>
        <linearGradient id="bearer-sol" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
    </svg>
  );
}
