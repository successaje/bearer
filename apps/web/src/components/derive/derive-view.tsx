"use client";

import type { VaultView } from "@bearer/sdk";
import { ArrowRight, Check, Loader2, Play, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ChainIcon } from "@/components/brand/chain-icon";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Label } from "@/components/ui/primitives";
import { BEARER_CONTRACT, IS_SIMULATED, SIGNER_CONTRACT } from "@/lib/config";
import { deriveVault, EPSILON_PREFIX, type Derived } from "@/lib/derive/derive";
import { CHAIN_META, truncateMiddle, vaultNumber } from "@/lib/vault/format";
import { cn } from "@/lib/utils";

const RPC = process.env.NEXT_PUBLIC_NEAR_RPC || "https://test.rpc.fastnear.com";
/** The simulated demo's keys are made up, so this page always reads a real deployment. */
const LIVE_CONTRACT = IS_SIMULATED ? process.env.NEXT_PUBLIC_PROOF_CONTRACT || "v3a.bearer-1108-ffb3.testnet" : BEARER_CONTRACT;
/** A vault every deployment has: No. 0001, the first one created (on the spike and on bearer.testnet). */
const REAL_VAULT = "1";

async function view<T>(account: string, method: string, args: object): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "derive",
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) },
    }),
  });
  const body = await res.json();
  const err = body.error ?? body.result?.error;
  if (err) throw new Error(typeof err === "string" ? err : JSON.stringify(err).slice(0, 200));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
}

interface Run {
  roots: [string, string];
  derived: Derived[];
  vault: VaultView;
  signer: string[];
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms));

export function DeriveView() {
  const params = useSearchParams();
  const [contract, setContract] = useState(params.get("contract") ?? LIVE_CONTRACT);
  const [tokenId, setTokenId] = useState(params.get("vault") ?? REAL_VAULT);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState<Partial<Run>>({});
  const [error, setError] = useState<string | null>(null);
  /** The vault number the contract didn't know, so the form can offer a real one. */
  const [missing, setMissing] = useState<string | null>(null);
  const busy = step > 0 && step < 6;

  async function start(e?: FormEvent, id = tokenId.trim()) {
    e?.preventDefault();
    setError(null);
    setMissing(null);
    setRun({});
    setStep(1);
    try {
      const roots = await Promise.all([
        view<string>(SIGNER_CONTRACT, "public_key", { domain_id: 0 }),
        view<string>(SIGNER_CONTRACT, "public_key", { domain_id: 1 }),
      ]);
      setRun({ roots: roots as [string, string] });
      await pause(500);
      setStep(2);
      const derived = deriveVault(contract.trim(), id, roots[0], roots[1]);
      setRun((r) => ({ ...r, derived }));
      await pause(600);
      setStep(3);
      await pause(600);
      setStep(4);
      await pause(600);
      setStep(5);
      const [vault, ...signer] = await Promise.all([
        view<VaultView | null>(contract.trim(), "vault", { token_id: id }),
        ...derived.map((d) =>
          view<string>(SIGNER_CONTRACT, "derived_public_key", { path: d.path, predecessor: contract.trim(), domain_id: d.chain === "sol" ? 1 : 0 }),
        ),
      ]);
      if (!vault) {
        setMissing(id);
        setStep(0);
        return;
      }
      setRun((r) => ({ ...r, vault, signer }));
      await pause(400);
      setStep(6);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setStep(0);
    }
  }

  const d = run.derived;
  const stored = (c: Derived) => (c.chain === "btc" ? run.vault?.btc_address : c.chain === "evm" ? run.vault?.evm_address : run.vault?.sol_address) ?? "";
  const rows = d && run.vault && run.signer
    ? d.map((c, i) => ({
        c,
        keyContract: c.key === run.vault!.keys?.[c.chain],
        keySigner: c.key === run.signer![i],
        address: c.address.toLowerCase() === stored(c).toLowerCase(),
      }))
    : null;
  const allMatch = rows?.every((r) => r.keyContract && r.keySigner && r.address) ?? false;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-14">
      <form onSubmit={start} className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
        <div>
          <Label htmlFor="d-contract">Contract</Label>
          <Input id="d-contract" value={contract} onChange={(e) => setContract(e.target.value)} className="mt-2 font-mono text-[13.5px]" spellCheck={false} />
          {IS_SIMULATED ? (
            <p className="mt-1.5 text-[12.5px] text-fg-3">The live testnet deployment: the simulated demo&apos;s keys are made up.</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="d-vault">Vault number</Label>
          <Input id="d-vault" value={tokenId} onChange={(e) => setTokenId(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="mt-2 font-mono" />
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={busy || !contract || !tokenId}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {busy ? "Deriving…" : step === 6 ? "Run it again" : "Derive the addresses"}
        </Button>
        <p className="text-[13px] leading-relaxed text-fg-3">
          Everything runs in this browser tab. The only things it fetches are the MPC network&apos;s public root keys and,
          at the end, what the contract and the signer say, to compare.
        </p>
        {error ? <p className="rounded-control border border-danger/30 bg-danger/[0.07] p-3 text-[13px] text-danger">{error}</p> : null}
        {missing ? (
          <div role="status" className="rounded-control border border-line bg-surface p-3 text-[13px] leading-relaxed text-fg-2">
            <p>
              There&apos;s no vault {missing} on <code className="font-mono text-[12.5px]">{contract}</code>.
              {IS_SIMULATED ? " The simulated demo's vaults live only in this browser, with made-up keys." : null}
            </p>
            {missing !== REAL_VAULT ? (
              <button
                type="button"
                onClick={() => {
                  setTokenId(REAL_VAULT);
                  void start(undefined, REAL_VAULT);
                }}
                className="mt-2 inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                Derive {vaultNumber(REAL_VAULT)}, a real one
                <ArrowRight className="size-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
      </form>

      <ol className="flex min-w-0 flex-col">
        <Step n={1} at={step} title="Ask NEAR's MPC network for its root public keys">
          <p>
            Public keys only: one secp256k1 key (signs Bitcoin and Base) and one Ed25519 key (signs Solana), from{" "}
            <code>{SIGNER_CONTRACT}</code>.
          </p>
          {run.roots ? (
            <div className="mt-3 flex flex-col gap-1.5">
              <Value label="domain 0" value={run.roots[0]} />
              <Value label="domain 1" value={run.roots[1]} />
            </div>
          ) : null}
        </Step>
        <Step n={2} at={step} title="Build each address's path, exactly as the contract does">
          <p>
            The contract builds these itself from the vault number and a fixed chain tag. No user input reaches a path.
          </p>
          {d ? (
            <div className="mt-3 flex flex-col gap-1.5">
              {d.map((c) => (
                <Value key={c.chain} label={CHAIN_META[c.chain].name} value={c.path} />
              ))}
            </div>
          ) : null}
        </Step>
        <Step n={3} at={step} title="Hash the contract and path into a tweak">
          <p>
            <code>ε = SHA3-256(&quot;{EPSILON_PREFIX}&quot; ‖ contract ‖ &quot;,&quot; ‖ path)</code>. Only{" "}
            <code>{contract}</code> can ever ask the network to sign with these tweaks.
          </p>
          {d && step >= 3 ? (
            <div className="mt-3 flex flex-col gap-1.5">
              {d.map((c) => (
                <Value key={c.chain} label={CHAIN_META[c.chain].name} value={c.epsilon} />
              ))}
            </div>
          ) : null}
        </Step>
        <Step n={4} at={step} title="Add the tweak to the root key">
          <p>
            secp256k1: <code>root + ε·G</code>. Ed25519: <code>root + ε·B</code> (ε read little-endian). Point addition, nothing
            secret.
          </p>
          {d && step >= 4 ? (
            <div className="mt-3 flex flex-col gap-1.5">
              {d.map((c) => (
                <Value key={c.chain} label={CHAIN_META[c.chain].name} value={c.key} />
              ))}
            </div>
          ) : null}
        </Step>
        <Step n={5} at={step} title="Turn each key into an address">
          <p>
            Bitcoin: P2WPKH, <code>bech32(&quot;tb&quot;, RIPEMD160(SHA256(key)))</code>. Base: the last 20 bytes of{" "}
            <code>keccak256(key)</code>. Solana: the key itself, in base58.
          </p>
          {d && step >= 5 ? (
            <div className="mt-3 flex flex-col gap-2">
              {d.map((c) => (
                <div key={c.chain} className="flex items-center gap-2.5">
                  <ChainIcon chain={c.chain} className="size-6 shrink-0" />
                  <code className="min-w-0 flex-1 break-all text-[12.5px] text-fg">{c.address}</code>
                  <CopyButton value={c.address} label={`Copy ${CHAIN_META[c.chain].name} address`} size="sm" />
                </div>
              ))}
            </div>
          ) : null}
        </Step>
        <Step n={6} at={step} title="Compare with the contract and the signer" last>
          <p>What you just computed, against what the contract stores and what the signer derives for itself.</p>
          {rows ? (
            <>
              <div className="mt-4 overflow-hidden rounded-[12px] border border-line">
                <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,56px)] sm:grid-cols-[minmax(0,1fr)_repeat(3,72px)] gap-2 border-b border-line bg-bg px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-3">
                  <span>Chain</span>
                  <span className="text-center">Address</span>
                  <span className="text-center">Contract</span>
                  <span className="text-center">Signer</span>
                </div>
                {rows.map((r) => (
                  <div key={r.c.chain} className="grid grid-cols-[minmax(0,1fr)_repeat(3,56px)] sm:grid-cols-[minmax(0,1fr)_repeat(3,72px)] items-center gap-2 border-b border-line px-3.5 py-2.5 last:border-b-0">
                    <span className="flex min-w-0 items-center gap-2 text-[13.5px]">
                      <ChainIcon chain={r.c.chain} className="size-5 shrink-0" />
                      <span className="truncate text-[13px] sm:hidden">{CHAIN_META[r.c.chain].name}</span>
                      <span className="hidden truncate font-mono text-[12px] text-fg-2 sm:inline">{truncateMiddle(r.c.address, 10, 6)}</span>
                    </span>
                    <Tick ok={r.address} />
                    <Tick ok={r.keyContract} />
                    <Tick ok={r.keySigner} />
                  </div>
                ))}
              </div>
              <div
                className={cn(
                  "mt-4 flex items-start gap-3 rounded-[12px] border p-4",
                  allMatch ? "border-ok/30 bg-ok/[0.06]" : "border-danger/35 bg-danger/[0.07]",
                )}
                aria-live="polite"
              >
                {allMatch ? <Check className="mt-0.5 size-5 shrink-0 text-ok" /> : <X className="mt-0.5 size-5 shrink-0 text-danger" />}
                <p className="text-[14px] leading-relaxed">
                  {allMatch ? (
                    <>
                      <strong className="font-semibold">All nine match.</strong> These addresses belong to vault {tokenId}, and only{" "}
                      <code>{contract}</code> can ask NEAR&apos;s MPC network to sign for them.
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold">Something doesn&apos;t match.</strong> Don&apos;t send anything to this vault
                      until you know why.
                    </>
                  )}
                </p>
              </div>
              {/* The simulated app can't open a testnet vault, so the link only appears against the real chain. */}
              {!IS_SIMULATED ? (
                <a href={`/v/${tokenId}`} className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:underline">
                  Open vault {vaultNumber(tokenId)}
                  <ArrowRight className="size-4" />
                </a>
              ) : null}
            </>
          ) : null}
        </Step>
      </ol>
    </div>
  );
}

function Step({ n, at, title, last, children }: { n: number; at: number; title: string; last?: boolean; children: ReactNode }) {
  const state = at > n || (at === n && n === 6) ? "done" : at === n ? "active" : "todo";
  return (
    <li className={cn("relative flex gap-4 pb-7", last && "pb-0")}>
      {!last ? <span aria-hidden className={cn("absolute bottom-0 left-[15px] top-9 w-px", state === "done" ? "bg-gold/50" : "bg-line-strong")} /> : null}
      <span
        aria-hidden
        className={cn(
          "relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[12.5px] font-semibold transition-colors",
          state === "done" && "bg-gold text-ink",
          state === "active" && "bg-gold/15 text-accent ring-1 ring-gold/50",
          state === "todo" && "border border-line-strong text-fg-3",
        )}
      >
        {state === "done" ? <Check className="size-4" strokeWidth={3} /> : state === "active" ? <Loader2 className="size-4 animate-spin" /> : n}
      </span>
      <div className={cn("min-w-0 flex-1 pt-1 transition-opacity", state === "todo" && "opacity-55")}>
        <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h3>
        <div className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-fg">{children}</div>
      </div>
    </li>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[10px] border border-line bg-bg px-3 py-2 motion-safe:animate-fade-in">
      <span className="w-[72px] shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{value}</code>
      <CopyButton value={value} label={`Copy ${label}`} size="sm" />
    </div>
  );
}

function Tick({ ok }: { ok: boolean }) {
  return (
    <span className="flex justify-center">
      <span className={cn("inline-flex size-6 items-center justify-center rounded-full", ok ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger")}>
        {ok ? <Check className="size-3.5" strokeWidth={3} aria-label="Matches" /> : <X className="size-3.5" strokeWidth={3} aria-label="Doesn't match" />}
      </span>
    </span>
  );
}
