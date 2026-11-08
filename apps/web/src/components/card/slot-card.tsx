import { ExternalLink, Info } from "lucide-react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { CopyButton } from "@/components/ui/copy-button";
import type { SlotTotals } from "@/lib/bearer/seal";
import type { Card, ChainTag } from "@/lib/bearer/types";
import { IS_SIMULATED, explorer } from "@/lib/config";
import { CHAIN_META, chunkAddress, formatAmount, formatUsd, toUsd } from "@/lib/format";
import { QrDialog } from "./qr-dialog";

function sealNote(card: Card, chain: ChainTag) {
  if (chain === "btc") {
    const n = card.slots.btc.coins.filter((c) => c.encumbered).length;
    return n === 0 ? "0 coins encumbered" : `${n} coin${n > 1 ? "s" : ""} encumbered`;
  }
  if (chain === "evm") {
    const { maxSignedNonce, provenFloor } = card.slots.evm;
    if (maxSignedNonce === null) return "no signatures issued";
    return provenFloor > maxSignedNonce
      ? `nonce${maxSignedNonce > 0 ? `s 0–${maxSignedNonce}` : " 0"} proven`
      : `nonce ${provenFloor} not proven`;
  }
  return card.slots.sol.lastSignedAt === null ? "no signatures issued" : "last signature settled";
}

export function SlotCard({ card, chain, totals }: { card: Card; chain: ChainTag; totals: SlotTotals }) {
  const meta = CHAIN_META[chain];
  const address = card.slots[chain].address;
  const sealedPct = totals.total === 0 ? 100 : Math.round((totals.sealed / totals.total) * 100);
  const evmUnproven =
    chain === "evm" &&
    card.slots.evm.maxSignedNonce !== null &&
    card.slots.evm.provenFloor <= card.slots.evm.maxSignedNonce;

  return (
    <article className="rounded-panel border border-line bg-surface p-5 sm:px-[22px]">
      <div className="flex flex-wrap items-center gap-3.5">
        <ChainIcon chain={chain} className="size-10" />
        <div className="min-w-0 flex-[1_1_160px]">
          <h3 className="text-[16px] font-semibold">{meta.name}</h3>
          <p className="mt-0.5 text-[13px] text-fg-3">{meta.detail}</p>
        </div>
        <div className="text-right">
          <p className="tabular text-[18px] font-semibold">
            {formatAmount(chain, totals.total)} <span className="font-medium text-fg-2">{meta.unit}</span>
          </p>
          <p className="tabular mt-0.5 text-[13px] text-fg-3">{formatUsd(toUsd(chain, totals.total))} est.</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div
          className="h-11 min-w-0 flex-1 truncate rounded-control border border-line bg-bg px-3.5 font-mono text-[13px] leading-[42px] tracking-[0.02em] text-fg"
          title={address}
        >
          {chunkAddress(address)}
        </div>
        <CopyButton value={address} label={`Copy ${meta.name} address`} />
        <QrDialog chain={chain} address={address} />
        {IS_SIMULATED ? (
          <span
            title="Simulated address: no explorer"
            aria-label="Explorer unavailable for simulated addresses"
            className="inline-flex size-11 shrink-0 cursor-not-allowed items-center justify-center rounded-control border border-line bg-surface-2 text-fg-3 opacity-50"
          >
            <ExternalLink className="size-4" />
          </span>
        ) : (
          <a
            href={explorer.address(chain, address)}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${meta.name} address on the explorer`}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-control border border-line bg-surface-2 text-fg-2 transition-colors hover:bg-raised hover:text-fg"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
      </div>

      {chain === "evm" ? (
        <div className="mt-3 flex gap-2.5 rounded-control border border-info/25 bg-info/[0.07] px-3 py-2.5 text-[13px] leading-relaxed text-fg">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          <span>
            <strong className="font-semibold">Send only on Base Sepolia.</strong> This address exists on every EVM network,
            but this version can only open funds on Base Sepolia.
          </span>
        </div>
      ) : null}

      <div className="mt-3.5 flex items-center gap-3 text-[12.5px] text-fg-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div
            className={totals.excluded > 0 || evmUnproven ? "h-full bg-[#D97706]" : "h-full bg-[#1F9D55]"}
            style={{ width: `${sealedPct}%` }}
          />
        </div>
        <span>
          {totals.excluded > 0 ? (
            <span className="text-warn">
              {formatAmount(chain, totals.excluded)} {meta.unit} excluded
            </span>
          ) : evmUnproven ? (
            <span className="text-warn">Needs proof</span>
          ) : (
            <span className="text-ok">All sealed</span>
          )}{" "}
          · {sealNote(card, chain)}
        </span>
      </div>
    </article>
  );
}
