import type {
  AccountActivity,
  AttackKind,
  AttackResult,
  BearerClient,
  ChainObservation,
  ChainTag,
  Finish,
  HandoverSchedule,
  LendConfig,
  LoanTerms,
  MarketBalances,
  MarketConfig,
  MarketListing,
  VaultLoan,
  VaultView,
  Withdrawal,
  WithdrawalProgress,
  WithdrawRequest,
} from "@bearer/sdk";
import { CHAIN_TAGS, custodyEvents } from "@bearer/sdk";
import { validateAddress } from "@/lib/validation";
import { CHAIN_META } from "./format";
import {
  FEES,
  MOCK_LEND,
  MOCK_LISTING_DEPOSIT,
  MOCK_LOAN_DEPOSIT,
  MOCK_MARKET,
  MOCK_SCHEDULE,
  MOCK_SCHEDULE_DEPOSIT,
  mockAddresses,
  mockHex,
  mockView,
  ns,
  seedState,
  withdrawalParams,
  type MockState,
  type MockVault,
} from "./mock-data";
import { ATTACK_TESTS, VaultError } from "./errors";
import { withdrawalAmount } from "./report";

const STORAGE_KEY = "bearer:mock:v10";
const CUSTODY_CAP = 16;
const KEYS_DELAY_MS = 1_500;

/** Simulated timings. Real ones must be measured on testnet (brief 1.4). */
const SIGNED_AFTER_MS = 4_200;
const BROADCAST_AFTER_MS = 6_200;
const CONFIRMED_AFTER_MS = 9_500;
const DEPOSIT_CONFIRM_MS: Record<ChainTag, number> = { btc: 10 * 60_000, evm: 10_000, sol: 5_000 };
const DEMO_DEPOSIT: Record<ChainTag, bigint> = {
  btc: 50_000n,
  evm: 5_000_000_000_000_000n,
  sol: 100_000_000n,
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => sleep(min + Math.random() * (max - min));

function amountOf(req: WithdrawRequest): bigint {
  return BigInt(req.chain === "evm" ? req.amountWei : req.chain === "btc" ? req.amountSats : req.lamports);
}


export class MockBearerClient implements BearerClient {
  private state: MockState | null = null;

  private load(): MockState {
    if (this.state) return this.state;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MockState;
        if (parsed.version === 10) return (this.state = parsed);
      }
    } catch {
      // Private mode or corrupt storage: start fresh.
    }
    this.state = seedState(Date.now());
    this.save();
    return this.state;
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage unavailable; state lives in memory for this tab.
    }
  }

  reset() {
    this.state = seedState(Date.now());
    this.save();
  }

  private vault(id: string): MockVault {
    const v = this.load().vaults[id];
    if (!v) throw new VaultError("ERR_NO_VAULT", `There's no vault with number ${id}.`);
    return v;
  }

  private assertOwner(v: MockVault, signer: string) {
    if (v.view.owner_id !== signer) {
      throw new VaultError("ERR_NOT_OWNER", `Only ${v.view.owner_id} can do that.`);
    }
  }

  /** Moves deposits and withdrawals forward based on elapsed time. */
  private advance() {
    const state = this.load();
    const now = Date.now();
    let changed = false;
    for (const v of Object.values(state.vaults)) {
      for (const chain of CHAIN_TAGS) {
        const l = v.ledger[chain];
        for (const d of l.deposits) {
          if (!d.confirmed && now - d.at >= DEPOSIT_CONFIRM_MS[chain]) {
            d.confirmed = true;
            l.confirmed = (BigInt(l.confirmed) + BigInt(d.amount)).toString();
            changed = true;
          }
        }
      }
      for (const w of v.withdrawals) {
        const p = v.progress[w.index];
        if (!p) continue;
        const elapsed = now - p.createdAt;
        if (w.status === "pending" && elapsed >= SIGNED_AFTER_MS) {
          w.status = "signed";
          w.signed_raw_tx = mockHex(`${v.view.token_id}-${w.index}-raw`, 230);
          changed = true;
        }
        if (w.status === "signed" && elapsed >= CONFIRMED_AFTER_MS && !p.settled) {
          const { chain, amount } = withdrawalAmount(w);
          const l = v.ledger[chain];
          const next = BigInt(l.confirmed) - BigInt(amount) - FEES[chain];
          l.confirmed = (next > 0n ? next : 0n).toString();
          p.settled = true;
          changed = true;
        }
      }
    }
    if (changed) this.save();
  }

  private publicView(v: MockVault): VaultView {
    const view = clone(v.view);
    // Saved mock states from before btc_address existed.
    view.btc_address ??= v.addresses.btc;
    view.sol_address ??= v.addresses.sol;
    if (Date.now() < v.keysAt) {
      view.keys = null;
      view.btc_address = null;
      view.evm_address = null;
      view.sol_address = null;
    }
    return view;
  }

  async listVaults(owner: string) {
    await jitter(200, 400);
    this.advance();
    return Object.values(this.load().vaults)
      .filter((v) => v.view.owner_id === owner)
      .sort((a, b) => Number(BigInt(b.view.created_at_ns) - BigInt(a.view.created_at_ns)))
      .map((v) => this.publicView(v));
  }

  async getVault(tokenId: string) {
    await jitter(150, 300);
    this.advance();
    const v = this.load().vaults[tokenId];
    return v ? this.publicView(v) : null;
  }

  async getWithdrawals(tokenId: string) {
    await jitter(120, 240);
    this.advance();
    const v = this.load().vaults[tokenId];
    return v ? clone(v.withdrawals) : [];
  }

  async observe(vault: VaultView): Promise<ChainObservation[]> {
    await jitter(250, 500);
    this.advance();
    const v = this.vault(vault.token_id);
    const now = Date.now();
    return CHAIN_TAGS.map((chain) => {
      const l = v.ledger[chain];
      const pending = l.deposits.filter((d) => !d.confirmed).reduce((s, d) => s + BigInt(d.amount), 0n);
      return {
        chain,
        address: v.addresses[chain],
        confirmed: l.confirmed,
        pending: pending.toString(),
        source: CHAIN_META[chain].source,
        observedAt: now,
        explorerUrl: "",
        deposits: clone(l.deposits).sort((a, b) => b.at - a.at),
        feeEstimate: FEES[chain].toString(),
        simulated: true,
      };
    });
  }

  async createVault(input: { name?: string; finish: Finish }, signer: string) {
    await jitter(900, 1300);
    const state = this.load();
    const id = String(state.nextId++);
    const now = Date.now();
    const name = input.name?.trim() || undefined;
    if (name && new TextEncoder().encode(name).length > 32) throw new VaultError("ERR_NAME_TOO_LONG", "Use 32 characters or fewer.");
    const addresses = mockAddresses(`${id}-${now}`);
    state.vaults[id] = {
      view: mockView(id, signer, now, addresses, { name, finish: input.finish }),
      addresses,
      ledger: { btc: { confirmed: "0", deposits: [] }, evm: { confirmed: "0", deposits: [] }, sol: { confirmed: "0", deposits: [] } },
      withdrawals: [],
      progress: {},
      keysAt: now + KEYS_DELAY_MS,
    };
    this.save();
    return this.publicView(state.vaults[id]);
  }

  async transfer(tokenId: string, receiver: string, signer: string) {
    await jitter(900, 1300);
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (v.view.state.kind !== "sealed") throw new VaultError("ERR_VAULT_OPENED", "Opened vaults can't change hands.");
    if (receiver === signer) throw new VaultError("ERR_SAME_OWNER", "You already hold this vault.");
    if (!this.load().accounts.includes(receiver)) {
      throw new VaultError("ERR_ACCOUNT_MISSING", `${receiver} doesn't exist on NEAR testnet.`);
    }
    v.view.owner_id = receiver;
    v.view.custody.push({ account_id: receiver, since_ns: ns(Date.now()) });
    if (v.view.custody.length > CUSTODY_CAP) v.view.custody.shift();
    this.save();
    return this.publicView(v);
  }

  private open(v: MockVault, signer: string) {
    v.view.state = { kind: "opened", at_ns: ns(Date.now()), by: signer };
  }

  async breakSeal(tokenId: string, signer: string) {
    await jitter(800, 1100);
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (v.view.state.kind !== "sealed") throw new VaultError("ERR_ALREADY_OPENED", "This vault is already opened.");
    this.open(v, signer);
    this.save();
    return this.publicView(v);
  }

  /** Throws the same errors `withdraw_*` would, before anything changes. */
  private checkWithdrawal(v: MockVault, req: WithdrawRequest) {
    if (Date.now() < v.keysAt) throw new VaultError("ERR_KEYS_PENDING", "The vault's keys haven't arrived yet. Try again in a moment.");
    const addressError = validateAddress(req.chain, req.to);
    if (addressError) throw new VaultError("ERR_BAD_ADDRESS", addressError);
    const amount = amountOf(req);
    if (amount <= 0n) throw new VaultError("ERR_INSUFFICIENT_FUNDS", "Enter an amount above zero.");
    const available = BigInt(v.ledger[req.chain].confirmed) - FEES[req.chain];
    if (amount > available) {
      throw new VaultError("ERR_INSUFFICIENT_FUNDS", `Not enough confirmed ${CHAIN_META[req.chain].unit} to cover this and the fee.`);
    }
  }

  private requestWithdrawal(v: MockVault, req: WithdrawRequest): Withdrawal {
    const index = v.view.withdrawal_count;
    const evmNonce = v.withdrawals.filter((w) => w.params.chain === "evm" && w.status !== "failed").length;
    const w: Withdrawal = {
      index,
      params: withdrawalParams(req.chain, req.to, amountOf(req), evmNonce, `${v.view.token_id}-${index}-${Date.now()}`),
      path: v.view.paths[req.chain],
      payload_hashes: [mockHex(`${v.view.token_id}-${index}-${Date.now()}-h`)],
      signed_raw_tx: null,
      status: "pending",
      error: null,
      requested_at_ns: ns(Date.now()),
    };
    v.withdrawals.push(w);
    v.progress[index] = { createdAt: Date.now(), chainTxHash: mockHex(`${v.view.token_id}-${index}-tx-${Date.now()}`) };
    v.view.withdrawal_count += 1;
    v.view.signatures_requested += 1;
    return clone(w);
  }

  async withdraw(tokenId: string, request: WithdrawRequest, signer: string) {
    await jitter(900, 1200);
    this.advance();
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (v.view.state.kind === "sealed") throw new VaultError("ERR_VAULT_SEALED", "Break the seal first.");
    this.checkWithdrawal(v, request);
    const w = this.requestWithdrawal(v, request);
    this.save();
    return w;
  }

  /** Both steps or neither, like the two actions in one NEAR transaction (brief 4.8). */
  async breakSealAndWithdraw(tokenId: string, first: WithdrawRequest, signer: string) {
    await jitter(1100, 1500);
    this.advance();
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (v.view.state.kind !== "sealed") throw new VaultError("ERR_ALREADY_OPENED", "This vault is already opened.");
    this.checkWithdrawal(v, first);
    this.open(v, signer);
    const w = this.requestWithdrawal(v, first);
    this.save();
    return w;
  }

  async trackWithdrawal(tokenId: string, index: number): Promise<WithdrawalProgress> {
    await jitter(100, 200);
    this.advance();
    const v = this.vault(tokenId);
    const w = v.withdrawals.find((x) => x.index === index);
    const p = v.progress[index];
    if (!w) throw new VaultError("ERR_NO_VAULT", "No such withdrawal.");
    const base = { tokenId, index, chainTxHash: null, explorerUrl: null, error: w.error };
    if (w.status === "failed") return { ...base, stage: "failed" };
    if (!p) return { ...base, stage: "confirmed", chainTxHash: null };
    const elapsed = Date.now() - p.createdAt;
    const stage =
      w.status === "pending" ? "signing" : elapsed < BROADCAST_AFTER_MS ? "broadcasting" : elapsed < CONFIRMED_AFTER_MS ? "confirming" : "confirmed";
    return { ...base, stage, chainTxHash: stage === "signing" ? null : p.chainTxHash };
  }

  async runAttack(kind: AttackKind, tokenId: string): Promise<AttackResult> {
    await jitter(700, 1100);
    this.vault(tokenId);
    const codes: Record<AttackKind, string> = {
      former_owner_withdraws: "ERR_NOT_OWNER",
      former_owner_breaks_seal: "ERR_NOT_OWNER",
      transfer_opened_vault: "ERR_VAULT_OPENED",
      withdraw_sealed_vault: "ERR_VAULT_SEALED",
      sign_arbitrary_bytes: "MethodNotFound",
    };
    return { kind, rejected: true, errorCode: codes[kind], testName: ATTACK_TESTS[kind], txHash: null, simulated: true };
  }

  async accountExists(accountId: string) {
    await jitter(200, 400);
    return this.load().accounts.includes(accountId);
  }

  /* ---------- the simulated schedule: same rules as contracts/schedule ---------- */

  readonly scheduleId = MOCK_SCHEDULE;

  async schedules() {
    await jitter(150, 300);
    return clone(Object.values(this.load().schedules));
  }

  async getSchedule(tokenId: string) {
    await jitter(100, 200);
    return clone(this.load().schedules[tokenId] ?? null);
  }

  async scheduleHandover(tokenId: string, recipient: string, releaseAtMs: number, cancellable: boolean, signer: string) {
    await jitter(1200, 1800);
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (v.view.state.kind !== "sealed") throw new VaultError("ERR_VAULT_OPENED", "Opened vaults can't change hands, so they can't be scheduled.");
    if (recipient === signer) throw new VaultError("ERR_RECIPIENT", "Choose someone else to hand it to.");
    if (releaseAtMs < Date.now() + 60_000) throw new VaultError("ERR_DATE_TOO_SOON", "Pick a time at least a minute from now.");
    const s: HandoverSchedule = {
      token_id: tokenId,
      giver: signer,
      recipient,
      release_at_ns: ns(releaseAtMs),
      cancellable,
      scheduled_at_ns: ns(Date.now()),
      deposit: MOCK_SCHEDULE_DEPOSIT,
      state: { kind: "waiting" },
    };
    this.moveTo(v, MOCK_SCHEDULE);
    this.load().schedules[tokenId] = s;
    this.save();
    return clone(s);
  }

  async releaseHandover(tokenId: string, signer: string) {
    void signer;
    await jitter(1500, 2200);
    const s = this.load().schedules[tokenId];
    if (!s) throw new VaultError("ERR_NOT_SCHEDULED", "This vault isn't scheduled.");
    if (Date.now() * 1e6 < Number(s.release_at_ns)) throw new VaultError("ERR_TOO_EARLY", "It can't be handed over before its date.");
    if (!this.load().accounts.includes(s.recipient)) {
      throw new VaultError("ERR_RECIPIENT_MISSING", `${s.recipient} doesn't exist on NEAR yet, so the vault stays scheduled until it does.`);
    }
    const v = this.vault(tokenId);
    this.moveTo(v, s.recipient);
    delete this.load().schedules[tokenId];
    this.save();
    return this.publicView(v);
  }

  async cancelHandover(tokenId: string, signer: string) {
    await jitter(1200, 1800);
    const s = this.load().schedules[tokenId];
    if (!s) throw new VaultError("ERR_NOT_SCHEDULED", "This vault isn't scheduled.");
    if (s.giver !== signer) throw new VaultError("ERR_NOT_GIVER", `Only ${s.giver} can cancel it.`);
    if (!s.cancellable) throw new VaultError("ERR_NOT_CANCELLABLE", "This handover was scheduled so that nobody can cancel it.");
    if (Date.now() * 1e6 >= Number(s.release_at_ns)) throw new VaultError("ERR_TOO_LATE", "The date has passed, so it can only be handed over now.");
    const v = this.vault(tokenId);
    this.moveTo(v, signer);
    delete this.load().schedules[tokenId];
    this.save();
    return this.publicView(v);
  }

  /* ---------- the simulated lending contract: same rules as contracts/lend ---------- */

  readonly lendId = MOCK_LEND;

  async loans() {
    await jitter(150, 300);
    return clone(Object.values(this.load().loans));
  }

  async getLoan(tokenId: string) {
    await jitter(100, 200);
    return clone(this.load().loans[tokenId] ?? null);
  }

  async lendConfig(): Promise<LendConfig> {
    return {
      nft_contract: "bearer-v1.testnet",
      loan_deposit: MOCK_LOAN_DEPOSIT,
      min_principal: (10n ** 21n).toString(),
      min_term_ns: ns(60_000),
      max_term_ns: ns(10 * 366 * 24 * 3600 * 1000),
    };
  }

  private loan(tokenId: string) {
    const l = this.load().loans[tokenId];
    if (!l) throw new VaultError("ERR_NO_LOAN", "This vault isn't pledged for a loan.");
    return l;
  }

  async requestLoan(tokenId: string, terms: LoanTerms, signer: string) {
    await jitter(1200, 1800);
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (v.view.state.kind !== "sealed") throw new VaultError("ERR_VAULT_OPENED", "Opened vaults can't change hands, so they can't be pledged.");
    if (BigInt(terms.principalYocto) < 10n ** 21n) throw new VaultError("ERR_PRINCIPAL", "The smallest loan is 0.001 NEAR.");
    if (BigInt(terms.repaymentYocto) < BigInt(terms.principalYocto)) throw new VaultError("ERR_REPAYMENT", "The repayment can't be less than the loan.");
    if (terms.termMs < 60_000) throw new VaultError("ERR_TERM", "The shortest term is a minute.");
    const l: VaultLoan = {
      token_id: tokenId,
      borrower: signer,
      principal: terms.principalYocto,
      repayment: terms.repaymentYocto,
      term_ns: ns(terms.termMs),
      deposit: MOCK_LOAN_DEPOSIT,
      requested_at_ns: ns(Date.now()),
      state: { kind: "requested" },
    };
    this.moveTo(v, MOCK_LEND);
    this.load().loans[tokenId] = l;
    this.save();
    return clone(l);
  }

  async fundLoan(loan: VaultLoan, signer: string) {
    await jitter(1200, 1800);
    const l = this.loan(loan.token_id);
    if (l.state.kind !== "requested") throw new VaultError("ERR_NOT_REQUESTED", "Someone has already lent against this vault.");
    if (l.borrower === signer) throw new VaultError("ERR_OWN_LOAN", "You asked for this loan; you can't fund it yourself.");
    if (l.repayment !== loan.repayment || l.term_ns !== loan.term_ns || l.principal !== loan.principal) {
      throw new VaultError("ERR_TERMS_CHANGED", "The terms changed since you looked. Check them and try again.");
    }
    l.state = { kind: "active", lender: signer, due_at_ns: ns(Date.now() + Number(BigInt(l.term_ns) / 1_000_000n)) };
    this.save();
    return clone(l);
  }

  async repayLoan(tokenId: string, signer: string) {
    await jitter(1500, 2200);
    const l = this.loan(tokenId);
    if (l.state.kind !== "active") throw new VaultError("ERR_NOT_ACTIVE", "Nobody has lent against this vault, so there's nothing to repay.");
    if (l.borrower !== signer) throw new VaultError("ERR_NOT_BORROWER", `Only ${l.borrower} can repay it.`);
    if (Date.now() * 1e6 >= Number(l.state.due_at_ns)) throw new VaultError("ERR_PAST_DUE", "The due date has passed, so only the lender can act now.");
    const v = this.vault(tokenId);
    this.moveTo(v, signer);
    delete this.load().loans[tokenId];
    this.save();
    return this.publicView(v);
  }

  async forecloseLoan(tokenId: string, signer: string) {
    await jitter(1500, 2200);
    const l = this.loan(tokenId);
    if (l.state.kind !== "active") throw new VaultError("ERR_NOT_ACTIVE", "Nobody has lent against this vault.");
    if (l.state.lender !== signer) throw new VaultError("ERR_NOT_LENDER", `Only ${l.state.lender}, who lent against it, can take it.`);
    if (Date.now() * 1e6 < Number(l.state.due_at_ns)) throw new VaultError("ERR_NOT_DUE", "The borrower can still repay until the due date.");
    const v = this.vault(tokenId);
    this.moveTo(v, signer);
    delete this.load().loans[tokenId];
    this.save();
    return this.publicView(v);
  }

  async cancelLoanRequest(tokenId: string, signer: string) {
    await jitter(1200, 1800);
    const l = this.loan(tokenId);
    if (l.state.kind !== "requested") throw new VaultError("ERR_NOT_REQUESTED", "Someone has already lent against it, so it stays until you repay.");
    if (l.borrower !== signer) throw new VaultError("ERR_NOT_BORROWER", `Only ${l.borrower} can take it back.`);
    const v = this.vault(tokenId);
    this.moveTo(v, signer);
    delete this.load().loans[tokenId];
    this.save();
    return this.publicView(v);
  }

  /* ---------- the simulated market: same rules as contracts/market ---------- */

  readonly marketId = MOCK_MARKET;

  async listings() {
    await jitter(150, 300);
    return clone(Object.values(this.load().listings));
  }

  async getListing(tokenId: string) {
    await jitter(100, 200);
    return clone(this.load().listings[tokenId] ?? null);
  }

  async marketConfig(): Promise<MarketConfig> {
    return { nft_contract: "bearer-v1.testnet", listing_deposit: MOCK_LISTING_DEPOSIT, min_price: (10n ** 21n).toString() };
  }

  private moveTo(v: MockVault, owner: string) {
    v.view.owner_id = owner;
    v.view.custody.push({ account_id: owner, since_ns: ns(Date.now()) });
    if (v.view.custody.length > CUSTODY_CAP) v.view.custody.shift();
  }

  async listVault(tokenId: string, priceYocto: string, signer: string): Promise<MarketListing> {
    await jitter(1200, 1800);
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (v.view.state.kind !== "sealed") throw new VaultError("ERR_VAULT_OPENED", "Opened vaults can't change hands, so they can't be listed.");
    if (BigInt(priceYocto) < 10n ** 21n) throw new VaultError("ERR_PRICE", "The lowest price is 0.001 NEAR.");
    const listing: MarketListing = {
      token_id: tokenId,
      seller: signer,
      price: priceYocto,
      deposit: MOCK_LISTING_DEPOSIT,
      listed_at_ns: ns(Date.now()),
      state: { kind: "listed" },
    };
    this.moveTo(v, MOCK_MARKET);
    this.load().listings[tokenId] = listing;
    this.save();
    return clone(listing);
  }

  async buyVault(tokenId: string, priceYocto: string, signer: string) {
    await jitter(1500, 2200);
    const listing = this.load().listings[tokenId];
    if (!listing) throw new VaultError("ERR_NOT_LISTED", "This vault isn't for sale.");
    if (listing.seller === signer) throw new VaultError("ERR_OWN_LISTING", "You listed this vault; delist it instead.");
    if (listing.price !== priceYocto) throw new VaultError("ERR_WRONG_PRICE", "The price changed. Check it and try again.");
    const v = this.vault(tokenId);
    this.moveTo(v, signer);
    delete this.load().listings[tokenId];
    const paid = (BigInt(listing.price) + BigInt(listing.deposit)).toString();
    this.load().sales.push({ tokenId, seller: listing.seller, buyer: signer, price: listing.price, paid, atMs: Date.now() });
    this.save();
    return this.publicView(v);
  }

  async delistVault(tokenId: string, signer: string) {
    await jitter(1200, 1800);
    const listing = this.load().listings[tokenId];
    if (!listing) throw new VaultError("ERR_NOT_LISTED", "This vault isn't for sale.");
    if (listing.seller !== signer) throw new VaultError("ERR_NOT_SELLER", `Only ${listing.seller} can delist it.`);
    const v = this.vault(tokenId);
    this.moveTo(v, signer);
    delete this.load().listings[tokenId];
    this.save();
    return this.publicView(v);
  }

  async marketBalances(accountId: string): Promise<MarketBalances> {
    void accountId;
    await jitter(120, 240);
    // The simulated market pays sellers straight away, so nothing bounces and nothing waits.
    return { claimable: "0", deposit: "0" };
  }

  async claimPayout(signer: string): Promise<MarketBalances> {
    await jitter(900, 1300);
    throw new VaultError("ERR_NOTHING_TO_CLAIM", `Nothing is waiting for ${signer}.`);
  }

  async withdrawListingDeposit(signer: string): Promise<MarketBalances> {
    await jitter(900, 1300);
    throw new VaultError("ERR_NOTHING_TO_WITHDRAW", `No listing deposit is waiting for ${signer}.`);
  }

  /** Same reading as testnet: custody logs for what happened, the sales record for prices. */
  async accountActivity(accountId: string): Promise<AccountActivity> {
    await jitter(200, 400);
    this.advance();
    const state = this.load();
    const events = Object.values(state.vaults).flatMap((v) => custodyEvents(this.publicView(v), accountId, MOCK_MARKET, MOCK_SCHEDULE, MOCK_LEND));
    for (const e of events) {
      if (e.kind !== "sold") continue;
      const sale = state.sales.find((x) => x.tokenId === e.tokenId && Math.abs(x.atMs - e.atMs) < 60_000);
      e.priceYocto = sale?.price ?? null;
      e.paidYocto = sale?.paid ?? null;
    }
    for (const s of Object.values(state.schedules)) {
      if (s.recipient !== accountId || s.state.kind !== "waiting") continue;
      const atMs = Number(BigInt(s.scheduled_at_ns) / 1_000_000n);
      events.push({ id: `scheduled_for_you:${s.token_id}:${s.scheduled_at_ns}`, kind: "scheduled_for_you", tokenId: s.token_id, atMs, counterparty: s.giver, byOthers: true, releaseAtMs: Number(BigInt(s.release_at_ns) / 1_000_000n) });
    }
    events.sort((a, b) => b.atMs - a.atMs);
    return { events, source: "the simulated demo", partial: false };
  }

  async simulateDeposit(tokenId: string, chain: ChainTag) {
    await jitter(500, 800);
    const v = this.vault(tokenId);
    // Lands as pending and confirms about 15 s later.
    const at = Date.now() - DEPOSIT_CONFIRM_MS[chain] + 15_000;
    v.ledger[chain].deposits.push({
      txHash: mockHex(`sim-${tokenId}-${chain}-${Date.now()}`),
      amount: DEMO_DEPOSIT[chain].toString(),
      confirmed: false,
      at,
      explorerUrl: null,
    });
    this.save();
  }
}
