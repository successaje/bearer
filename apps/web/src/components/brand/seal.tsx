import { cn } from "@/lib/utils";

export type SealVariant = "monogram" | "check" | "cracked" | "opened";

const WAX_EDGE = { strokeWidth: 12, strokeDasharray: "0.01 8.577", strokeLinecap: "round" as const };

/**
 * The wax seal: intact gold when sealed, cracked amber when action is needed, broken when opened.
 * Gradients come from <BrandDefs />.
 */
export function Seal({
  variant = "monogram",
  tone = "gold",
  className,
  title,
}: {
  variant?: SealVariant;
  /** "dark" is the obsidian wax used on the light card finishes. */
  tone?: "gold" | "dark";
  className?: string;
  title?: string;
}) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };

  if (variant === "opened") {
    return (
      <svg viewBox="0 0 100 100" className={cn("size-10", className)} {...a11y}>
        <path
          d="M50 8A42 42 0 0 0 50 92L44 74 52 60 42 46 50 30Z"
          fill="url(#bearer-wax-dull)"
          transform="translate(-5 2) rotate(-7 50 50)"
        />
        <path
          d="M56 8A42 42 0 0 1 56 92L50 74 58 60 48 46 56 30Z"
          fill="url(#bearer-wax-dull)"
          transform="translate(5 -2) rotate(7 50 50)"
        />
      </svg>
    );
  }

  const wax =
    variant === "cracked" ? "url(#bearer-wax-amber)" : tone === "dark" ? "url(#bearer-wax-dark)" : "url(#bearer-wax)";
  const ink = variant === "cracked" ? "#3D1F02" : tone === "dark" ? "#D4AF3A" : "#5A4409";
  const ring = variant === "cracked" ? "#7A3E04" : tone === "dark" ? "#D4AF3A" : "#6B520E";

  return (
    <svg viewBox="0 0 100 100" className={cn("size-10", className)} {...a11y}>
      <circle cx="50" cy="50" r="41" fill={wax} stroke={wax} {...WAX_EDGE} />
      <circle cx="50" cy="50" r="30" fill="none" stroke={ring} strokeOpacity={0.5} strokeWidth={1.6} />
      {variant === "monogram" ? (
        <path
          d="M40 34h12a8 8 0 0 1 0 16H40z M40 50h14a8 8 0 0 1 0 16H40z"
          fill="none"
          stroke={ink}
          strokeWidth={5}
          strokeLinejoin="round"
        />
      ) : null}
      {variant === "check" ? (
        <path d="M37 51l9 9 18-20" fill="none" stroke="#4A3807" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      {variant === "cracked" ? (
        <path
          d="M53 10 47 32l9 10-10 15 7 13-4 20"
          fill="none"
          stroke={ink}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}
