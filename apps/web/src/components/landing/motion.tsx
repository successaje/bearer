"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Drives the landing page's motion (brief 10.3). Reveals `[data-reveal]` blocks as they
 * enter and flags `[data-inview]` elements so their textures pause off-screen.
 * Blocks hide only once this runs, and never ones already on screen, so the page
 * reads fine without JavaScript.
 */
export function RevealObserver() {
  useEffect(() => {
    const root = document.documentElement;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal], [data-inview]"));
    const height = window.innerHeight;
    for (const node of nodes) {
      const r = node.getBoundingClientRect();
      if (node.hasAttribute("data-reveal") && r.top < height && r.bottom > 0) node.setAttribute("data-shown", "");
    }
    root.classList.add("reveal-ready");

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (el.hasAttribute("data-inview")) el.setAttribute("data-inview", String(e.isIntersecting));
          if (e.isIntersecting && el.hasAttribute("data-reveal")) el.setAttribute("data-shown", "");
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const node of nodes) io.observe(node);
    return () => {
      io.disconnect();
      root.classList.remove("reveal-ready");
    };
  }, []);
  return null;
}

export function useInView<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
