import { CHAIN_META, formatAmount, truncateMiddle } from "@/lib/format";
import { sleep } from "@/lib/utils";
import type { BearerClient } from "./client";
import { NETWORK_FEES } from "./fees";
import {
  mockAddress,
  mockHash,
  mockNearHash,
  seedState,
  type MockRequest,
  type MockState,
} from "./mock-data";
import { computeSealReport, isActive } from "./seal";
import { PENDING_EXPIRY_MS } from "@/lib/config";
import {
  BearerError,
  type ActivityItem,
  type Card,
  type ChainTag,
  type ClaimLookup,
  type Finish,
  type OpenInput,
  type OpenRequest,
} from "./types";

const STORAGE_KEY = "bearer:mock:v2";

/** Simulated MPC timings. Real numbers must be measured on testnet (brief 1.4). */
const SIGNED_AFTER_MS = 4_200;
const CONFIRMED_AFTER_MS = 8_500;
const MAX_BTC_INPUTS = 3;
const FEES = NETWORK_FEES;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function randomBase58(length: number) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function jitter(min: number, max: number) {
  return sleep(min + Math.random() * (max - min));
}

export class MockBearerClient implements BearerClient {
  private state: MockState | null = null;

  private load(): MockState {
    if (this.state) return this.state;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MockState;
        if (parsed.version === 2) {
          this.state = parsed;
          return parsed;
        }
      }
    } catch {
      // Private mode or corrupted storage: fall back to a fresh seed.
    }
    this.state = seedState(Date.now());
    this.save();
    return this.state;
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage unavailable; state still lives in memory for this tab.
    }
  }

  reset() {
    this.state = seedState(Date.now());
    this.save();
  }

  private card(id: string): Card {
    const card = this.load().cards[id];
    if (!card) throw new BearerError("NOT_FOUND", `There's no card with number ${id}.`);
    return card;
  }

  private assertOwner(card: Card, signer: string) {
    if (card.owner !== signer) {
      throw new BearerError("NOT_OWNER", "Only the card's owner can do that.");
    }
  }

  private log(card: Card, item: Omit<ActivityItem, "id">) {
    card.activity.unshift({ id: `${card.id}-${Date.now()}-${card.activity.length}`, ...item });
  }

  private transfer(card: Card, to: string, kind: ActivityItem["kind"], detail: string) {
    const from = card.owner;
    card.owner = to;
    card.listing = null;
    card.claimLink = null;
    for (const link of Object.values(this.load().claimLinks)) {
      if (link.cardId === card.id && link.status === "active") link.status = "cancelled";
    }
    this.log(card, {
      kind,
      title: kind === "sold" ? `Sold to ${to}` : kind === "claimed" ? `Claimed by ${to}` : `Handed over to ${to}`,
      detail: detail || `From ${from}. Nothing moved on Bitcoin, Base or Solana.`,
      at: Date.now(),
      link: { label: "NEAR tx", href: "#" },
    });
  }

  private assertTransferable(card: Card) {
    if (card.listing) {
      throw new BearerError("NOT_ACTIVE", "This card is listed. Delist it before handing it over.");
    }
    const report = computeSealReport(card, Date.now());
    if (report.verdict === "not_transferable") {
      throw new BearerError("NOT_SEALED", `This card can't change hands yet: ${report.detail}`);
    }
  }

  /** Moves simulated signing requests forward based on elapsed time. */
  private advance() {
    const state = this.load();
    const now = Date.now();
    let changed = false;
    for (const req of Object.values(state.requests)) {
      if (req.stuck || req.stage === "confirmed" || req.stage === "failed") continue;
      const card = state.cards[req.cardId];
      if (!card) continue;
      const elapsed = now - req.createdAt;
      if (elapsed >= SIGNED_AFTER_MS && !req.signedApplied) {
        req.signedApplied = true;
        req.stage = "broadcasting";
        req.chainTxHash = req.chain === "sol" ? mockNearHash(`${req.id}-tx`) : mockHash(`${req.id}-tx`);
        card.pending = card.pending.filter((p) => p.requestId !== req.id);
        this.log(card, {
          kind: "signed",
          chain: req.chain,
          title: `Opened ${formatAmount(req.chain, req.amount)} ${CHAIN_META[req.chain].unit} on ${CHAIN_META[req.chain].name}`,
          detail: `Signed by NEAR's MPC network and sent to ${truncateMiddle(req.to, 6, 4)}.`,
          at: req.createdAt + SIGNED_AFTER_MS,
        });
        changed = true;
      }
      if (elapsed >= CONFIRMED_AFTER_MS && !req.confirmApplied) {
        req.confirmApplied = true;
        req.stage = "confirmed";
        const spend = req.amount + req.fee;
        if (req.chain === "btc") {
          const spent = new Set(req.spendsCoins ?? []);
          const inputs = card.slots.btc.coins.filter((c) => spent.has(c.outpoint));
          const total = inputs.reduce((s, c) => s + c.amount, 0);
          card.slots.btc.coins = card.slots.btc.coins.filter((c) => !spent.has(c.outpoint));
          const change = total - spend;
          if (change > 0) {
            card.slots.btc.coins.push({ outpoint: `${req.chainTxHash}:1`, amount: change, encumbered: false });
          }
        } else if (req.chain === "evm") {
          card.slots.evm.balance = Math.max(0, card.slots.evm.balance - spend);
        } else {
          card.slots.sol.balance = Math.max(0, card.slots.sol.balance - spend);
        }
        this.log(card, {
          kind: "broadcast",
          chain: req.chain,
          title: `Confirmed on ${CHAIN_META[req.chain].name}`,
          detail:
            req.chain === "evm"
              ? "The withdrawal landed. Prove it on NEAR so the card can change hands."
              : "The withdrawal landed.",
          at: req.createdAt + CONFIRMED_AFTER_MS,
        });
        changed = true;
      } else if (elapsed < SIGNED_AFTER_MS && req.stage !== "signing") {
        req.stage = "signing";
        changed = true;
      }
    }
    if (changed) this.save();
  }

  async listCards(owner: string) {
    await jitter(250, 450);
    this.advance();
    return clone(
      Object.values(this.load().cards)
        .filter((c) => c.owner === owner)
        .sort((a, b) => (b.activity[0]?.at ?? b.createdAt) - (a.activity[0]?.at ?? a.createdAt)),
    );
  }

  async getCard(id: string) {
    await jitter(200, 400);
    this.advance();
    const card = this.load().cards[id];
    return card ? clone(card) : null;
  }

  async createCard(input: { name: string; finish: Finish }, signer: string) {
    await jitter(900, 1400);
    const state = this.load();
    const id = String(state.nextId++);
    const now = Date.now();
    const card: Card = {
      id,
      name: input.name.trim() || `Card ${id}`,
      finish: input.finish,
      owner: signer,
      createdAt: now,
      epoch: 0,
      slots: {
        btc: { chain: "btc", address: mockAddress("btc", `${id}-${now}`), coins: [] },
        evm: { chain: "evm", address: mockAddress("evm", `${id}-${now}`), balance: 0, maxSignedNonce: null, provenFloor: 0 },
        sol: { chain: "sol", address: mockAddress("sol", `${id}-${now}`), balance: 0, lastSignedAt: null },
      },
      pending: [],
      listing: null,
      claimLink: null,
      logVersion: 1,
      activity: [],
    };
    this.log(card, {
      kind: "created",
      title: "Card created",
      detail: `By ${signer}, with a 0.05 NEAR storage deposit.`,
      at: now,
      link: { label: "NEAR tx", href: "#" },
    });
    state.cards[id] = card;
    this.save();
    return clone(card);
  }

  async handOver(id: string, receiver: string, signer: string) {
    await jitter(900, 1300);
    const card = this.card(id);
    this.assertOwner(card, signer);
    if (!isActive(card)) {
      throw new BearerError(
        "NOT_ACTIVE",
        "This card is listed (or has an open claim link). Delist it or cancel the link before handing it over.",
      );
    }
    this.assertTransferable(card);
    if (receiver === signer) throw new BearerError("NOT_ACTIVE", "You already hold this card.");
    if (!this.load().accounts.includes(receiver)) {
      throw new BearerError("ACCOUNT_MISSING", `${receiver} doesn't exist on NEAR testnet.`);
    }
    this.transfer(card, receiver, "handed_over", "");
    this.save();
    return clone(card);
  }

  async createClaimLink(id: string, signer: string) {
    await jitter(900, 1300);
    const card = this.card(id);
    this.assertOwner(card, signer);
    if (card.listing) throw new BearerError("NOT_ACTIVE", "Delist the card before creating a claim link.");
    if (card.claimLink) throw new BearerError("NOT_ACTIVE", "This card already has an open claim link.");
    const key = randomBase58(44);
    this.load().claimLinks[key] = { cardId: id, from: signer, status: "active" };
    card.claimLink = { createdAt: Date.now() };
    this.log(card, {
      kind: "claim_created",
      title: "Claim link created",
      detail: "Anyone with the link can claim this card.",
      at: Date.now(),
    });
    this.save();
    return { key };
  }

  async cancelClaimLink(id: string, signer: string) {
    await jitter(700, 1000);
    const card = this.card(id);
    this.assertOwner(card, signer);
    for (const link of Object.values(this.load().claimLinks)) {
      if (link.cardId === id && link.status === "active") link.status = "cancelled";
    }
    card.claimLink = null;
    this.log(card, {
      kind: "claim_cancelled",
      title: "Claim link cancelled",
      detail: "The link no longer works. Its key was deleted from the contract.",
      at: Date.now(),
    });
    this.save();
    return clone(card);
  }

  async getClaim(key: string): Promise<ClaimLookup> {
    await jitter(400, 700);
    this.advance();
    const link = this.load().claimLinks[key];
    if (!link) return { status: "invalid" };
    if (link.status === "claimed") return { status: "claimed" };
    if (link.status === "cancelled") return { status: "cancelled" };
    const card = this.load().cards[link.cardId];
    if (!card) return { status: "invalid" };
    return { status: "valid", card: clone(card), from: link.from };
  }

  private claimInto(key: string, receiver: string) {
    const link = this.load().claimLinks[key];
    if (!link) throw new BearerError("LINK_INVALID", "This link isn't valid. Ask the sender for a new one.");
    if (link.status === "claimed") throw new BearerError("LINK_CLAIMED", "This card was already claimed. Ask the sender for a new link.");
    if (link.status === "cancelled") throw new BearerError("LINK_CANCELLED", "The sender cancelled this link. Ask them for a new one.");
    const card = this.card(link.cardId);
    const report = computeSealReport(card, Date.now());
    if (report.verdict === "not_transferable") {
      throw new BearerError("NOT_SEALED", `This card can't change hands yet: ${report.detail}`);
    }
    link.status = "claimed";
    this.transfer(card, receiver, "claimed", `Via a claim link from ${link.from}.`);
    this.save();
    return clone(card);
  }

  async claim(key: string, receiver: string) {
    await jitter(1000, 1400);
    return this.claimInto(key, receiver);
  }

  async createAccountAndClaim(key: string, newAccountId: string) {
    await jitter(1400, 2000);
    const state = this.load();
    if (state.accounts.includes(newAccountId)) {
      throw new BearerError("ACCOUNT_TAKEN", "That name is taken. Try another one; your link still works.");
    }
    state.accounts.push(newAccountId);
    return this.claimInto(key, newAccountId);
  }

  async list(id: string, priceNear: string, signer: string) {
    await jitter(900, 1200);
    const card = this.card(id);
    this.assertOwner(card, signer);
    if (card.claimLink) throw new BearerError("NOT_ACTIVE", "Cancel the claim link before listing this card.");
    card.listing = { priceNear, listedAt: Date.now() };
    this.log(card, {
      kind: "listed",
      title: `Listed for ${priceNear} NEAR`,
      detail: "Withdrawals are locked while the card is listed.",
      at: Date.now(),
    });
    this.save();
    return clone(card);
  }

  async delist(id: string, signer: string) {
    await jitter(700, 1000);
    const card = this.card(id);
    this.assertOwner(card, signer);
    card.listing = null;
    this.log(card, { kind: "delisted", title: "Delisted", detail: "Withdrawals are unlocked.", at: Date.now() });
    this.save();
    return clone(card);
  }

  async buy(id: string, buyer: string, expectedLogVersion: number) {
    await jitter(1100, 1500);
    this.advance();
    const card = this.card(id);
    if (!card.listing) throw new BearerError("NOT_ACTIVE", "This card isn't for sale any more.");
    if (card.owner === buyer) throw new BearerError("NOT_OWNER", "You already hold this card.");
    if (card.logVersion !== expectedLogVersion) {
      throw new BearerError("STALE_SEAL", "The card changed since you looked. Review the new seal report before buying.");
    }
    const report = computeSealReport(card, Date.now());
    if (report.verdict === "not_transferable") {
      throw new BearerError("NOT_SEALED", `This card can't change hands yet: ${report.detail}`);
    }
    const price = card.listing.priceNear;
    const seller = card.owner;
    this.transfer(card, buyer, "sold", `For ${price} NEAR, paid to ${seller} in the same transaction.`);
    this.save();
    return clone(card);
  }

  async open(id: string, input: OpenInput, signer: string): Promise<OpenRequest> {
    await jitter(800, 1100);
    this.advance();
    const card = this.card(id);
    this.assertOwner(card, signer);
    if (card.listing) throw new BearerError("NOT_ACTIVE", "While listed, this card can't sign withdrawals.");
    const now = Date.now();
    const fee = FEES[input.chain];
    const reqId = `req-${id}-${now}`;
    const request: MockRequest = {
      id: reqId,
      cardId: id,
      chain: input.chain,
      to: input.to,
      amount: input.amount,
      fee,
      stage: "signing",
      createdAt: now,
      nearTxHash: mockNearHash(reqId),
    };

    // Record the encumbrance up front: it survives even if the request expires (brief 4.5).
    let summary = "";
    if (input.chain === "btc") {
      const coins = card.slots.btc.coins
        .filter((c) => !c.encumbered)
        .sort((a, b) => b.amount - a.amount);
      const chosen: typeof coins = [];
      let total = 0;
      for (const coin of coins) {
        if (total >= input.amount + fee || chosen.length >= MAX_BTC_INPUTS) break;
        chosen.push(coin);
        total += coin.amount;
      }
      if (total < input.amount + fee) {
        throw new BearerError("INSUFFICIENT_FUNDS", "Not enough sealed Bitcoin to cover this amount and the fee.");
      }
      for (const coin of chosen) {
        coin.encumbered = true;
        coin.signedAt = now;
      }
      request.spendsCoins = chosen.map((c) => c.outpoint);
      summary = `Open ${formatAmount("btc", input.amount)} tBTC · spends ${chosen.length} coin${chosen.length > 1 ? "s" : ""}`;
    } else if (input.chain === "evm") {
      if (card.slots.evm.balance < input.amount + fee) {
        throw new BearerError("INSUFFICIENT_FUNDS", "Not enough ETH on Base to cover this amount and the fee.");
      }
      const nonce = (card.slots.evm.maxSignedNonce ?? -1) + 1;
      card.slots.evm.maxSignedNonce = nonce;
      summary = `Open ${formatAmount("evm", input.amount)} ETH on Base · nonce ${nonce}`;
    } else {
      if (card.slots.sol.balance < input.amount + fee) {
        throw new BearerError("INSUFFICIENT_FUNDS", "Not enough SOL to cover this amount and the fee.");
      }
      card.slots.sol.lastSignedAt = now;
      summary = `Open ${formatAmount("sol", input.amount)} SOL`;
    }

    card.pending.push({ idx: card.pending.length, requestId: reqId, chain: input.chain, requestedAt: now, summary });
    card.logVersion += 1;
    this.load().requests[reqId] = request;
    this.save();
    return clone(request);
  }

  async getRequest(requestId: string) {
    await jitter(120, 220);
    this.advance();
    const req = this.load().requests[requestId];
    return req ? clone(req) : null;
  }

  async proveEvmSettled(id: string) {
    await jitter(1400, 2000);
    this.advance();
    const card = this.card(id);
    const evm = card.slots.evm;
    if (evm.maxSignedNonce === null || evm.provenFloor > evm.maxSignedNonce) {
      throw new BearerError("NOTHING_TO_PROVE", "Every Base withdrawal on this card is already proven.");
    }
    if (card.pending.some((p) => p.chain === "evm")) {
      throw new BearerError("NOT_SEALED", "Wait for the Base signing request to finish before proving.");
    }
    const from = evm.provenFloor;
    evm.provenFloor = evm.maxSignedNonce + 1;
    this.log(card, {
      kind: "proven",
      chain: "evm",
      title: "Base withdrawal proven",
      detail: `Nonce ${from === evm.maxSignedNonce ? from : `${from}–${evm.maxSignedNonce}`} used on Base Sepolia. Checked on NEAR by MPC Read RPC at Safe finality.`,
      at: Date.now(),
      link: { label: "NEAR tx", href: "#" },
    });
    this.save();
    return clone(card);
  }

  async expirePending(id: string, idx: number) {
    await jitter(900, 1200);
    const card = this.card(id);
    const pending = card.pending.find((p) => p.idx === idx);
    if (!pending) return clone(card);
    if (Date.now() - pending.requestedAt < PENDING_EXPIRY_MS) {
      throw new BearerError("NOT_EXPIRED", "This request can't be cleared yet.");
    }
    card.pending = card.pending.filter((p) => p.idx !== idx);
    const req = this.load().requests[pending.requestId];
    if (req) {
      req.stage = "failed";
      req.stuck = false;
      req.error = "Expired before NEAR's MPC network answered.";
    }
    this.log(card, {
      kind: "expired",
      chain: pending.chain,
      title: "Stuck request cleared",
      detail: "No signature was produced. Anything it referenced stays excluded until proven or spent.",
      at: Date.now(),
    });
    this.save();
    return clone(card);
  }

  async accountExists(accountId: string) {
    await jitter(250, 450);
    return this.load().accounts.includes(accountId);
  }

  async simulateDeposit(id: string, chain: ChainTag) {
    await jitter(600, 900);
    const card = this.card(id);
    const now = Date.now();
    const amounts: Record<ChainTag, number> = { btc: 50_000, evm: 5_000_000, sol: 100_000_000 };
    if (chain === "btc") {
      card.slots.btc.coins.push({ outpoint: `${mockHash(`${id}-${now}`)}:0`, amount: amounts.btc, encumbered: false });
    } else if (chain === "evm") {
      card.slots.evm.balance += amounts.evm;
    } else {
      card.slots.sol.balance += amounts.sol;
    }
    this.log(card, {
      kind: "deposit",
      chain,
      title: `Deposit on ${CHAIN_META[chain].name}`,
      detail: `+${formatAmount(chain, amounts[chain])} ${CHAIN_META[chain].unit}, confirmed. SIMULATED.`,
      at: now,
    });
    this.save();
    return clone(card);
  }
}
