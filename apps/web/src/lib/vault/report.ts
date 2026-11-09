import type { AttackKind, ChainObservation, ChainTag, VaultView, Withdrawal } from "@bearer/sdk";
import { CHAIN_TAGS } from "@bearer/sdk";
import { BEARER_CONTRACT, CODE_HASH, SIGNER_CONTRACT } from "@/lib/config";
import { SIMULATED_FACTS, type ContractFacts } from "./contract-facts";
import { ATTACK_TESTS } from "./errors";
import { CHAIN_META, formatAmount, formatDate, nsToMs, toUsd, vaultNumber } from "./format";

export type VaultStatus = "sealed" | "opened" | "withdrawing" | "empty";

export function isSealed(v: VaultView) {
  return v.state.kind === "sealed";
}

export function openedAt(v: VaultView): number | null {
  return v.state.kind === "opened" ? nsToMs(v.state.at_ns) : null;
}

export function observedUsd(obs: ChainObservation[] | undefined) {
  return (obs ?? []).reduce((s, o) => s + toUsd(o.chain, o.confirmed), 0);
}

export function vaultStatus(v: VaultView, withdrawals?: Withdrawal[], obs?: ChainObservation[]): VaultStatus {
  if (isSealed(v)) return "sealed";
  if (withdrawals?.some((w) => w.status === "pending")) return "withdrawing";
  if (obs && obs.every((o) => o.confirmed === "0" && o.pending === "0")) return "empty";
  return "opened";
}

/** The previous holder, if the vault has changed hands. */
export function formerOwner(v: VaultView): string | null {
  return v.custody.length >= 2 ? v.custody[v.custody.length - 2].account_id : null;
}

export type CheckState = "pass" | "info" | "pending";

export interface SealCheck {
  id: string;
  title: string;
  summary: string;
  state: CheckState;
  why: string;
  evidence: string[];
}

export interface VaultReport {
  sealed: boolean;
  headline: string;
  detail: string;
  checks: SealCheck[];
}

export function vaultReport(v: VaultView, obs?: ChainObservation[], facts: ContractFacts = SIMULATED_FACTS): VaultReport {
  const sealed = isSealed(v);
  const opened = v.state.kind === "opened" ? v.state : null;
  const keys = v.keys;
  const checks: SealCheck[] = [
    sealed
      ? {
          id: "seal",
          title: "Seal intact",
          summary: "Unopened",
          state: "pass",
          why: "No one has ever broken this vault's seal. Breaking it is the only way to get a withdrawal signed, and it can't be undone.",
          evidence: ["vault.state = sealed"],
        }
      : {
          id: "seal",
          title: "Seal broken",
          summary: `Opened ${opened ? formatDate(nsToMs(opened.at_ns)) : ""} by ${opened?.by ?? ""}`,
          state: "info",
          why: "The owner broke the seal to withdraw. From that moment the vault can never change hands, so every signature it produces pays that owner.",
          evidence: [`vault.state = opened`, `by ${opened?.by ?? ""}`],
        },
    {
      id: "signatures",
      title: "Signatures ever requested",
      summary: sealed ? "0" : String(v.signatures_requested),
      state: sealed ? "pass" : "info",
      why: sealed
        ? "The contract can't request a signature for a sealed vault, so no previous owner can be holding one."
        : `${v.signatures_requested} withdrawal signature${v.signatures_requested === 1 ? "" : "s"} requested since opening, all by the current owner.`,
      evidence: [`signatures_requested = ${v.signatures_requested}`],
    },
    {
      id: "transfer",
      title: sealed ? "Can change hands" : "Can't change hands",
      summary: sealed ? "Transfers allowed while sealed" : "Opened vaults never move",
      state: sealed ? "pass" : "info",
      why: "Every transfer path goes through one gate that refuses opened vaults: nft_transfer, nft_transfer_call and their return leg.",
      evidence: ["transfer.rs: one owner-changing path"],
    },
    // Read from the chain on testnet; never assumed. A spike deployment says so.
    facts.locked === null
      ? { id: "locked", title: "Contract locked", summary: "Checking…", state: "pending", why: "Reading the contract's access keys from NEAR.", evidence: [] }
      : facts.locked
        ? {
            id: "locked",
            title: "Contract locked",
            summary: "No full-access keys, no upgrade method",
            state: "pass",
            why: "Nobody, including Bearer's authors, can change the contract or ask it to sign anything outside its typed withdrawal methods.",
            evidence: [`${BEARER_CONTRACT}: view_access_key_list`, "0 full-access keys"],
          }
        : {
            id: "locked",
            title: "Not locked yet",
            summary: `${facts.fullAccessKeys} full-access key${facts.fullAccessKeys === 1 ? "" : "s"}: a test deployment`,
            state: "info",
            why: "Whoever holds a full-access key could redeploy this contract. The locked deployment deletes every one before submission; until then, treat this as a test.",
            evidence: [`${BEARER_CONTRACT}: view_access_key_list`],
          },
    facts.codeHash === null
      ? { id: "code", title: "Code identity", summary: "Checking…", state: "pending", why: "Reading the deployed code hash from NEAR.", evidence: [] }
      : {
          id: "code",
          title: "Code identity",
          summary: facts.codeHash === CODE_HASH ? "Hash matches the reproducible build" : "Not the published build",
          state: facts.codeHash === CODE_HASH ? "pass" : "info",
          why:
            facts.codeHash === CODE_HASH
              ? "The deployed code hash matches the build anyone can reproduce from the open-source repository."
              : "This is the hash of the code running now, and it isn't the published reproducible build: treat this deployment as a test.",
          evidence: [`code_hash ${facts.codeHash.slice(0, 12)}…`],
        },
    {
      id: "addresses",
      title: "Addresses",
      summary: keys ? "Derived from this contract and its paths" : "Waiting for the signer's keys",
      state: keys ? "pass" : "pending",
      why: `The MPC signer (${SIGNER_CONTRACT}) derives each address from the Bearer contract's account and a path the contract builds. Only that contract can ever request a signature for them.`,
      evidence: CHAIN_TAGS.map((c) => v.paths[c]),
    },
    {
      id: "balances",
      title: "Balances",
      summary: obs ? "Observed, with source and time" : "Checking…",
      state: obs ? "info" : "pending",
      why: "Balances come from public data sources, for display. The contract never relies on them; check any address on an explorer.",
      evidence: CHAIN_TAGS.map((c) => CHAIN_META[c].source),
    },
  ];

  return {
    sealed,
    headline: sealed ? "Unopened" : "Opened · can't change hands",
    detail: sealed
      ? "No signature has ever been requested for this vault."
      : `Opened on ${opened ? formatDate(nsToMs(opened.at_ns)) : ""} by ${opened?.by ?? ""}. It can't change hands.`,
    checks,
  };
}

export interface Answer {
  q: string;
  a: string;
}

/** Brief 3.7: every vault page answers these, in plain words. */
export function fiveQuestions(v: VaultView, obs: ChainObservation[] | undefined, viewer: string | null): Answer[] {
  const sealed = isSealed(v);
  const isOwner = viewer === v.owner_id;
  const contents = obs
    ? obs
        .filter((o) => o.confirmed !== "0")
        .map((o) => `${formatAmount(o.chain, o.confirmed)} ${CHAIN_META[o.chain].asset === "Bitcoin" ? "tBTC" : CHAIN_META[o.chain].asset}`)
        .join(", ") || "Nothing confirmed yet."
    : "Checking the chains…";
  return [
    {
      q: isOwner ? "What do I own?" : "What does the owner hold?",
      a: sealed
        ? `Control of vault ${vaultNumber(v.token_id)}: the right to withdraw what's at its three addresses, and to hand it on while it's sealed.`
        : `Control of vault ${vaultNumber(v.token_id)}: the right to withdraw what's at its three addresses. It can't be handed on.`,
    },
    { q: "What's in it?", a: obs ? `Observed: ${contents}` : contents },
    {
      q: "Who can withdraw?",
      a: sealed
        ? `Only the current owner (${v.owner_id}), and only after breaking the seal. Right now nobody has.`
        : `Only ${v.owner_id}. The vault is opened and can't change hands.`,
    },
    {
      q: "What changes if it's transferred?",
      a: sealed
        ? "The new owner gets all of this and the old owner loses it. No coins move on Bitcoin, Base or Solana."
        : "It can't be transferred. Opened vaults never change hands.",
    },
    {
      q: "What are the risks?",
      a: "Testnet prototype, not audited. Balances are observed data. You trust NEAR's MPC network and this contract, which has no admin methods.",
    },
  ];
}

export interface AttackScenario {
  kind: AttackKind;
  title: string;
  actor: string;
  call: string;
  expected: string;
  test: string;
}

export function attackScenarios(v: VaultView): AttackScenario[] {
  const former = formerOwner(v) ?? "eve.testnet";
  const formerLabel = formerOwner(v) ? `${former} (former owner)` : `${former} (not the owner)`;
  return [
    {
      kind: "former_owner_withdraws",
      title: "Former owner tries to withdraw",
      actor: formerLabel,
      call: `withdraw_btc(vault ${v.token_id})`,
      expected: "ERR_NOT_OWNER",
      test: ATTACK_TESTS.former_owner_withdraws,
    },
    {
      kind: "former_owner_breaks_seal",
      title: "Former owner tries to break the seal",
      actor: formerLabel,
      call: `break_seal(vault ${v.token_id})`,
      expected: "ERR_NOT_OWNER",
      test: ATTACK_TESTS.former_owner_breaks_seal,
    },
    {
      kind: "transfer_opened_vault",
      title: "Transfer an opened vault",
      actor: `${v.owner_id} (owner)`,
      call: isSealed(v) ? "nft_transfer(any opened vault)" : `nft_transfer(vault ${v.token_id})`,
      expected: "ERR_VAULT_OPENED",
      test: ATTACK_TESTS.transfer_opened_vault,
    },
    {
      kind: "withdraw_sealed_vault",
      title: "Withdraw without breaking the seal",
      actor: `${v.owner_id} (owner)`,
      call: isSealed(v) ? `withdraw_evm(vault ${v.token_id})` : "withdraw_evm(any sealed vault)",
      expected: "ERR_VAULT_SEALED",
      test: ATTACK_TESTS.withdraw_sealed_vault,
    },
    {
      kind: "sign_arbitrary_bytes",
      title: "Ask the contract to sign arbitrary bytes",
      actor: "anyone",
      call: "sign(payload)",
      expected: "MethodNotFound",
      test: ATTACK_TESTS.sign_arbitrary_bytes,
    },
  ];
}

export function withdrawalAmount(w: Withdrawal): { chain: ChainTag; amount: string; to: string } {
  const p = w.params;
  if (p.chain === "evm") return { chain: "evm", amount: p.amount_wei, to: p.to };
  if (p.chain === "btc") return { chain: "btc", amount: p.amount_sat, to: p.to_address };
  return { chain: "sol", amount: p.lamports, to: p.to };
}
