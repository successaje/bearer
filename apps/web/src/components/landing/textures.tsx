import { cn } from "@/lib/utils";

/** Drifting dot screen behind a chapter's visual. Colour comes from `currentColor`. */
export function Halftone({ className }: { className?: string }) {
  return <div aria-hidden className={cn("halftone texture-anim pointer-events-none absolute", className)} />;
}

const PETALS = 40;

/** A banknote-style rosette, turning very slowly. Colour comes from `currentColor`. */
export function Guilloche({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="-100 -100 200 200"
      className={cn("texture-anim pointer-events-none absolute animate-[spin_180s_linear_infinite]", className)}
    >
      <g fill="none" stroke="currentColor" strokeWidth="0.35">
        {Array.from({ length: PETALS }, (_, i) => (
          <ellipse key={i} rx="96" ry="34" transform={`rotate(${(i * 180) / PETALS})`} />
        ))}
        {Array.from({ length: PETALS }, (_, i) => (
          <ellipse key={`in-${i}`} rx="52" ry="20" transform={`rotate(${(i * 180) / PETALS + 2.25})`} />
        ))}
        <circle r="98" />
        <circle r="18" />
      </g>
    </svg>
  );
}

/**
 * Stepped edge between two full-bleed chapters, like braintrust.dev's section breaks.
 * `from` is the chapter above (a bg-* class), `to` the one below (a fill-* class).
 */
export function StepEdge({ from, to, flip = false }: { from: string; to: string; flip?: boolean }) {
  const steps = 8;
  const w = 1200 / steps;
  let d = "M0 56";
  for (let i = 0; i < steps; i++) d += ` V${48 - i * 6} H${(i + 1) * w}`;
  d += " V57 H0 Z";
  return (
    // -mb-px tucks the edge over the next chapter so no hairline shows between them.
    <div aria-hidden className={cn("relative z-[1] -mb-px h-8 md:h-14", from)}>
      <svg viewBox="0 0 1200 56" preserveAspectRatio="none" overflow="visible" className={cn("block size-full", flip && "-scale-x-100")}>
        <path d={d} className={to} />
      </svg>
    </div>
  );
}
