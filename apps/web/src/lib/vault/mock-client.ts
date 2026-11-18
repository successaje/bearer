import type {
  AccountActivity,
  AttackKind,
  AttackResult,
  BearerClient,
  ChainObservation,
  ChainTag,
  EscrowEvent,
  EscrowName,
  Finish,
  HandoverSchedule,
  LendConfig,
  LoanTerms,
  MarketBalances,
  MarketConfig,
  MarketListing,
  NamePrice,
  StandingConfig,
  StandingPlan,
  StandingTerms,
  SwitchConfig,
  VaultLoan,
  VaultHistory,
  VaultName,
  VaultSwitch,
  VaultView,
  Withdrawal,
  WithdrawalProgress,
  WithdrawRequest,
} from "@bearer/sdk";
import { CHAIN_TAGS, custodyEvents, mergeHistory, recordEvents, standing, switchDueMs } from "@bearer/sdk";
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
  MOCK_NAMES,
  MOCK_STANDING,
  MOCK_PLAN_DEPOSIT,
  MOCK_TLA,
  MOCK_SWITCH,
  MOCK_SWITCH_DEPOSIT,
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

const STORAGE_KEY = "bearer:mock:v12";
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
        if (parsed.version === 12) return (this.state = parsed);
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
    this.logEvent(v, "schedule", "scheduled", { giver: signer, recipient, release_at_ns: s.release_at_ns, cancellable });
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
    this.logEvent(v, "schedule", "released", { giver: s.giver, recipient: s.recipient });
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
    this.logEvent(v, "schedule", "cancelled", { giver: signer });
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
    this.logEvent(v, "lend", "requested", { borrower: signer, principal: l.principal, repayment: l.repayment, term_ns: l.term_ns });
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
    this.logEvent(v, "lend", "repaid", { borrower: signer, lender: l.state.lender, repayment: l.repayment });
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
    this.logEvent(v, "lend", "foreclosed", { borrower: l.borrower, lender: signer });
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
    this.logEvent(v, "lend", "cancelled", { borrower: signer });
    delete this.load().loans[tokenId];
    this.save();
    return this.publicView(v);
  }

  /* ---------- the simulated switch: same rules as contracts/switch ---------- */

  readonly switchId = MOCK_SWITCH;

  async switches() {
    await jitter(150, 300);
    return clone(Object.values(this.load().switches));
  }

  async getSwitch(tokenId: string) {
    await jitter(100, 200);
    return clone(this.load().switches[tokenId] ?? null);
  }

  async switchConfig(): Promise<SwitchConfig> {
    return {
      nft_contract: "bearer-v1.testnet",
      switch_deposit: MOCK_SWITCH_DEPOSIT,
      min_interval_ns: ns(60_000),
      max_interval_ns: ns(10 * 366 * 24 * 3600 * 1000),
    };
  }

  private armedSwitch(tokenId: string, signer: string) {
    const s = this.load().switches[tokenId];
    if (!s) throw new VaultError("ERR_NO_SWITCH", "This vault isn't in a switch.");
    if (s.state.kind !== "armed") throw new VaultError("ERR_IN_PROGRESS", "It's already on its way. Check again in a moment.");
    if (s.owner !== signer) throw new VaultError("ERR_NOT_OWNER", `Only ${s.owner}, who set it up, can do that.`);
    return s;
  }

  private checkBeneficiary(owner: string, beneficiary: string) {
    if (beneficiary === owner || beneficiary === MOCK_SWITCH) throw new VaultError("ERR_BENEFICIARY", "Name someone else: the vault goes to them if you go quiet.");
  }

  private checkInterval(ms: number) {
    if (ms < 60_000 || ms > 10 * 366 * 24 * 3600 * 1000) throw new VaultError("ERR_INTERVAL", "Choose between a minute and ten years.");
  }

  async armSwitch(tokenId: string, beneficiary: string, intervalMs: number, signer: string) {
    await jitter(1200, 1800);
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (v.view.state.kind !== "sealed") throw new VaultError("ERR_VAULT_OPENED", "Opened vaults can't change hands, so they can't go in a switch.");
    this.checkBeneficiary(signer, beneficiary);
    this.checkInterval(intervalMs);
    const now = ns(Date.now());
    const s: VaultSwitch = {
      token_id: tokenId,
      owner: signer,
      beneficiary,
      interval_ns: ns(intervalMs),
      last_check_in_ns: now,
      armed_at_ns: now,
      deposit: MOCK_SWITCH_DEPOSIT,
      state: { kind: "armed" },
    };
    this.moveTo(v, MOCK_SWITCH);
    this.logEvent(v, "switch", "armed", { owner: signer, beneficiary, interval_ns: s.interval_ns, due_at_ns: ns(Date.now() + intervalMs) });
    this.load().switches[tokenId] = s;
    this.save();
    return clone(s);
  }

  async checkIn(tokenId: string, signer: string) {
    await jitter(900, 1400);
    const s = this.armedSwitch(tokenId, signer);
    s.last_check_in_ns = ns(Date.now());
    this.save();
    return clone(s);
  }

  async updateSwitch(tokenId: string, changes: { beneficiary?: string; intervalMs?: number }, signer: string) {
    await jitter(900, 1400);
    const s = this.armedSwitch(tokenId, signer);
    if (changes.beneficiary !== undefined) this.checkBeneficiary(s.owner, changes.beneficiary);
    if (changes.intervalMs !== undefined) this.checkInterval(changes.intervalMs);
    if (changes.beneficiary !== undefined) s.beneficiary = changes.beneficiary;
    if (changes.intervalMs !== undefined) s.interval_ns = ns(changes.intervalMs);
    s.last_check_in_ns = ns(Date.now());
    this.save();
    return clone(s);
  }

  async takeBackSwitch(tokenId: string, signer: string) {
    await jitter(1500, 2200);
    this.armedSwitch(tokenId, signer);
    const v = this.vault(tokenId);
    this.moveTo(v, signer);
    this.logEvent(v, "switch", "taken_back", { owner: signer });
    delete this.load().switches[tokenId];
    this.save();
    return this.publicView(v);
  }

  async releaseSwitch(tokenId: string) {
    await jitter(1500, 2200);
    const s = this.load().switches[tokenId];
    if (!s) throw new VaultError("ERR_NO_SWITCH", "This vault isn't in a switch.");
    if (s.state.kind !== "armed") throw new VaultError("ERR_IN_PROGRESS", "It's already on its way. Check again in a moment.");
    if (Date.now() < switchDueMs(s)) throw new VaultError("ERR_NOT_SILENT", `${s.owner} checked in recently enough; it can't be handed over yet.`);
    if (!this.load().accounts.includes(s.beneficiary)) {
      throw new VaultError("ERR_BENEFICIARY_MISSING", `${s.beneficiary} doesn't exist on NEAR, so the vault stays in the switch.`);
    }
    const v = this.vault(tokenId);
    this.moveTo(v, s.beneficiary);
    this.logEvent(v, "switch", "released", { owner: s.owner, beneficiary: s.beneficiary });
    delete this.load().switches[tokenId];
    this.save();
    return this.publicView(v);
  }

  /* ---------- simulated standing payments: same rules as contracts/standing ---------- */

  readonly standingId = MOCK_STANDING;

  async standingPlans() {
    await jitter(150, 300);
    return clone(Object.values(this.load().plans));
  }

  async getStandingPlan(tokenId: string) {
    await jitter(100, 200);
    return clone(this.load().plans[tokenId] ?? null);
  }

  async standingConfig(): Promise<StandingConfig> {
    return { nft_contract: "bearer-v1.testnet", plan_deposit: MOCK_PLAN_DEPOSIT, min_interval_ns: ns(60_000), max_btc_inputs: 8 };
  }

  private plan(tokenId: string) {
    const p = this.load().plans[tokenId];
    if (!p) throw new VaultError("ERR_NOT_PLANNED", "This vault has no standing payments.");
    return p;
  }

  async planPayments(tokenId: string, terms: StandingTerms, signer: string) {
    await jitter(1200, 1800);
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (v.view.state.kind !== "sealed") throw new VaultError("ERR_VAULT_OPENED", "Opened vaults can't change hands, so they can't be set to pay.");
    if (terms.payee === signer || terms.payee === MOCK_STANDING) throw new VaultError("ERR_PAYEE", "Name someone else to collect the payments.");
    const addressError = validateAddress(terms.chain, terms.to);
    if (addressError) throw new VaultError("ERR_BAD_ADDRESS", addressError);
    if (BigInt(terms.amount) <= 0n) throw new VaultError("ERR_AMOUNT", "Enter an amount above zero.");
    if (terms.intervalMs < 60_000 || terms.intervalMs > 10 * 366 * 24 * 3600 * 1000) throw new VaultError("ERR_INTERVAL", "Choose a period between a minute and ten years.");
    if (!terms.cancellable && terms.maxPayments === null) throw new VaultError("ERR_IRREVOCABLE_NEEDS_AN_END", "A plan nobody can stop needs a number of payments.");
    const now = Date.now();
    const plan: StandingPlan = {
      token_id: tokenId,
      giver: signer,
      payee: terms.payee,
      chain: terms.chain,
      to: terms.chain === "evm" ? terms.to.toLowerCase() : terms.to,
      chain_id: terms.chain === "evm" ? "84532" : null,
      amount: terms.amount,
      max_fee: terms.chain === "sol" ? "0" : terms.maxFee,
      interval_ns: ns(terms.intervalMs),
      first_due_ns: ns(Math.max(now, terms.firstDueMs)),
      max_payments: terms.maxPayments,
      cancellable: terms.cancellable,
      payments: 0,
      withdrawals: 0,
      opened: false,
      stopped_at_ns: null,
      planned_at_ns: ns(now),
      deposit: MOCK_PLAN_DEPOSIT,
      state: { kind: "waiting" },
    };
    this.moveTo(v, MOCK_STANDING);
    this.logEvent(v, "standing", "planned", {
      giver: signer,
      payee: plan.payee,
      chain: plan.chain,
      to: plan.to,
      amount: plan.amount,
      interval_ns: plan.interval_ns,
      first_due_ns: plan.first_due_ns,
      max_payments: plan.max_payments,
      cancellable: plan.cancellable,
    });
    this.load().plans[tokenId] = plan;
    this.save();
    return clone(plan);
  }

  async collectPayment(tokenId: string, signer: string) {
    await jitter(1200, 1800);
    this.advance();
    const p = this.plan(tokenId);
    if (p.payee !== signer) throw new VaultError("ERR_NOT_PAYEE", `Only ${p.payee} can collect these payments.`);
    if (standing.ended(p, Date.now())) throw new VaultError("ERR_ENDED", "These payments have ended.");
    if (standing.owed(p, Date.now()) < 1) throw new VaultError("ERR_NOT_DUE", "The next payment isn't due yet.");
    const v = this.vault(tokenId);
    const req: WithdrawRequest =
      p.chain === "btc" ? { chain: "btc", to: p.to, amountSats: p.amount } : p.chain === "evm" ? { chain: "evm", to: p.to, amountWei: p.amount } : { chain: "sol", to: p.to, lamports: p.amount };
    this.checkWithdrawal(v, req);
    if (v.view.state.kind === "sealed") this.open(v, MOCK_STANDING);
    const w = this.requestWithdrawal(v, req);
    p.opened = true;
    p.payments += 1;
    p.withdrawals += 1;
    this.save();
    return w;
  }

  private givers(tokenId: string, signer: string) {
    const p = this.plan(tokenId);
    if (p.giver !== signer) throw new VaultError("ERR_NOT_GIVER", `Only ${p.giver}, who set it up, can do that.`);
    return p;
  }

  async stopPayments(tokenId: string, signer: string) {
    await jitter(900, 1300);
    const p = this.givers(tokenId, signer);
    if (!p.cancellable) throw new VaultError("ERR_NOT_CANCELLABLE", "These payments were set up so that nobody can stop them.");
    if (standing.ended(p, Date.now())) throw new VaultError("ERR_ENDED", "These payments have already ended.");
    p.stopped_at_ns = ns(Date.now());
    this.save();
    return clone(p);
  }

  async takeBackPlanned(tokenId: string, signer: string) {
    await jitter(1500, 2200);
    const p = this.givers(tokenId, signer);
    if (p.opened) throw new VaultError("ERR_VAULT_OPENED", "The first payment opened this vault, and opened vaults never change hands. Withdraw through the plan instead.");
    if (!standing.giverFree(p, Date.now())) throw new VaultError("ERR_PLAN_BINDING", "These payments can't be stopped, so the vault stays until they end.");
    const v = this.vault(tokenId);
    this.moveTo(v, signer);
    this.logEvent(v, "standing", "taken_back", { giver: signer, payments: p.payments });
    delete this.load().plans[tokenId];
    this.save();
    return this.publicView(v);
  }

  async withdrawThroughPlan(tokenId: string, request: WithdrawRequest, signer: string) {
    await jitter(1200, 1800);
    this.advance();
    const p = this.givers(tokenId, signer);
    if (!p.opened) throw new VaultError("ERR_VAULT_SEALED", "It's still sealed: take the vault back instead.");
    if (!standing.giverFree(p, Date.now())) throw new VaultError("ERR_PLAN_BINDING", "These payments can't be stopped, so withdrawals wait until they end.");
    const v = this.vault(tokenId);
    this.checkWithdrawal(v, request);
    const w = this.requestWithdrawal(v, request);
    p.withdrawals += 1;
    this.save();
    return w;
  }

  /* ---------- simulated vault names: same rules as contracts/names ---------- */

  readonly namesId = MOCK_NAMES;
  readonly tlaId = MOCK_TLA;

  async getVaultName(tokenId: string): Promise<VaultName | null> {
    await jitter(100, 200);
    const n = this.load().names?.[tokenId];
    return n ? { token_id: tokenId, account_id: n.account_id, balance: n.balance, expires_at_ns: n.expires_at_ns, lifecycle: "Active" } : null;
  }

  async namePrice(label: string): Promise<NamePrice & { available: boolean }> {
    await jitter(150, 250);
    const taken = Object.values(this.load().names ?? {}).some((n) => n.account_id === `${label}.${MOCK_TLA}`);
    // The same prices as the testnet fleet: $0.001 of rent and a 0.01 NEAR opening deposit.
    return { rent: "315810000000000000000", deposit: (10n ** 22n).toString(), total: "10315810000000000000000", available: !taken };
  }

  async nameVault(tokenId: string, label: string, signer: string) {
    await jitter(1500, 2200);
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (!/^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/.test(label)) throw new VaultError("ERR_BAD_LABEL", "Use 3 to 32 lower-case letters, digits or inner hyphens.");
    const state = this.load();
    state.names ??= {};
    if (state.names[tokenId]) throw new VaultError("ERR_ALREADY_NAMED", "This vault already has a name.");
    if (!(await this.namePrice(label)).available) throw new VaultError("ERR_NAME_TAKEN", `${label}.${MOCK_TLA} is already rented.`);
    state.names[tokenId] = { account_id: `${label}.${MOCK_TLA}`, balance: (10n ** 22n).toString(), expires_at_ns: ns(Date.now() + 365 * 24 * 3600 * 1000) };
    this.save();
    return (await this.getVaultName(tokenId)) as VaultName;
  }

  async withdrawFromName(tokenId: string, receiver: string, amountYocto: string, signer: string) {
    await jitter(1200, 1800);
    const n = this.load().names?.[tokenId];
    if (!n) throw new VaultError("ERR_NOT_NAMED", "This vault has no name.");
    const v = this.vault(tokenId);
    if (v.view.owner_id !== signer) throw new VaultError("ERR_WITHDRAWAL_REFUSED", "Only the vault's holder can take NEAR out of its name.");
    if (v.view.state.kind !== "opened") throw new VaultError("ERR_WITHDRAWAL_REFUSED", "The vault is still sealed, so its name's NEAR stays inside until it's opened.");
    // The account keeps what its storage needs, as on testnet.
    const free = BigInt(n.balance) - 4n * 10n ** 21n;
    if (BigInt(amountYocto) <= 0n || BigInt(amountYocto) > free) throw new VaultError("ERR_WITHDRAWAL_REFUSED", "That's more than the name can send, after what its storage needs.");
    void receiver;
    n.balance = (BigInt(n.balance) - BigInt(amountYocto)).toString();
    this.save();
    return (await this.getVaultName(tokenId)) as VaultName;
  }

  async renewName(tokenId: string, signer: string) {
    await jitter(1000, 1500);
    void signer;
    const n = this.load().names?.[tokenId];
    if (!n) throw new VaultError("ERR_NOT_NAMED", "This vault has no name.");
    n.expires_at_ns = (BigInt(n.expires_at_ns) + 365n * 24n * 3600n * 1_000_000_000n).toString();
    this.save();
    return (await this.getVaultName(tokenId)) as VaultName;
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

  /** What the escrow logs as the vault moves; call right after moveTo, so it's the move's time. */
  private logEvent(v: MockVault, escrow: EscrowName, event: string, data: Record<string, unknown>) {
    const state = this.load();
    const log = ((state.events ??= {})[v.view.token_id] ??= []);
    const at = v.view.custody[v.view.custody.length - 1].since_ns;
    log.push({ escrow, event, data: { token_id: v.view.token_id, ...data }, at_ns: at, from: "log", tx: null });
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
    this.logEvent(v, "market", "listed", { seller: signer, price: priceYocto });
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
    this.logEvent(v, "market", "sold", { seller: listing.seller, buyer: signer, price: listing.price });
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
    this.logEvent(v, "market", "delisted", { seller: signer });
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
    const events = Object.values(state.vaults).flatMap((v) => custodyEvents(this.publicView(v), accountId, MOCK_MARKET, MOCK_SCHEDULE, MOCK_LEND, MOCK_SWITCH, MOCK_STANDING));
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

  /** Same reading as testnet: what the escrows logged as the vault moved, plus their current records. */
  async vaultHistory(tokenId: string): Promise<VaultHistory> {
    await jitter(200, 400);
    this.advance();
    const state = this.load();
    const logged: EscrowEvent[] = clone(state.events?.[tokenId] ?? []);
    const record = recordEvents({
      listing: state.listings[tokenId],
      schedule: state.schedules[tokenId],
      loan: state.loans[tokenId],
      switch: state.switches[tokenId],
      plan: state.plans?.[tokenId],
    });
    return { events: mergeHistory(logged, record), source: "the simulated demo", complete: true };
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
