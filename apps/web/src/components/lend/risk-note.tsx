"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Check as CheckIcon, Cpu, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { SimulatedTag } from "@/components/ui/primitives";
import { IS_SIMULATED } from "@/lib/config";
import type { Check, ModelEvidence, RiskNoteResult, RiskNoteStatus, RiskRating } from "@/lib/nearai/types";
import { cn } from "@/lib/utils";

const RATING: Record<RiskRating, { label: string; tone: string }> = {
  lower: { label: "Lower risk for the lender", tone: "bg-ok/15 text-ok" },
  moderate: { label: "Moderate risk for the lender", tone: "bg-warn/15 text-warn" },
  higher: { label: "Higher risk for the lender", tone: "bg-danger/10 text-danger" },
};

async function call<T>(init?: RequestInit, query = ""): Promise<T> {
  const res = await fetch(`/api/risk-note${query}`, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/**
 * On a loan request: a short risk note from an open model in NEAR AI Cloud's confidential enclaves,
 * shown only with the checks behind it. The enclaves' attestation is checked before the model is
 * asked, and the reply's signature after. The note is advice; the lending contract decides.
 */
export function RiskNote({ tokenId, sealed, signatures }: { tokenId: string; sealed: boolean; signatures: number }) {
  const status = useQuery({
    queryKey: ["risk-note-status"],
    queryFn: () => call<RiskNoteStatus>(),
    enabled: !IS_SIMULATED,
    staleTime: Infinity,
  });
  const ask = useMutation({
    mutationFn: () =>
      call<RiskNoteResult>({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token_id: tokenId }),
      }),
  });
  const check = useMutation({ mutationFn: () => call<ModelEvidence>(undefined, "?check=1") });
  const [demo, setDemo] = useState(false);

  const model = status.data?.model ?? "an open model";
  const result = ask.data;
  const evidence = result?.evidence ?? check.data;

  return (
    <div className="border-line bg-bg mt-4 rounded-[14px] border px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-3 inline-flex items-center gap-2 font-mono text-[11.5px] font-medium tracking-[0.14em] uppercase">
          <Sparkles aria-hidden className="size-3.5" />
          Risk note · NEAR AI
        </p>
        {IS_SIMULATED ? <SimulatedTag /> : null}
      </div>
      <p className="text-fg-2 mt-2 text-[13.5px] leading-relaxed">
        {IS_SIMULATED
          ? "On testnet, an open model running in NEAR AI Cloud's confidential enclaves reads this loan's public facts and writes a short note. The page checks the enclaves' attestation before asking and the model's signature after, and shows both. The demo asks no model."
          : `${model}, an open model running in NEAR AI Cloud's confidential enclaves (Intel TDX, NVIDIA GPUs), reads this loan's public facts and writes a short note. Before asking, the server checks a fresh attestation of the enclaves; after, it checks the reply was signed inside them. Advice only: it can't move anything.`}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {IS_SIMULATED ? (
          <Button size="sm" onClick={() => setDemo(true)} disabled={demo}>
            <Sparkles className="size-3.5" />
            Show a simulated note
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => ask.mutate()}
              disabled={ask.isPending || !status.data?.configured}
            >
              {ask.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {ask.isPending ? "Attesting, then asking…" : result ? "Ask again" : "Get a risk note"}
            </Button>
            <Button size="sm" onClick={() => check.mutate()} disabled={check.isPending || ask.isPending}>
              {check.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
              {check.isPending ? "Checking…" : "Check the enclaves now"}
            </Button>
          </>
        )}
      </div>
      {!IS_SIMULATED && status.data && !status.data.configured ? (
        <p className="text-fg-3 mt-2 text-[12.5px]">
          This deployment has no NEAR AI key, so it can&apos;t ask for notes. The enclave check still works: it needs no
          key.
        </p>
      ) : null}
      {ask.isError ? <p className="text-danger mt-2 text-[13px]">{(ask.error as Error).message}</p> : null}
      {check.isError ? <p className="text-danger mt-2 text-[13px]">{(check.error as Error).message}</p> : null}

      {demo ? <SimulatedNote sealed={sealed} signatures={signatures} /> : null}
      {result ? <NoteView result={result} /> : null}
      {evidence ? <Evidence evidence={evidence} signature={result?.signature ?? null} result={result ?? null} /> : null}
    </div>
  );
}

function NoteView({ result }: { result: RiskNoteResult }) {
  if (!result.evidence.ok) {
    return (
      <p className="text-danger mt-3 text-[13.5px] font-medium">
        The enclaves&apos; attestation didn&apos;t pass, so the model wasn&apos;t asked.
      </p>
    );
  }
  const note = result.note;
  return (
    <div className="mt-4">
      {note ? (
        <>
          <span
            className={cn(
              "inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-medium",
              RATING[note.rating].tone,
            )}
          >
            {RATING[note.rating].label}
          </span>
          <p className="mt-2.5 text-[15px] leading-relaxed">{note.summary}</p>
          {note.points.length ? (
            <ul className="text-fg-2 mt-2 flex flex-col gap-1 text-[13.5px] leading-relaxed [&>li]:flex [&>li]:gap-2 [&>li]:before:mt-[9px] [&>li]:before:size-1 [&>li]:before:shrink-0 [&>li]:before:rounded-full [&>li]:before:bg-current [&>li]:before:opacity-50 [&>li]:before:content-['']">
              {note.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {note.caveat ? <p className="text-fg-3 mt-2 text-[12.5px]">{note.caveat}</p> : null}
        </>
      ) : (
        <p className="text-fg-2 text-[13.5px]">
          The model&apos;s reply wasn&apos;t in the expected shape. As it came:{" "}
          <span className="font-mono text-[12.5px]">{result.raw.slice(0, 400)}</span>
        </p>
      )}
      <p className="text-fg-3 mt-2 text-[12px]">
        Written by {result.model} at {new Date(result.at).toLocaleString()}. Not financial advice; the lending
        contract&apos;s rules are what decide.
      </p>
    </div>
  );
}

function Row({ c }: { c: Pick<Check, "ok" | "label" | "detail"> }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full",
          c.ok ? "bg-ok/15 text-ok" : "bg-danger/10 text-danger",
        )}
      >
        {c.ok ? <CheckIcon className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 text-[13px] leading-relaxed">
        <span className="font-medium">{c.label}.</span>{" "}
        <span className="text-fg-2 [overflow-wrap:anywhere]">{c.detail}</span>
        <span className="sr-only">{c.ok ? " Passed." : " Failed."}</span>
      </span>
    </li>
  );
}

function Evidence({
  evidence,
  signature,
  result,
}: {
  evidence: ModelEvidence;
  signature: RiskNoteResult["signature"];
  result: RiskNoteResult | null;
}) {
  const passed = evidence.ok && (!result || signature?.ok === true);
  return (
    <div className="border-line mt-4 border-t pt-3">
      <p className={cn("inline-flex items-center gap-2 text-[13.5px] font-medium", passed ? "text-ok" : "text-danger")}>
        <Cpu aria-hidden className="size-4" />
        {passed
          ? `${evidence.instances} enclave${evidence.instances === 1 ? "" : "s"} of ${evidence.model} attested, checked here ${new Date(evidence.checkedAt).toLocaleTimeString()}`
          : "Not verified"}
      </p>
      <ul className="mt-1.5">
        {evidence.checks.map((c) => (
          <Row key={c.id} c={c} />
        ))}
        {result && evidence.ok ? (
          <Row
            c={
              signature
                ? { ok: signature.ok, label: "Signed in the enclave", detail: signature.detail }
                : { ok: false, label: "Signed in the enclave", detail: "NEAR AI returned no signature for this reply." }
            }
          />
        ) : null}
      </ul>
      <details className="text-fg-2 mt-2 text-[12.5px]">
        <summary className="text-accent cursor-pointer">The evidence, to check yourself</summary>
        <dl className="[&_dt]:text-fg-3 mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[12px] [&_dd]:[overflow-wrap:anywhere]">
          <dt>model</dt>
          <dd>{evidence.model}</dd>
          <dt>nonce</dt>
          <dd>{evidence.nonce}</dd>
          <dt>signer</dt>
          <dd>{evidence.signingAddress ?? "none"}</dd>
          {evidence.composes.map((c) => (
            <Pair key={c.sha256 ?? "none"} k="compose" v={`${c.name ?? "unnamed"} ${c.sha256 ?? ""}`} />
          ))}
          {result ? (
            <>
              <dt>request</dt>
              <dd>sha256 {result.requestHash}</dd>
              <dt>reply</dt>
              <dd>sha256 {result.responseHash}</dd>
              <dt>chat id</dt>
              <dd>{result.chatId ?? "none"}</dd>
              {signature ? (
                <>
                  <dt>signed</dt>
                  <dd>{signature.text}</dd>
                  <dt>signature</dt>
                  <dd>{signature.signature}</dd>
                </>
              ) : null}
            </>
          ) : null}
        </dl>
        <p className="mt-2 leading-relaxed">
          The request and reply bytes are in the copy below: hash them with SHA-256 and the result must be the signed
          text; the signature must recover (EIP-191) to the signer, which each Intel quote binds next to the nonce.
          Quotes check against Intel&apos;s certification service, and GPU evidence against NVIDIA&apos;s
          (docs.near.ai/cloud/verification).
        </p>
        <div className="mt-2">
          <CopyButton value={JSON.stringify(result ?? evidence, null, 2)} label="Copy the evidence as JSON" size="sm" />
        </div>
      </details>
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

/** The demo's stand-in: labelled, built from the vault's own state, and no model involved. */
function SimulatedNote({ sealed, signatures }: { sealed: boolean; signatures: number }) {
  const intact = sealed && signatures === 0;
  return (
    <div className="mt-4">
      <span
        className={cn(
          "inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-medium",
          RATING[intact ? "lower" : "higher"].tone,
        )}
      >
        {RATING[intact ? "lower" : "higher"].label} (simulated)
      </span>
      <p className="mt-2.5 text-[15px] leading-relaxed">
        {intact
          ? "The vault is sealed with no signatures ever requested, and the lending contract holds it, so the collateral can't be drained while the loan runs."
          : "The vault has been opened, so it can't be pledged; treat this request with care."}
      </p>
      <p className="text-fg-3 mt-2 text-[12.5px]">
        Simulated: written by this page from the vault&apos;s state, not by a model. On testnet the note comes with its
        attestation.
      </p>
    </div>
  );
}
