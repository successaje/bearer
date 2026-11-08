"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Sticky section index that follows the reader down the page. */
export function SectionIndex({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav aria-label="On this page" className="lg:sticky lg:top-28">
      <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-fg-3">On this page</p>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 lg:flex-col lg:gap-0 lg:border-l lg:border-line">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={active === s.id ? "true" : undefined}
              className={cn(
                "block font-mono text-[12px] uppercase tracking-[0.12em] text-fg-3 transition-colors hover:text-fg lg:-ml-px lg:border-l lg:border-transparent lg:py-2 lg:pl-4",
                active === s.id && "text-fg lg:border-gold",
              )}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
