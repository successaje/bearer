"use client";

import type {
  ChainObservation,
  ChainTag,
  HandoverSchedule,
  MarketListing,
  VaultLoan,
  StandingPlan,
  VaultSwitch,
  VaultView,
} from "@bearer/sdk";
import { ArrowLeft, ExternalLink, Info, Link2, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { Seal } from "@/components/brand/seal";
import { QrCodeBlock } from "@/components/card/qr-dialog";
import { EmptyState, ErrorState } from "@/components/layout/page-states";
import { buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Callout, FieldMessage, Input, Label, Skeleton } from "@/components/ui/primitives";
import { SegmentedList, SegmentedRoot, SegmentedTrigger } from "@/components/ui/segmented";
import { IS_SIMULATED, LEND_CONTRACT, MARKET_CONTRACT, SCHEDULE_CONTRACT, STANDING_CONTRACT, SWITCH_CONTRACT } from "@/lib/config";
import {
  CHAIN_META,
  chunkAddress,
  formatAmount,
  formatDate,
  fromDecimal,
  nsToMs,
  shortAccount,
  vaultNumber,
} from "@/lib/vault/format";
import { useListing, useLoan, useNow, useObservation, useSchedule, useStandingPlan, useSwitch, useVault } from "@/lib/vault/hooks";
import { exactAmount, NOTE_MAX, parsePayRequest, payPath, paymentUri, type PayRequest } from "@/lib/vault/pay";
import { isSealed } from "@/lib/vault/report";

const CHAINS = ["btc", "evm", "sol"] as const;
const noop = () => () => {};

const addressOf = (vault: VaultView, chain: ChainTag) =>
  chain === "btc" ? vault.btc_address : chain === "evm" ? vault.evm_address : vault.sol_address;

/** One view per request: opening another request starts fresh, on the coin it asks for. */
export function PayView() {
  const search = useSearchParams();
  return <RequestView key={search.toString()} request={parsePayRequest(search)} />;
}

function RequestView({ request }: { request: PayRequest }) {
  const { id } = useParams<{ id: string }>();
  const query = useVault(id);
  const vault = query.data;
  const obs = useObservation(vault?.keys ? vault : null);
  const listing = useListing(id).data ?? null;
  const schedule = useSchedule(id).data ?? null;
  const loan = useLoan(id).data ?? null;
  const sw = useSwitch(id).data ?? null;
  const plan = useStandingPlan(id).data ?? null;
  const [picked, setPicked] = useState<ChainTag | null>(null);
  const now = useNow(30_000);

  if (query.isPending || !now)
    return (
      <Frame id={id}>
        <Skeleton className="h-[520px] w-full rounded-[22px]" />
      </Frame>
    );
  if (query.isError)
    return (
      <Frame id={id}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Frame>
    );
  if (!vault) {
    return (
      <Frame id={id}>
        <EmptyState seal="opened" title={`There's no vault ${vaultNumber(id)}`}>
          Check the number in the link. A payment link only ever pays the vault it names.
        </EmptyState>
      </Frame>
    );
  }

  const chain = picked ?? request.chain ?? "btc";
  const amount = chain === request.chain ? request.amount : null;
  const meta = CHAIN_META[chain];
  const address = addressOf(vault, chain);
  const observation = obs.data?.find((o) => o.chain === chain);

  return (
    <Frame id={id}>
      {IS_SIMULATED ? (
        <Callout tone="warn" icon={<TriangleAlert />} className="mb-5">
          <strong className="font-semibold">This is the simulated demo.</strong> These addresses are examples:
          don&apos;t send anything to them. The hosted site shows a real vault&apos;s testnet addresses.
        </Callout>
      ) : null}

      <div className="border-line bg-surface rounded-[22px] border p-6 md:p-8">
        <div className="flex items-start gap-4">
          <Seal variant="monogram" className="hidden size-14 shrink-0 sm:block" />
          <div className="min-w-0">
            <p className="text-gold font-mono text-[12px] tracking-[0.14em] uppercase">
              {request.amount ? "Payment request" : "Pay this vault"} · {vaultNumber(id)}
            </p>
            <h1 className="mt-1.5 text-[28px] leading-tight font-semibold tracking-[-0.02em]">
              {request.chain && request.amount
                ? `Pay ${exactAmount(request.chain, request.amount)}`
                : `Pay into ${vault.name ?? `vault ${vaultNumber(id)}`}`}
            </h1>
            <p className="text-fg-2 mt-1 text-[15px] leading-relaxed">
              {request.amount && vault.name ? `To ${vault.name}. ` : ""}
              Pay on Bitcoin testnet4, Base Sepolia or Solana devnet. Whatever you send belongs to whoever holds the
              vault.
            </p>
          </div>
        </div>

        {request.note ? (
          <figure className="border-line bg-surface-2 mt-5 rounded-[14px] border px-4 py-3">
            <blockquote className="text-fg text-[15px] leading-relaxed">&ldquo;{request.note}&rdquo;</blockquote>
            <figcaption className="text-fg-3 mt-1 text-[12.5px]">
              A note from whoever made this link. Bearer doesn&apos;t check it; the addresses below come from the
              contract.
            </figcaption>
          </figure>
        ) : null}

        <SegmentedRoot value={chain} onValueChange={(v) => setPicked(v as ChainTag)} className="mt-6">
          <SegmentedList aria-label="Pay with" className="grid grid-cols-3">
            {CHAINS.map((c) => (
              <SegmentedTrigger key={c} value={c}>
                <ChainIcon chain={c} className="size-[18px]" />
                {CHAIN_META[c].name}
              </SegmentedTrigger>
            ))}
          </SegmentedList>
        </SegmentedRoot>

        {request.chain && request.amount && chain !== request.chain ? (
          <p className="text-fg-3 mt-3 text-[13px] leading-relaxed">
            This request asks for {exactAmount(request.chain, request.amount)}. {meta.unit} sent here reaches the same
            vault, but whether it settles the request is between you and the holder.
          </p>
        ) : null}

        {address ? (
          <div className="mt-6 grid items-center gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-2">
              <QrCodeBlock
                value={paymentUri(chain, address, id, amount, request.note)}
                label={`QR code to pay ${amount ? exactAmount(chain, amount) : meta.unit} to ${meta.name} ${meta.network} address ${address}`}
                size={188}
              />
              <span className="text-fg-3 text-[12.5px]">{amount ? "Includes the amount" : "The address only"}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {amount ? (
                <Row label="Amount">
                  <span className="text-fg min-w-0 flex-1 font-mono text-[15px]">{exactAmount(chain, amount)}</span>
                  <CopyButton value={exactAmount(chain, amount).split(" ")[0]} label="Copy amount" size="sm" />
                </Row>
              ) : null}
              <Row label={`${meta.name} ${meta.network} address`}>
                <span className="text-fg min-w-0 flex-1 font-mono text-[13px] leading-relaxed break-all">
                  {chunkAddress(address)}
                </span>
                <CopyButton value={address} label={`Copy ${meta.name} address`} size="sm" />
              </Row>
              <Callout tone={chain === "evm" ? "info" : "neutral"} icon={<Info />}>
                {chain === "evm" ? (
                  <>
                    <strong className="font-semibold">Send only ETH on Base Sepolia.</strong> Coins on other networks
                    can&apos;t be withdrawn by this version.
                  </>
                ) : (
                  <>
                    <strong className="font-semibold">
                      Send only {meta.unit} on {meta.name} {meta.network}.
                    </strong>{" "}
                    Mainnet coins sent here are lost.
                  </>
                )}{" "}
                Native coins only: tokens and NFTs can&apos;t be withdrawn.
              </Callout>
            </div>
          </div>
        ) : (
          <p className="text-fg-2 mt-6 inline-flex items-center gap-2 text-[14px]" aria-live="polite">
            <Loader2 className="size-4 animate-spin" />
            Waiting for NEAR&apos;s signer to derive this vault&apos;s addresses; it takes a block or two after
            creation.
          </p>
        )}
      </div>

      <section className="border-line bg-surface mt-5 rounded-[22px] border p-6 md:p-8">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Who gets paid</h2>
        <div className="text-fg-2 mt-3 space-y-3 text-[14.5px] leading-relaxed">
          <Payee vault={vault} listing={listing} schedule={schedule} loan={loan} sw={sw} plan={plan} now={now} />
        </div>
      </section>

      {address ? (
        <section className="border-line bg-surface mt-5 rounded-[22px] border p-6 md:p-8">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
            Paid in on {meta.name} {meta.network}
          </h2>
          <Received chain={chain} observation={observation} loading={obs.isPending} requested={amount} />
        </section>
      ) : null}

      <RequestBuilder tokenId={id} initialChain={chain} />
    </Frame>
  );
}

/** Who a payment reaches: the vault's holder now, and where the vault (with what's in it) goes next. */
function Payee({
  vault,
  listing,
  schedule,
  loan,
  sw,
  plan,
  now,
}: {
  vault: VaultView;
  listing: MarketListing | null;
  schedule: HandoverSchedule | null;
  loan: VaultLoan | null;
  sw: VaultSwitch | null;
  plan: StandingPlan | null;
  /** ms since epoch, from useNow: decides whether a loan or a schedule's date has passed. */
  now: number;
}) {
  const sealed = isSealed(vault);
  const who = (account: string) => (
    <span className="text-fg font-mono text-[13.5px]" title={account}>
      {shortAccount(account)}
    </span>
  );
  const b = (text: string) => <strong className="text-fg font-semibold">{text}</strong>;
  let where: ReactNode;
  if (listing && vault.owner_id === MARKET_CONTRACT) {
    where =
      listing.state.kind === "selling" ? (
        <>
          It&apos;s {b("being sold")} to {who(listing.state.buyer)}, and what you pay goes to them with the vault.
        </>
      ) : (
        <>
          It&apos;s {b("for sale")}, listed by {who(listing.seller)}. If someone buys it, what you pay goes to the buyer
          with the vault; if the seller takes it off the market, it&apos;s theirs.
        </>
      );
  } else if (schedule && vault.owner_id === SCHEDULE_CONTRACT) {
    const due = nsToMs(schedule.release_at_ns) <= now;
    where = due ? (
      <>
        It&apos;s {b("scheduled")} for {who(schedule.recipient)}, and the date has come: anyone can now hand it to them,
        with what you pay.
      </>
    ) : (
      <>
        It&apos;s {b("scheduled")} to pass to {who(schedule.recipient)} on {formatDate(nsToMs(schedule.release_at_ns))},
        with what you pay.
        {schedule.cancellable ? (
          <> Until then {who(schedule.giver)} can take it back, and with it what you pay.</>
        ) : null}
      </>
    );
  } else if (loan && vault.owner_id === LEND_CONTRACT) {
    const s = loan.state;
    where =
      s.kind === "requested" || s.kind === "cancelling" ? (
        <>
          {who(loan.borrower)} has {b("pledged")} it for a loan nobody has funded yet. Until someone does, they can take
          it back, with what you pay.
        </>
      ) : s.kind === "repaying" ? (
        <>
          It&apos;s {b("going back")} to {who(loan.borrower)}, who is repaying their loan, with what you pay.
        </>
      ) : s.kind === "foreclosing" || nsToMs(s.due_at_ns) <= now ? (
        <>
          It was {b("collateral")} for a loan to {who(loan.borrower)}, due on {formatDate(nsToMs(s.due_at_ns))} and not
          repaid. It now goes to the lender, {who(s.lender)}, whenever they take it, with what you pay.
        </>
      ) : (
        <>
          It&apos;s {b("collateral")} for a loan to {who(loan.borrower)}. If they repay by{" "}
          {formatDate(nsToMs(s.due_at_ns))}, it goes back to them with what you pay; if not, {who(s.lender)} can take
          it.
        </>
      );
  } else if (sw && vault.owner_id === SWITCH_CONTRACT) {
    where = (
      <>
        It&apos;s in a {b("dead man's switch")} set by {who(sw.owner)}. While they keep checking in it stays theirs; if
        they go quiet, it passes to {who(sw.beneficiary)}, with what you pay.
      </>
    );
  } else if (plan && vault.owner_id === STANDING_CONTRACT) {
    where = (
      <>
        It {b("pays")} {who(plan.payee)} a fixed amount every period, set up by {who(plan.giver)}. What you pay tops it
        up: it can fund those payments, and {who(plan.giver)} can withdraw what&apos;s left once the plan lets them.
      </>
    );
  } else {
    where = <>It&apos;s held by {who(vault.owner_id)}.</>;
  }

  return (
    <>
      <p>
        <strong className="text-fg font-semibold">Whoever holds vault {vaultNumber(vault.token_id)}.</strong> {where}
      </p>
      {sealed ? (
        <p>
          It&apos;s <strong className="text-fg font-semibold">sealed</strong>: no withdrawal has ever been signed from
          it, so everything paid in is still inside. A payment link pays the vault, not a person: if the vault changes
          hands, later payments go to its new holder. That&apos;s what lets a vault be sold as something that gets paid.
        </p>
      ) : vault.state.kind === "opened" ? (
        <p>
          Its seal was broken on {formatDate(nsToMs(vault.state.at_ns))}, so its holder can withdraw whenever they like.
          An opened vault can&apos;t be handed on, so payments stay with{" "}
          {plan && vault.owner_id === STANDING_CONTRACT ? "it" : who(vault.owner_id)}.
        </p>
      ) : null}
    </>
  );
}

/** What has arrived at the address: the balance, and each payment with whether its chain has confirmed it. */
function Received({
  chain,
  observation,
  loading,
  requested,
}: {
  chain: ChainTag;
  observation: ChainObservation | undefined;
  loading: boolean;
  requested: bigint | null;
}) {
  const meta = CHAIN_META[chain];
  if (!observation) {
    return loading ? (
      <Skeleton className="mt-4 h-16 w-full rounded-[14px]" />
    ) : (
      <p className="text-fg-3 mt-3 text-[14px]">
        Couldn&apos;t reach {meta.name} {meta.network} just now. This page tries again on its own.
      </p>
    );
  }
  const pending = BigInt(observation.pending);
  return (
    <div className="mt-3">
      <p className="text-fg-2 text-[14.5px] leading-relaxed">
        In the vault now:{" "}
        <span className="text-fg font-mono">
          {formatAmount(chain, observation.confirmed)} {meta.unit}
        </span>{" "}
        confirmed
        {pending > 0n ? (
          <>
            , plus{" "}
            <span className="text-fg font-mono">
              {formatAmount(chain, pending)} {meta.unit}
            </span>{" "}
            seen but not confirmed yet
          </>
        ) : null}
        .
      </p>

      {chain === "evm" ? (
        <p className="text-fg-3 mt-3 text-[13.5px] leading-relaxed">
          A plain Base Sepolia RPC can&apos;t list single payments. Each one is on the explorer.
        </p>
      ) : observation.deposits.length ? (
        <ul className="divide-line border-line mt-4 divide-y rounded-[14px] border">
          {observation.deposits.map((d) => (
            <li key={d.txHash} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]">
              <span className="text-fg font-mono">
                +{formatAmount(chain, d.amount)} {meta.unit}
              </span>
              <span className={d.confirmed ? "text-ok" : "text-warn"}>
                {d.confirmed ? "Confirmed" : "Seen, not confirmed yet"}
              </span>
              {requested !== null && BigInt(d.amount) === requested ? (
                <span className="border-gold/40 text-gold rounded-full border px-2 py-0.5 text-[12px]">
                  Same amount as this request
                </span>
              ) : null}
              <span className="text-fg-3 ml-auto text-[13px]">{formatDate(d.at)}</span>
              {d.explorerUrl ? (
                <a
                  href={d.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-fg-2 hover:text-fg text-[13px] underline-offset-4 hover:underline"
                >
                  View
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-3 mt-3 text-[13.5px] leading-relaxed">
          Nothing yet. A payment shows here within seconds of being sent, and is marked confirmed once {meta.name}{" "}
          confirms it.
        </p>
      )}

      <p className="text-fg-3 mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
        <span>
          {observation.simulated
            ? "Simulated, like the rest of this demo."
            : `Read from ${observation.source}, every few seconds.`}
        </span>
        <a
          href={observation.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-fg-2 hover:text-fg inline-flex items-center gap-1"
        >
          The address on the explorer
          <ExternalLink className="size-3" />
        </a>
      </p>
    </div>
  );
}

/** Builds a payment link for this vault: a coin, an amount and a note. Anyone can make one; it holds no secret. */
function RequestBuilder({ tokenId, initialChain }: { tokenId: string; initialChain: ChainTag }) {
  const [chain, setChain] = useState<ChainTag>(initialChain);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const origin = useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => "",
  );

  const parsed = amount.trim() ? fromDecimal(chain, amount) : null;
  const invalid = amount.trim() !== "" && (parsed === null || parsed === 0n);
  const path = payPath(tokenId, { chain, amount: invalid ? null : parsed, note });
  const url = `${origin}${path}`;
  const meta = CHAIN_META[chain];

  return (
    <section className="border-line bg-surface mt-5 rounded-[22px] border p-6 md:p-8">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Ask for a payment</h2>
      <p className="text-fg-2 mt-1.5 text-[14px] leading-relaxed">
        Set an amount and a note, then share the link. It opens this page with the amount filled in, and the QR code
        carries it into the payer&apos;s wallet.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <Label htmlFor="pay-chain">Coin</Label>
          <SegmentedRoot value={chain} onValueChange={(v) => setChain(v as ChainTag)} className="mt-1.5">
            <SegmentedList id="pay-chain" aria-label="Coin" className="grid grid-cols-3">
              {CHAINS.map((c) => (
                <SegmentedTrigger key={c} value={c} className="px-2">
                  <ChainIcon chain={c} className="size-4" />
                  <span className="text-[13px]">{CHAIN_META[c].unit}</span>
                </SegmentedTrigger>
              ))}
            </SegmentedList>
          </SegmentedRoot>
        </div>
        <div>
          <Label htmlFor="pay-amount">Amount ({meta.unit})</Label>
          <Input
            id="pay-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Any amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? "pay-amount-error" : undefined}
            className="mt-1.5 font-mono"
          />
          {invalid ? (
            <FieldMessage id="pay-amount-error" tone="error">
              Use a plain number above zero, like 0.0005.
            </FieldMessage>
          ) : null}
        </div>
      </div>
      <div className="mt-4">
        <Label htmlFor="pay-note">Note (optional)</Label>
        <Input
          id="pay-note"
          maxLength={NOTE_MAX}
          autoComplete="off"
          placeholder="Invoice 42, tips for the stream…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1.5"
        />
      </div>

      <div className="rounded-control border-line bg-bg mt-5 flex items-center gap-2 border py-1 pr-1 pl-3">
        <Link2 className="text-fg-3 size-4 shrink-0" aria-hidden />
        <span className="text-fg min-w-0 flex-1 truncate font-mono text-[12.5px]" title={url}>
          {url}
        </span>
        <CopyButton value={url} label="Copy payment link" size="sm" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={path} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Open this request
        </Link>
        <span className="text-fg-3 text-[13px] leading-relaxed">
          A payment link isn&apos;t a key: it names the vault, the amount and the note, nothing secret. A Bearer link is
          the vault&apos;s key; never share that one like this.
        </span>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-fg-3 text-[12.5px]">{label}</p>
      <div className="rounded-control border-line bg-bg mt-1 flex items-center gap-2 border py-1 pr-1 pl-3">
        {children}
      </div>
    </div>
  );
}

function Frame({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[760px] px-5 pt-8 pb-16 md:px-8 md:pt-12">
      <Link
        href={`/v/${id}`}
        className="text-fg-2 hover:text-fg mb-6 inline-flex items-center gap-1.5 text-[13.5px] font-medium transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back to vault {vaultNumber(id)}
      </Link>
      {children}
    </div>
  );
}
