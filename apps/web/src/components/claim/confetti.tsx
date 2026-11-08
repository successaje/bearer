const COLORS = ["#C9A227", "#E8CD7A", "#F4F4F5", "#7A5E10", "#4ACB85"];

/** CSS-only confetti; hidden entirely under prefers-reduced-motion (brief 3.7). */
export function Confetti({ pieces = 36 }: { pieces?: number }) {
  return (
    <div aria-hidden className="motion-hide pointer-events-none absolute inset-x-0 top-0 h-[360px] overflow-hidden">
      {Array.from({ length: pieces }, (_, i) => {
        // Deterministic spread so server and client render the same thing.
        const left = (i * 37) % 100;
        const delay = (i % 9) * 0.09;
        const duration = 1.6 + ((i * 13) % 10) / 10;
        const drift = ((i * 53) % 120) - 60;
        const size = 6 + (i % 4) * 2;
        return (
          <span
            key={i}
            className="absolute top-0 block rounded-[2px]"
            style={
              {
                left: `${left}%`,
                width: size,
                height: size * 0.45,
                background: COLORS[i % COLORS.length],
                animation: `confetti-fall ${duration}s cubic-bezier(0.2,0.6,0.4,1) ${delay}s both`,
                "--drift": `${drift}px`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
