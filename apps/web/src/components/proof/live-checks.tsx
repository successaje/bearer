"use client";

import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Skeleton } from "@/components/ui/primitives";
import { explorer } from "@/lib/config";
import { PROOF_CONTRACT, PROOF_RPC, PROOF_SIGNER } from "@/lib/proof/data";
import { curlFor, useLiveChecks } from "@/lib/proof/live";
import { useNow } from "@/lib/vault/hooks";
import { relativeTime } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

const NEAR = 10n ** 24n;
const near = (yocto: string) => `${Number((BigInt(yocto) * 1000n) / NEAR) / 1000} NEAR`;

function Check({
  label,
  value,
  tone,
  children,
  curl,
}: {
  label: string;
  value: ReactNode;
  tone: "ok" | "warn" | "info";
  children: ReactNode;
  curl?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-panel border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">{label}</p>
        {tone === "ok" ? (
          <CheckCircle2 aria-label="Passes" className="size-4 text-ok" />
        ) : tone === "warn" ? (
          <AlertTriangle aria-label="Needs attention" className="size-4 text-warn" />
        ) : null}
      </div>
      <div className="mt-3 min-w-0 text-[22px] font-semibold tracking-[-0.02em]">{value}</div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">{children}</p>
      {curl ? (
        <details className="group mt-auto pt-4">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-fg-3 hover:text-fg">
            Check it yourself
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2.5 flex items-start gap-2 rounded-[10px] border border-line bg-bg p-2.5">
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-fg-2">{curl}</code>
            <CopyButton value={curl} label="Copy command" size="sm" />
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** Live answers from NEAR testnet, fetched by the reader's browser from a public RPC. */
export function LiveChecks() {
  const q = useLiveChecks();
  const now = useNow(5000);
  const d = q.data;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-fg-3" aria-live="polite">
          {q.isFetching ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" /> Asking NEAR testnet…
            </span>
          ) : d && now ? (
            <>
              Checked {relativeTime(d.checkedAt, now)} at block {d.blockHeight.toLocaleString("en-US")} via{" "}
              <span className="font-mono">{new URL(PROOF_RPC).host}</span>
            </>
          ) : q.isError ? (
            <span className="text-danger">Couldn&apos;t reach the RPC: {String(q.error).slice(0, 120)}</span>
          ) : null}
        </p>
        <Button size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn("size-3.5", q.isFetching && "animate-spin")} />
          Run the checks again
        </Button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!d ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[190px] rounded-panel" />)
        ) : (
          <>
            <Check
              label="Contract locked"
              tone={d.fullAccessKeys === 0 ? "ok" : "warn"}
              value={d.fullAccessKeys === 0 ? "Locked" : "Not locked yet"}
              curl={curlFor("view_access_key_list")}
            >
              {d.fullAccessKeys === 0
                ? "No full-access keys: nobody can change or redeploy the contract."
                : `${d.fullAccessKeys} full-access key${d.fullAccessKeys > 1 ? "s" : ""}. This is the spike deployment; the locked, reproducible deploy deletes every full-access key before submission.`}
            </Check>
            <Check label="Code identity" tone="info" value={<span className="font-mono text-[15px]">{d.codeHash.slice(0, 22)}…</span>} curl={curlFor("view_account")}>
              The deployed code hash. The locked deploy publishes the build that reproduces it.{" "}
              <a href={explorer.nearAccount(PROOF_CONTRACT)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline">
                {PROOF_CONTRACT}
                <ArrowUpRight className="size-3" />
              </a>
            </Check>
            <Check label="MPC signer" tone="ok" value={`v${d.signerVersion}`}>
              <span className="font-mono">{PROOF_SIGNER}</span>, NEAR&apos;s threshold signer. Domain 0 signs Bitcoin and Base,
              domain 1 signs Solana.
            </Check>
            <Check label="Vaults minted" tone="info" value={d.vaults} curl={curlFor("call_function", { method_name: "nft_total_supply", args_base64: "e30=" })}>
              Every vault is a NEP-171 token on this contract, so wallets and explorers can list them.
            </Check>
            <Check label="Chains it will sign for" tone="ok" value={`Base Sepolia (${d.config.evm_chain_ids.join(", ")})`}>
              Fixed at deploy: EVM withdrawals for these chain IDs only, Bitcoin testnet4 and Solana devnet addresses.
            </Check>
            <Check label="Deposits" tone="info" value={`${near(d.config.create_deposit)} · ${near(d.config.withdraw_deposit)}`}>
              To create a vault, then per withdrawal (per input for Bitcoin): storage paid up front, so nobody can fill the
              contract for free. Up to {d.config.max_btc_inputs} Bitcoin inputs per withdrawal.
            </Check>
          </>
        )}
      </div>
    </div>
  );
}
