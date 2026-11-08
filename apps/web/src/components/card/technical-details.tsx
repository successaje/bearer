import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import type { Card } from "@/lib/bearer/types";
import { BEARER_CONTRACT, CODE_HASH, EVM_FINALITY, REPO_URL, SIGNER_CONTRACT } from "@/lib/config";

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-fg-3">{term}</dt>
      <dd className="m-0 min-w-0 text-fg">{children}</dd>
    </>
  );
}

export function TechnicalDetails({ card }: { card: Card }) {
  const hash = CODE_HASH.match(/.{1,4}/g) ?? [];
  return (
    <details className="group overflow-hidden rounded-panel border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-[18px]">
        <span className="text-[16px] font-semibold tracking-[-0.01em]">Technical details</span>
        <ChevronDown aria-hidden className="size-[18px] text-fg-3 transition-transform group-open:rotate-180" />
      </summary>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 border-t border-line px-5 pb-6 pt-5 text-[13.5px] leading-relaxed sm:grid-cols-[minmax(140px,200px)_minmax(0,1fr)] sm:gap-y-3.5 [&_dd]:mb-3 sm:[&_dd]:mb-0">
        <Row term="Token">NEP-171 NFT, token {card.id}</Row>
        <Row term="Contract">
          <span className="font-mono">{BEARER_CONTRACT}</span>
        </Row>
        <Row term="Code hash">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="break-all font-mono">
              {hash.slice(0, 3).join(" ")} … {hash.slice(-2).join(" ")}
            </span>
            <span className="inline-flex items-center gap-1 text-[12.5px] text-ok">
              <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
              Matches the reproducible build
            </span>
          </span>
        </Row>
        <Row term="MPC signer">
          <span className="font-mono">{SIGNER_CONTRACT}</span>
        </Row>
        <Row term="Derivation paths">
          <span className="flex flex-col gap-1 font-mono">
            {(["btc", "evm", "sol"] as const).map((tag) => (
              <span key={tag}>
                bearer:v1:{card.id}:{card.epoch}:{tag}
              </span>
            ))}
          </span>
        </Row>
        <Row term="Base proof finality">{EVM_FINALITY} (batch posted to Sepolia)</Row>
        <Row term="Seal version">
          <span className="font-mono">v{card.logVersion}</span>
        </Row>
        <Row term="Threat model">
          {REPO_URL ? (
            <a href={`${REPO_URL}/blob/main/docs/THREAT_MODEL.md`} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
              docs/THREAT_MODEL.md
            </a>
          ) : (
            <Link href="/how#trust" className="text-accent hover:underline">
              What you&apos;re trusting
            </Link>
          )}
        </Row>
      </dl>
    </details>
  );
}
