import type {
  AttackKind,
  AttackResult,
  BearerClient,
  ChainObservation,
  ChainTag,
  Finish,
  Holdings,
  MarketConfig,
  MarketListing,
  NftInfo,
  TokenInfo,
  VaultView,
  Withdrawal,
  WithdrawalProgress,
  WithdrawRequest,
} from "@bearer/sdk";
import { CHAIN_TAGS } from "@bearer/sdk";
import { validateAddress } from "@/lib/validation";
import { CHAIN_META } from "./format";
import {
  FEES,
  MOCK_ENTRY_STORAGE,
  MOCK_LISTING_DEPOSIT,
  MOCK_NFT_CONTRACT,
  MOCK_TOKENS,
  MOCK_MARKET,
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

const STORAGE_KEY = "bearer:mock:v5";
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
        if (parsed.version === 5) return (this.state = parsed);
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

  /* ---------- v2 holdings: same rules as contracts/bearer/src/holdings.rs ---------- */

  readonly supportsHoldings = true;

  private held(tokenId: string): Holdings {
    const state = this.load();
    state.holdings[tokenId] ??= { near: "0", tokens: [], nfts: [] };
    return state.holdings[tokenId];
  }

  /** New entries are paid from the vault's NEAR (H6). */
  private chargeEntry(h: Holdings) {
    if (BigInt(h.near) < MOCK_ENTRY_STORAGE) {
      throw new VaultError("ERR_VAULT_NEAR_BELOW_STORAGE", "Add a little NEAR to the vault first: each token or NFT it holds uses some for storage.");
    }
    h.near = (BigInt(h.near) - MOCK_ENTRY_STORAGE).toString();
  }

  private openedForOwner(tokenId: string, signer: string) {
    const v = this.vault(tokenId);
    this.assertOwner(v, signer);
    if (v.view.state.kind === "sealed") throw new VaultError("ERR_VAULT_SEALED", "Break the seal first. Nothing leaves a sealed vault.");
  }

  async holdings(tokenId: string) {
    await jitter(120, 240);
    this.vault(tokenId);
    return clone(this.load().holdings[tokenId] ?? { near: "0", tokens: [], nfts: [] });
  }

  async tokenInfo(contract: string): Promise<TokenInfo> {
    const t = MOCK_TOKENS[contract];
    if (!t) throw new VaultError("ERR_UNKNOWN_TOKEN", `The simulated demo knows ${Object.keys(MOCK_TOKENS).join(" and ")}.`);
    return t;
  }

  async nftInfo(contract: string, nftTokenId: string): Promise<NftInfo> {
    if (contract !== MOCK_NFT_CONTRACT) throw new VaultError("ERR_UNKNOWN_NFT", `The simulated demo knows ${MOCK_NFT_CONTRACT}.`);
    return { contract, token_id: nftTokenId, title: `Ticket #${nftTokenId}`, media: null };
  }

  async depositNear(tokenId: string, yocto: string, signer: string) {
    void signer;
    await jitter(900, 1300);
    this.vault(tokenId);
    if (BigInt(yocto) < 10n ** 22n) throw new VaultError("ERR_DEPOSIT", "Add at least 0.01 NEAR.");
    const h = this.held(tokenId);
    h.near = (BigInt(h.near) + BigInt(yocto)).toString();
    this.save();
    return clone(h);
  }

  async loadToken(tokenId: string, contract: string, amount: string, signer: string) {
    await jitter(1100, 1500);
    this.assertOwner(this.vault(tokenId), signer);
    await this.tokenInfo(contract);
    if (BigInt(amount) <= 0n) throw new VaultError("ERR_AMOUNT", "Enter an amount above zero.");
    const h = this.held(tokenId);
    const entry = h.tokens.find((t) => t.contract === contract);
    if (entry) entry.amount = (BigInt(entry.amount) + BigInt(amount)).toString();
    else {
      if (h.tokens.length >= 8) throw new VaultError("ERR_TOO_MANY_TOKENS", "A vault holds at most 8 kinds of token.");
      this.chargeEntry(h);
      h.tokens.push({ contract, amount, pending: "0" });
    }
    this.save();
    return clone(h);
  }

  async loadNft(tokenId: string, contract: string, nftTokenId: string, signer: string) {
    await jitter(1100, 1500);
    this.assertOwner(this.vault(tokenId), signer);
    await this.nftInfo(contract, nftTokenId);
    const h = this.held(tokenId);
    if (h.nfts.some((n) => n.contract === contract && n.token_id === nftTokenId)) throw new VaultError("ERR_HELD", "The vault already holds that NFT.");
    if (h.nfts.length >= 16) throw new VaultError("ERR_TOO_MANY_NFTS", "A vault holds at most 16 NFTs.");
    this.chargeEntry(h);
    h.nfts.push({ contract, token_id: nftTokenId, pending: false });
    this.save();
    return clone(h);
  }

  async withdrawNear(tokenId: string, receiver: string, yocto: string, signer: string) {
    void receiver;
    await jitter(1100, 1500);
    this.openedForOwner(tokenId, signer);
    const h = this.held(tokenId);
    if (BigInt(yocto) <= 0n || BigInt(yocto) > BigInt(h.near)) throw new VaultError("ERR_AMOUNT", "That's more than the vault holds.");
    h.near = (BigInt(h.near) - BigInt(yocto)).toString();
    this.save();
    return clone(h);
  }

  async withdrawToken(tokenId: string, contract: string, receiver: string, amount: string, signer: string) {
    void receiver;
    await jitter(1300, 1800);
    this.openedForOwner(tokenId, signer);
    const h = this.held(tokenId);
    const entry = h.tokens.find((t) => t.contract === contract);
    if (!entry || BigInt(amount) <= 0n || BigInt(amount) > BigInt(entry.amount)) throw new VaultError("ERR_AMOUNT", "That's more than the vault holds.");
    entry.amount = (BigInt(entry.amount) - BigInt(amount)).toString();
    if (entry.amount === "0") {
      h.tokens = h.tokens.filter((t) => t !== entry);
      h.near = (BigInt(h.near) + MOCK_ENTRY_STORAGE).toString();
    }
    this.save();
    return clone(h);
  }

  async withdrawNft(tokenId: string, contract: string, nftTokenId: string, receiver: string, signer: string) {
    void receiver;
    await jitter(1300, 1800);
    this.openedForOwner(tokenId, signer);
    const h = this.held(tokenId);
    if (!h.nfts.some((n) => n.contract === contract && n.token_id === nftTokenId)) throw new VaultError("ERR_NOT_HELD", "The vault doesn't hold that NFT.");
    h.nfts = h.nfts.filter((n) => !(n.contract === contract && n.token_id === nftTokenId));
    h.near = (BigInt(h.near) + MOCK_ENTRY_STORAGE).toString();
    this.save();
    return clone(h);
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
