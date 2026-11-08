"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Seal } from "@/components/brand/seal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HOLD_MS = 1200;

// Crack lines drawn across the seal as you hold (viewBox 0..100).
const CRACKS = [
  "M52 8 L47 26 L56 38 L45 52 L54 64 L48 80 L51 94",
  "M47 26 L33 30 L24 22",
  "M56 38 L70 34 L80 40",
  "M45 52 L30 58 L20 54",
  "M54 64 L68 70 L76 80",
];

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Break the seal by pressing and holding it (brief 10.2). Releasing early does nothing.
 * Keyboard: hold Enter or Space. Reduced motion: a plain confirm button.
 */
export function SealPress({ onBreak, disabled }: { onBreak: () => void; disabled?: boolean }) {
  const [progress, setProgress] = useState(0);
  const [broken, setBroken] = useState(false);
  const [reduced, setReduced] = useState(false);
  const start = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const done = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(prefersReducedMotion());
  }, []);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    start.current = null;
  }, []);

  const begin = () => {
    if (disabled || done.current || raf.current) return;
    const loop = (t: number) => {
      if (start.current === null) start.current = t;
      const p = Math.min(1, (t - start.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        stop();
        if (!done.current) {
          done.current = true;
          setBroken(true);
          if ("vibrate" in navigator) navigator.vibrate?.(30);
          setTimeout(onBreak, 450);
        }
        return;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };

  const cancel = () => {
    if (done.current) return;
    stop();
    setProgress(0);
  };

  useEffect(() => stop, [stop]);

  if (reduced) {
    return (
      <Button variant="primary" size="lg" className="w-full" disabled={disabled} onClick={onBreak}>
        Break the seal
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        disabled={disabled}
        aria-label="Press and hold to break the seal"
        aria-describedby="seal-press-hint"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          begin();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
            e.preventDefault();
            begin();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === "Enter" || e.key === " ") cancel();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          "relative size-44 touch-none select-none rounded-full outline-offset-8 transition-transform duration-150",
          progress > 0 && !broken && "scale-[0.97]",
          disabled && "opacity-60",
        )}
      >
        {/* Progress ring */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r="48" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke="#C9A227"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={301.6}
            strokeDashoffset={301.6 * (1 - progress)}
          />
        </svg>

        {broken ? (
          <span className="absolute inset-4 animate-[seal-split_450ms_cubic-bezier(0.2,0.8,0.2,1)_forwards]">
            <Seal variant="opened" className="size-full" />
          </span>
        ) : (
          <span className="absolute inset-4">
            <Seal variant="monogram" className="size-full" />
            <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
              {CRACKS.map((d, i) => {
                // Each crack starts a little later, so they spread from the centre.
                const local = Math.max(0, Math.min(1, (progress - i * 0.12) / 0.6));
                return (
                  <path
                    key={d}
                    d={d}
                    pathLength={1}
                    fill="none"
                    stroke="#3D1F02"
                    strokeWidth={i === 0 ? 3 : 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="1"
                    strokeDashoffset={1 - local}
                  />
                );
              })}
            </svg>
          </span>
        )}
      </button>
      <p id="seal-press-hint" className="mt-5 text-center text-[13.5px] text-fg-2" aria-live="polite">
        {broken ? "Seal broken." : progress > 0 ? "Keep holding…" : "Press and hold the seal to break it"}
      </p>
    </div>
  );
}
