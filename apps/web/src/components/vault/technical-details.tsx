import type { VaultView } from "@bearer/sdk";
import { CHAIN_TAGS } from "@bearer/sdk";
import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/ui/copy-button";
import { BEARER_CONTRACT, CODE_HASH, REPO_URL, SIGNER_CONTRACT } from "@/lib/config";
import { truncateMiddle } from "@/lib/vault/format";

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-fg-3">{term}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </>
  );
}

export function TechnicalDetails({ vault }: { vault: VaultView }) {
  const hash = CODE_HASH.match(/.{1,4}/g) ?? [];
  const snippet = `import { contracts, chainAdapters } from "chainsig.js";

const mpc = new contracts.ChainSignatureContract({ networkId: "testnet", contractId: "${SIGNER_CONTRACT}" });
for (const [chain, path] of Object.entries(${JSON.stringify(vault.paths)})) {
  const key = await mpc.getDerivedPublicKey({ path, predecessor: "${BEARER_CONTRACT}", IsEd25519: chain === "sol" });
  console.log(chain, key); // compare with this vault's addresses
}`;
  return (
    <details className="group overflow-hidden rounded-panel border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-[18px]">
        <span className="text-[16px] font-semibold tracking-[-0.01em]">Technical details</span>
        <ChevronDown aria-hidden className="size-[18px] text-fg-3 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line px-5 pb-6 pt-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13.5px] leading-relaxed sm:grid-cols-[minmax(140px,200px)_minmax(0,1fr)] sm:gap-y-3.5 [&_dd]:mb-3 sm:[&_dd]:mb-0">
          <Row term="Token">NEP-171 NFT, token {vault.token_id}</Row>
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
              {CHAIN_TAGS.map((c) => (
                <span key={c}>{vault.paths[c]}</span>
              ))}
            </span>
          </Row>
          <Row term="Derived keys">
            {vault.keys ? (
              <span className="flex flex-col gap-1 font-mono">
                {CHAIN_TAGS.map((c) => (
                  <span key={c} title={vault.keys?.[c]}>
                    {c}: {truncateMiddle(vault.keys?.[c] ?? "", 18, 6)}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-fg-3">Waiting for the signer</span>
            )}
          </Row>
          <Row term="Signatures requested">
            <span className="font-mono">{vault.signatures_requested}</span>
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

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-[13.5px] font-medium">
              Derive the addresses yourself{" "}
              <a href={`/derive?vault=${vault.token_id}`} className="ml-1 font-normal text-accent hover:underline">
                or in your browser →
              </a>
            </p>
            <CopyButton value={snippet} label="Copy the derivation snippet" size="sm" />
          </div>
          <pre className="mt-2 overflow-x-auto rounded-control border border-line bg-[#0b0b0f] p-4 font-mono text-[12px] leading-relaxed text-[#d4d4d8]">
            <code>{snippet}</code>
          </pre>
        </div>
      </div>
    </details>
  );
}
