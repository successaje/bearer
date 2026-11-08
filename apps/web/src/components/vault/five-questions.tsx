import type { Answer } from "@/lib/vault/report";

/** Brief 3.7: the questions anyone holding money asks, answered in plain words. */
export function FiveQuestions({ answers }: { answers: Answer[] }) {
  return (
    <section aria-labelledby="five-q" className="overflow-hidden rounded-panel border border-line bg-surface">
      <h2 id="five-q" className="sr-only">
        About this vault
      </h2>
      <dl className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-5 [&>div]:bg-surface">
        {answers.map((x, i) => (
          <div key={x.q} className="p-5">
            <dt className="flex items-baseline gap-2 text-[13.5px] font-semibold">
              <span className="font-mono text-[11px] font-medium text-fg-3">{String(i + 1).padStart(2, "0")}</span>
              {x.q}
            </dt>
            <dd className="m-0 mt-2 text-[13.5px] leading-relaxed text-fg-2">{x.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
