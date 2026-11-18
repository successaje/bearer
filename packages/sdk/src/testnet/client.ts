import type {
  AccountActivity,
  AccountEvent,
  AttackKind,
  AttackResult,
  BearerClient,
  ChainObservation,
  ChainTag,
  ContractConfig,
  EscrowEvent,
  Finish,
  HandoverSchedule,
  LendConfig,
  LoanTerms,
  MarketBalances,
  MarketConfig,
  MarketListing,
  RecordedAttack,
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
  WithdrawRequest,
  Withdrawal,
  WithdrawalParams,
  WithdrawalProgress,
} from "../types";

import { broadcastRaw, btcParams, chainStatus, chainTxId, evmParams, solParams, txExplorer } from "./chains";
import { BASE_SEPOLIA_CHAIN_ID, TESTNET_ENDPOINTS, type TestnetEndpoints } from "./config";
import { observeBtc, observeEvm, observeSol } from "./observe";
import { NearRpc, getJson, jsonRpc } from "./rpc";
import { custodyEvents, escrowEventsInLogs, mergeHistory, recordEvents, type LoggedOutcome } from "../activity";

const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;

export interface FunctionCall {
  methodName: string;
  args: object;
  gas: bigint;
  deposit: bigint;
}

/** What the adapter needs from a wallet: the signed-in account, and a way to send calls. */
export interface WalletAdapter {
  accountId(): string | null;
  /** Signs and sends one transaction holding these calls, in order; resolves once it executes. */
  send(receiverId: string, calls: FunctionCall[]): Promise<{ txHash: string; returnValue: unknown }>;
  /** Several transactions under one approval, where the wallet supports it; they run in order. */
  sendMany?(txs: { receiverId: string; calls: FunctionCall[] }[]): Promise<{ txHash: string; returnValue: unknown }[]>;
}

export interface TestnetClientOptions {
  contractId: string;
  /** The market contract (contracts/market) selling this contract's vaults, if any. */
  marketId?: string | null;
  /** The schedule contract (contracts/schedule) that hands this contract's vaults over on a date, if any. */
  scheduleId?: string | null;
  /** The lending contract (contracts/lend) that lends NEAR against this contract's vaults, if any. */
  lendId?: string | null;
  /** The switch contract (contracts/switch) that hands this contract's vaults on if their owner goes quiet, if any. */
  switchId?: string | null;
  /** The standing-payments contract (contracts/standing) that pays from this contract's vaults every period, if any. */
  standingId?: string | null;
  /** The names contract (contracts/names), and the TLA and House of Stake registry it rents from, if any. */
  namesId?: string | null;
  tlaId?: string | null;
  tlaRegistryId?: string | null;
  /** Attacks sent to this contract as real transactions; `runAttack` re-reads their outcome. */
  recordedAttacks?: RecordedAttack[];
  wallet: WalletAdapter;
  endpoints?: Partial<TestnetEndpoints>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How often an account's activity asks NearBlocks' rate-limited index again; the chain is read every time. */
const REINDEX_MS = 10 * 60_000;
/** A sale this recent whose payout the index hasn't listed yet is looked for again on the next read. */
const RECENT_SALE_MS = 15 * 60_000;

/** A payment from the market to an account, as NearBlocks lists it. */
type Payout = { tx: string; atMs: number; amount: string };

function addressOf(v: VaultView, chain: ChainTag) {
  const a = chain === "btc" ? v.btc_address : chain === "evm" ? v.evm_address : v.sol_address;
  if (!a) throw new Error("ERR_KEYS_PENDING: the signer's keys haven't arrived yet");
  return a;
}

const chainOf = (p: WithdrawalParams): ChainTag => p.chain;

/**
 * The live adapter: reads the Bearer contract and each chain over public RPCs, and sends NEAR
 * transactions through the connected wallet. Nothing goes through a Bearer server.
 */
export class TestnetBearerClient implements BearerClient {
  private readonly near: NearRpc;
  private readonly ep: TestnetEndpoints;
  private config: Promise<ContractConfig> | null = null;
  private marketCfg: Promise<MarketConfig> | null = null;
  private scheduleDeposit: Promise<string> | null = null;
  private lendCfg: Promise<LendConfig> | null = null;
  private switchCfg: Promise<SwitchConfig> | null = null;
  private standingCfg: Promise<StandingConfig> | null = null;

  constructor(private readonly opts: TestnetClientOptions) {
    this.ep = { ...TESTNET_ENDPOINTS, ...opts.endpoints };
    this.near = new NearRpc(this.ep.near);
  }

  private getConfig() {
    this.config ??= this.near.view<ContractConfig>(this.opts.contractId, "get_config");
    return this.config;
  }

  private signerFor(signer: string) {
    const connected = this.opts.wallet.accountId();
    if (!connected) throw new Error("Connect a NEAR wallet first.");
    if (connected !== signer) throw new Error(`The connected wallet is ${connected}, not ${signer}.`);
  }

  /* ---------- reads ---------- */

  async listVaults(owner: string) {
    const tokens = await this.near.view<{ token_id: string }[]>(this.opts.contractId, "nft_tokens_for_owner", {
      account_id: owner,
      from_index: "0",
      limit: 50,
    });
    const vaults = await Promise.all(tokens.map((t) => this.getVault(t.token_id)));
    return vaults.filter((v): v is VaultView => !!v).sort((a, b) => Number(BigInt(b.created_at_ns) - BigInt(a.created_at_ns)));
  }

  getVault(tokenId: string) {
    return this.near.view<VaultView | null>(this.opts.contractId, "vault", { token_id: tokenId });
  }

  getWithdrawals(tokenId: string) {
    return this.near.view<Withdrawal[]>(this.opts.contractId, "withdrawals", { token_id: tokenId, from_index: 0, limit: 50 });
  }

  async observe(vault: VaultView): Promise<ChainObservation[]> {
    if (!vault.btc_address || !vault.evm_address || !vault.sol_address) return [];
    return Promise.all([
      observeBtc(vault.btc_address, this.ep),
      observeEvm(vault.evm_address, this.ep),
      observeSol(vault.sol_address, this.ep),
    ]);
  }

  accountExists(accountId: string) {
    return this.near.accountExists(accountId);
  }

  /* ---------- writes, through the wallet ---------- */

  async createVault(input: { name?: string; finish: Finish }, signer: string) {
    this.signerFor(signer);
    const { create_deposit } = await this.getConfig();
    const { returnValue } = await this.opts.wallet.send(this.opts.contractId, [
      { methodName: "create_vault", args: { name: input.name?.trim() || null, finish: input.finish }, gas: 60n * TGAS, deposit: BigInt(create_deposit) },
    ]);
    const tokenId = String(returnValue);
    // The signer's derived keys land in a callback a few seconds later.
    for (let i = 0; i < 30; i++) {
      const v = await this.getVault(tokenId);
      if (v?.keys) return v;
      await sleep(1000);
    }
    const v = await this.getVault(tokenId);
    if (!v) throw new Error(`Vault ${tokenId} was created but can't be read yet.`);
    return v;
  }

  async transfer(tokenId: string, receiver: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.opts.contractId, [
      { methodName: "nft_transfer", args: { receiver_id: receiver, token_id: tokenId }, gas: 30n * TGAS, deposit: ONE_YOCTO },
    ]);
    return (await this.getVault(tokenId)) as VaultView;
  }

  async breakSeal(tokenId: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.opts.contractId, [{ methodName: "break_seal", args: { token_id: tokenId }, gas: 30n * TGAS, deposit: ONE_YOCTO }]);
    return (await this.getVault(tokenId)) as VaultView;
  }

  /** The contract call for one withdrawal: typed parameters, deposit and gas per brief 4.6. */
  private async withdrawCall(vault: VaultView, req: WithdrawRequest): Promise<FunctionCall> {
    const config = await this.getConfig();
    const each = BigInt(config.withdraw_deposit) + BigInt(config.mpc_sign_deposit);
    if (req.chain === "evm") {
      const params = await evmParams(addressOf(vault, "evm"), req.to, req.amountWei, this.ep);
      return { methodName: "withdraw_evm", args: { token_id: vault.token_id, params }, gas: 60n * TGAS, deposit: each };
    }
    if (req.chain === "btc") {
      const params = await btcParams(addressOf(vault, "btc"), req.to, req.amountSats, config.max_btc_inputs, this.ep);
      const n = BigInt(params.inputs.length);
      return { methodName: "withdraw_btc", args: { token_id: vault.token_id, params }, gas: (15n * n + 60n) * TGAS, deposit: each * n };
    }
    const params = await solParams(req.to, req.lamports, this.ep);
    return { methodName: "withdraw_sol", args: { token_id: vault.token_id, params }, gas: 50n * TGAS, deposit: each };
  }

  private async requested(tokenId: string, index: number) {
    const [w] = await this.near.view<Withdrawal[]>(this.opts.contractId, "withdrawals", { token_id: tokenId, from_index: index, limit: 1 });
    if (!w) throw new Error(`Withdrawal ${index} of vault ${tokenId} isn't visible yet.`);
    return w;
  }

  async withdraw(tokenId: string, request: WithdrawRequest, signer: string) {
    this.signerFor(signer);
    const vault = (await this.getVault(tokenId)) as VaultView;
    const call = await this.withdrawCall(vault, request);
    await this.opts.wallet.send(this.opts.contractId, [call]);
    return this.requested(tokenId, vault.withdrawal_count);
  }

  /** One NEAR transaction, two actions: if the withdrawal is invalid, the seal stays intact (brief 4.8). */
  async breakSealAndWithdraw(tokenId: string, first: WithdrawRequest, signer: string) {
    this.signerFor(signer);
    const vault = (await this.getVault(tokenId)) as VaultView;
    const call = await this.withdrawCall(vault, first);
    await this.opts.wallet.send(this.opts.contractId, [
      { methodName: "break_seal", args: { token_id: tokenId }, gas: 30n * TGAS, deposit: ONE_YOCTO },
      call,
    ]);
    return this.requested(tokenId, vault.withdrawal_count);
  }

  /* ---------- after signing ---------- */

  /** Read-only: where the withdrawal stands on NEAR and then on its own chain. Never broadcasts. */
  async trackWithdrawal(tokenId: string, index: number): Promise<WithdrawalProgress> {
    const w = await this.requested(tokenId, index);
    const base = { tokenId, index, chainTxHash: null, explorerUrl: null, error: w.error };
    if (w.status === "pending") return { ...base, stage: "signing" };
    if (w.status === "failed" || !w.signed_raw_tx) return { ...base, stage: "failed" };
    const chain = chainOf(w.params);
    const txId = chainTxId(chain, w.signed_raw_tx);
    let status = await chainStatus(chain, txId, w.signed_raw_tx, this.ep);
    // A Base transaction whose nonce another transaction has used can never land.
    if (status.stage === "broadcasting" && w.params.chain === "evm") {
      const vault = (await this.getVault(tokenId)) as VaultView;
      const used = BigInt(await jsonRpc<string>(this.ep.evm, "eth_getTransactionCount", [addressOf(vault, "evm"), "latest"]));
      if (used > BigInt(w.params.nonce)) {
        status = { stage: "failed", error: `Nonce ${w.params.nonce} was already used by another transaction, so this one can't land.` };
      }
    }
    return { ...base, stage: status.stage, chainTxHash: txId, explorerUrl: txExplorer(chain, txId), error: status.error ?? w.error };
  }

  /** Sends a signed withdrawal to its chain. Anyone may do this; the money only goes where the owner chose. */
  async broadcast(tokenId: string, index: number): Promise<WithdrawalProgress> {
    const w = await this.requested(tokenId, index);
    if (!w.signed_raw_tx) throw new Error("This withdrawal isn't signed yet.");
    await broadcastRaw(chainOf(w.params), w.signed_raw_tx, this.ep);
    return this.trackWithdrawal(tokenId, index);
  }

  /* ---------- scheduled handover: escrow until a date (contracts/schedule) ---------- */

  get scheduleId() {
    return this.opts.scheduleId ?? null;
  }

  private scheduler() {
    if (!this.opts.scheduleId) throw new Error("This deployment has no scheduled handover.");
    return this.opts.scheduleId;
  }

  async schedules() {
    if (!this.opts.scheduleId) return [];
    return this.near.view<HandoverSchedule[]>(this.opts.scheduleId, "schedules", { from_index: 0, limit: 100 });
  }

  async getSchedule(tokenId: string) {
    if (!this.opts.scheduleId) return null;
    return this.near.view<HandoverSchedule | null>(this.opts.scheduleId, "schedule", { token_id: tokenId });
  }

  async scheduleHandover(tokenId: string, recipient: string, releaseAtMs: number, cancellable: boolean, signer: string) {
    this.signerFor(signer);
    const scheduler = this.scheduler();
    this.scheduleDeposit ??= this.near.view<{ schedule_deposit: string }>(scheduler, "get_config").then((c) => c.schedule_deposit);
    const [deposit, balance] = await Promise.all([this.scheduleDeposit, this.near.view<string>(scheduler, "deposit_of", { account_id: signer })]);
    const releaseAtNs = (BigInt(Math.floor(releaseAtMs)) * 1_000_000n).toString();
    // nft_transfer_call forwards only 1 yoctoNEAR, so the schedule deposit is paid first.
    const send = {
      receiverId: this.opts.contractId,
      calls: [
        {
          methodName: "nft_transfer_call",
          args: { receiver_id: scheduler, token_id: tokenId, msg: JSON.stringify({ recipient, release_at_ns: releaseAtNs, cancellable }) },
          gas: 100n * TGAS,
          deposit: ONE_YOCTO,
        },
      ],
    };
    const pay = { receiverId: scheduler, calls: [{ methodName: "deposit_for_schedule", args: {}, gas: 30n * TGAS, deposit: BigInt(deposit) }] };
    const results = await this.sendAll(BigInt(balance) >= BigInt(deposit) ? [send] : [pay, send]);
    if (results.at(-1)?.returnValue === false) {
      throw new Error("The schedule sent the vault back: the date must be at least a minute away, and the recipient can't be you.");
    }
    for (let i = 0; i < 20; i++) {
      const s = await this.getSchedule(tokenId);
      if (s) return s;
      await sleep(1000);
    }
    throw new Error("The vault was sent, but its schedule hasn't appeared yet. Check the vault page in a moment.");
  }

  async releaseHandover(tokenId: string, signer: string) {
    this.signerFor(signer);
    const s = await this.getSchedule(tokenId);
    if (!s) throw new Error("This vault isn't scheduled.");
    await this.opts.wallet.send(this.scheduler(), [{ methodName: "release", args: { token_id: tokenId }, gas: 100n * TGAS, deposit: 0n }]);
    // The schedule checks the recipient's account first, then moves the vault.
    for (let i = 0; i < 20; i++) {
      const vault = await this.getVault(tokenId);
      if (vault?.owner_id === s.recipient) return vault;
      const now = await this.getSchedule(tokenId);
      if (i > 2 && now?.state.kind === "waiting") {
        throw new Error(`${s.recipient} doesn't exist on NEAR yet, so the vault stays scheduled until it does.`);
      }
      await sleep(1000);
    }
    throw new Error("The handover hasn't settled yet. Check the vault page in a moment.");
  }

  async cancelHandover(tokenId: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.scheduler(), [{ methodName: "cancel", args: { token_id: tokenId }, gas: 80n * TGAS, deposit: ONE_YOCTO }]);
    for (let i = 0; i < 20; i++) {
      const vault = await this.getVault(tokenId);
      if (vault?.owner_id === signer) return vault;
      await sleep(1000);
    }
    throw new Error("The vault hasn't come back yet. Check the vault page in a moment.");
  }

  /* ---------- borrowing against a vault: escrow until repaid or foreclosed (contracts/lend) ---------- */

  get lendId() {
    return this.opts.lendId ?? null;
  }

  private lender() {
    if (!this.opts.lendId) throw new Error("This deployment has no lending contract.");
    return this.opts.lendId;
  }

  async loans() {
    if (!this.opts.lendId) return [];
    return this.near.view<VaultLoan[]>(this.opts.lendId, "loans", { from_index: 0, limit: 100 });
  }

  async getLoan(tokenId: string) {
    if (!this.opts.lendId) return null;
    return this.near.view<VaultLoan | null>(this.opts.lendId, "loan", { token_id: tokenId });
  }

  lendConfig() {
    this.lendCfg ??= this.near.view<LendConfig>(this.lender(), "get_config");
    return this.lendCfg;
  }

  async requestLoan(tokenId: string, terms: LoanTerms, signer: string) {
    this.signerFor(signer);
    const lend = this.lender();
    const [{ loan_deposit }, balance] = await Promise.all([this.lendConfig(), this.near.view<string>(lend, "deposit_of", { account_id: signer })]);
    const msg = {
      principal: terms.principalYocto,
      repayment: terms.repaymentYocto,
      term_ns: (BigInt(Math.floor(terms.termMs)) * 1_000_000n).toString(),
    };
    // nft_transfer_call forwards only 1 yoctoNEAR, so the loan deposit is paid first.
    const send = {
      receiverId: this.opts.contractId,
      calls: [{ methodName: "nft_transfer_call", args: { receiver_id: lend, token_id: tokenId, msg: JSON.stringify(msg) }, gas: 100n * TGAS, deposit: ONE_YOCTO }],
    };
    const pay = { receiverId: lend, calls: [{ methodName: "deposit_for_loan", args: {}, gas: 30n * TGAS, deposit: BigInt(loan_deposit) }] };
    const results = await this.sendAll(BigInt(balance) >= BigInt(loan_deposit) ? [send] : [pay, send]);
    if (results.at(-1)?.returnValue === false) {
      throw new Error("The lending contract sent the vault back: check the amounts and the term, and that the vault is still sealed.");
    }
    for (let i = 0; i < 20; i++) {
      const l = await this.getLoan(tokenId);
      if (l) return l;
      await sleep(1000);
    }
    throw new Error("The vault was sent, but its loan request hasn't appeared yet. Check the vault page in a moment.");
  }

  async fundLoan(loan: VaultLoan, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.lender(), [
      {
        methodName: "fund",
        args: { token_id: loan.token_id, repayment: loan.repayment, term_ns: loan.term_ns },
        gas: 50n * TGAS,
        deposit: BigInt(loan.principal),
      },
    ]);
    const l = await this.getLoan(loan.token_id);
    if (!l || l.state.kind === "requested") throw new Error("The loan hasn't shown as funded yet. Check the vault page in a moment.");
    return l;
  }

  /** Repay, foreclose and cancel all end with the vault moving; this waits for it to arrive. */
  private async vaultReaches(tokenId: string, owner: string, slow: string) {
    for (let i = 0; i < 20; i++) {
      const vault = await this.getVault(tokenId);
      if (vault?.owner_id === owner) return vault;
      await sleep(1000);
    }
    throw new Error(slow);
  }

  async repayLoan(tokenId: string, signer: string) {
    this.signerFor(signer);
    const l = await this.getLoan(tokenId);
    if (!l) throw new Error("This vault isn't pledged.");
    await this.opts.wallet.send(this.lender(), [{ methodName: "repay", args: { token_id: tokenId }, gas: 100n * TGAS, deposit: BigInt(l.repayment) }]);
    return this.vaultReaches(tokenId, signer, "The repayment went through, but the vault hasn't come back yet. Check the vault page in a moment.");
  }

  async forecloseLoan(tokenId: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.lender(), [{ methodName: "foreclose", args: { token_id: tokenId }, gas: 100n * TGAS, deposit: ONE_YOCTO }]);
    return this.vaultReaches(tokenId, signer, "The vault hasn't arrived yet. Check the vault page in a moment.");
  }

  async cancelLoanRequest(tokenId: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.lender(), [{ methodName: "cancel_request", args: { token_id: tokenId }, gas: 100n * TGAS, deposit: ONE_YOCTO }]);
    return this.vaultReaches(tokenId, signer, "The vault hasn't come back yet. Check the vault page in a moment.");
  }

  /* ---------- a dead man's switch: escrow until the owner goes quiet (contracts/switch) ---------- */

  get switchId() {
    return this.opts.switchId ?? null;
  }

  private switcher() {
    if (!this.opts.switchId) throw new Error("This deployment has no switch contract.");
    return this.opts.switchId;
  }

  async switches() {
    if (!this.opts.switchId) return [];
    return this.near.view<VaultSwitch[]>(this.opts.switchId, "switches", { from_index: 0, limit: 100 });
  }

  async getSwitch(tokenId: string) {
    if (!this.opts.switchId) return null;
    return this.near.view<VaultSwitch | null>(this.opts.switchId, "switch_for", { token_id: tokenId });
  }

  switchConfig() {
    this.switchCfg ??= this.near.view<SwitchConfig>(this.switcher(), "get_config");
    return this.switchCfg;
  }

  async armSwitch(tokenId: string, beneficiary: string, intervalMs: number, signer: string) {
    this.signerFor(signer);
    const sw = this.switcher();
    const [{ switch_deposit }, balance] = await Promise.all([this.switchConfig(), this.near.view<string>(sw, "deposit_of", { account_id: signer })]);
    const msg = { beneficiary, interval_ns: (BigInt(Math.floor(intervalMs)) * 1_000_000n).toString() };
    // nft_transfer_call forwards only 1 yoctoNEAR, so the switch deposit is paid first.
    const send = {
      receiverId: this.opts.contractId,
      calls: [{ methodName: "nft_transfer_call", args: { receiver_id: sw, token_id: tokenId, msg: JSON.stringify(msg) }, gas: 100n * TGAS, deposit: ONE_YOCTO }],
    };
    const pay = { receiverId: sw, calls: [{ methodName: "deposit_for_switch", args: {}, gas: 30n * TGAS, deposit: BigInt(switch_deposit) }] };
    const results = await this.sendAll(BigInt(balance) >= BigInt(switch_deposit) ? [send] : [pay, send]);
    if (results.at(-1)?.returnValue === false) {
      throw new Error("The switch sent the vault back: check the beneficiary and the interval, and that the vault is still sealed.");
    }
    for (let i = 0; i < 20; i++) {
      const s = await this.getSwitch(tokenId);
      if (s) return s;
      await sleep(1000);
    }
    throw new Error("The vault was sent, but its switch hasn't appeared yet. Check the vault page in a moment.");
  }

  async checkIn(tokenId: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.switcher(), [{ methodName: "check_in", args: { token_id: tokenId }, gas: 30n * TGAS, deposit: ONE_YOCTO }]);
    const s = await this.getSwitch(tokenId);
    if (!s) throw new Error("This vault isn't in a switch any more.");
    return s;
  }

  async updateSwitch(tokenId: string, changes: { beneficiary?: string; intervalMs?: number }, signer: string) {
    this.signerFor(signer);
    const args = {
      token_id: tokenId,
      beneficiary: changes.beneficiary ?? null,
      interval_ns: changes.intervalMs === undefined ? null : (BigInt(Math.floor(changes.intervalMs)) * 1_000_000n).toString(),
    };
    await this.opts.wallet.send(this.switcher(), [{ methodName: "update", args, gas: 30n * TGAS, deposit: ONE_YOCTO }]);
    const s = await this.getSwitch(tokenId);
    if (!s) throw new Error("This vault isn't in a switch any more.");
    return s;
  }

  async takeBackSwitch(tokenId: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.switcher(), [{ methodName: "take_back", args: { token_id: tokenId }, gas: 100n * TGAS, deposit: ONE_YOCTO }]);
    return this.vaultReaches(tokenId, signer, "The vault hasn't come back yet. Check the vault page in a moment.");
  }

  async releaseSwitch(tokenId: string, signer: string) {
    this.signerFor(signer);
    const s = await this.getSwitch(tokenId);
    if (!s) throw new Error("This vault isn't in a switch.");
    await this.opts.wallet.send(this.switcher(), [{ methodName: "release", args: { token_id: tokenId }, gas: 150n * TGAS, deposit: 0n }]);
    for (let i = 0; i < 20; i++) {
      const vault = await this.getVault(tokenId);
      if (vault?.owner_id === s.beneficiary) return vault;
      // A beneficiary account that doesn't exist puts the switch back as it was (D7).
      const now = await this.getSwitch(tokenId);
      if (now?.state.kind === "armed") throw new Error(`${s.beneficiary} doesn't exist on NEAR, so the vault stays in the switch.`);
      await sleep(1000);
    }
    throw new Error("The hand-over went through, but the vault hasn't arrived yet. Check the vault page in a moment.");
  }

  /* ---------- standing payments: a vault that pays every period (contracts/standing) ---------- */

  get standingId() {
    return this.opts.standingId ?? null;
  }

  private stander() {
    if (!this.opts.standingId) throw new Error("This deployment has no standing payments.");
    return this.opts.standingId;
  }

  async standingPlans() {
    if (!this.opts.standingId) return [];
    return this.near.view<StandingPlan[]>(this.opts.standingId, "plans", { from_index: 0, limit: 100 });
  }

  async getStandingPlan(tokenId: string) {
    if (!this.opts.standingId) return null;
    return this.near.view<StandingPlan | null>(this.opts.standingId, "plan", { token_id: tokenId });
  }

  standingConfig() {
    this.standingCfg ??= this.near.view<StandingConfig>(this.stander(), "get_config");
    return this.standingCfg;
  }

  async planPayments(tokenId: string, terms: StandingTerms, signer: string) {
    this.signerFor(signer);
    const sp = this.stander();
    const [{ plan_deposit }, balance] = await Promise.all([this.standingConfig(), this.near.view<string>(sp, "deposit_of", { account_id: signer })]);
    const msg = {
      payee: terms.payee,
      chain: terms.chain,
      to: terms.to,
      chain_id: terms.chain === "evm" ? String(BASE_SEPOLIA_CHAIN_ID) : null,
      amount: terms.amount,
      max_fee: terms.chain === "sol" ? "0" : terms.maxFee,
      interval_ns: (BigInt(Math.floor(terms.intervalMs)) * 1_000_000n).toString(),
      first_due_ns: (BigInt(Math.floor(terms.firstDueMs)) * 1_000_000n).toString(),
      max_payments: terms.maxPayments,
      cancellable: terms.cancellable,
    };
    // nft_transfer_call forwards only 1 yoctoNEAR, so the plan deposit is paid first.
    const send = {
      receiverId: this.opts.contractId,
      calls: [{ methodName: "nft_transfer_call", args: { receiver_id: sp, token_id: tokenId, msg: JSON.stringify(msg) }, gas: 100n * TGAS, deposit: ONE_YOCTO }],
    };
    const pay = { receiverId: sp, calls: [{ methodName: "deposit_for_plan", args: {}, gas: 30n * TGAS, deposit: BigInt(plan_deposit) }] };
    const results = await this.sendAll(BigInt(balance) >= BigInt(plan_deposit) ? [send] : [pay, send]);
    if (results.at(-1)?.returnValue === false) {
      throw new Error("The plan sent the vault back: check the payee, the address and the amounts, and that the vault is still sealed.");
    }
    for (let i = 0; i < 20; i++) {
      const p = await this.getStandingPlan(tokenId);
      if (p) return p;
      await sleep(1000);
    }
    throw new Error("The vault was sent, but its plan hasn't appeared yet. Check the vault page in a moment.");
  }

  /** Waits for the request in flight to settle, then returns Bearer's record at `index`. */
  private async settledRequest(tokenId: string, index: number) {
    for (let i = 0; i < 30; i++) {
      const p = await this.getStandingPlan(tokenId);
      if (p?.state.kind === "unsettled") {
        throw new Error("ERR_UNSETTLED: Bearer's answer couldn't be read back yet. Anyone can ask the plan to check again (recheck); nothing is lost meanwhile.");
      }
      if (!p || p.state.kind === "waiting") {
        if (p && p.withdrawals <= index) {
          throw new Error("ERR_REFUSED: Bearer refused this request, so nothing was signed and the deposit went back. Try again in a moment.");
        }
        return this.requested(tokenId, index);
      }
      await sleep(1000);
    }
    throw new Error("The request was sent, but it hasn't settled yet. Check the vault page in a moment.");
  }

  async collectPayment(tokenId: string, signer: string) {
    this.signerFor(signer);
    const sp = this.stander();
    const [plan, vault, config, cfg] = await Promise.all([this.getStandingPlan(tokenId), this.getVault(tokenId), this.getConfig(), this.standingConfig()]);
    if (!plan || !vault) throw new Error("This vault has no standing payments.");
    const each = BigInt(config.withdraw_deposit) + BigInt(config.mpc_sign_deposit);
    const cap = BigInt(plan.max_fee);
    let params: Record<string, unknown>;
    let signatures = 1n;
    if (plan.chain === "btc") {
      const p = await btcParams(addressOf(vault, "btc"), plan.to, plan.amount, Math.min(config.max_btc_inputs, cfg.max_btc_inputs), this.ep);
      // A fee over the giver's cap is cut to the cap: slower to confirm, never refused.
      const fee = BigInt(p.fee_sat) > cap ? cap : BigInt(p.fee_sat);
      params = { chain: "btc", inputs: p.inputs, fee_sat: fee.toString() };
      signatures = BigInt(p.inputs.length);
    } else if (plan.chain === "evm") {
      const p = await evmParams(addressOf(vault, "evm"), plan.to, plan.amount, this.ep);
      const gas = BigInt(p.gas_limit);
      let maxFee = BigInt(p.max_fee_per_gas);
      if (gas * maxFee > cap) maxFee = cap / gas;
      const priority = BigInt(p.max_priority_fee_per_gas) > maxFee ? maxFee : BigInt(p.max_priority_fee_per_gas);
      params = { chain: "evm", nonce: p.nonce, gas_limit: p.gas_limit, max_fee_per_gas: maxFee.toString(), max_priority_fee_per_gas: priority.toString() };
    } else {
      const p = await solParams(plan.to, plan.amount, this.ep);
      params = { chain: "sol", recent_blockhash: p.recent_blockhash };
    }
    // One yoctoNEAR more breaks the seal before the first payment, in the same receipt.
    const deposit = each * signatures + (plan.opened ? 0n : ONE_YOCTO);
    await this.opts.wallet.send(sp, [{ methodName: "collect", args: { token_id: tokenId, params }, gas: 300n * TGAS, deposit }]);
    return this.settledRequest(tokenId, plan.withdrawals);
  }

  async stopPayments(tokenId: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.stander(), [{ methodName: "stop", args: { token_id: tokenId }, gas: 30n * TGAS, deposit: ONE_YOCTO }]);
    const p = await this.getStandingPlan(tokenId);
    if (!p) throw new Error("This vault has no standing payments any more.");
    return p;
  }

  async takeBackPlanned(tokenId: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.stander(), [{ methodName: "take_back", args: { token_id: tokenId }, gas: 100n * TGAS, deposit: ONE_YOCTO }]);
    return this.vaultReaches(tokenId, signer, "The vault hasn't come back yet. Check the vault page in a moment.");
  }

  async withdrawThroughPlan(tokenId: string, request: WithdrawRequest, signer: string) {
    this.signerFor(signer);
    const [plan, vault] = await Promise.all([this.getStandingPlan(tokenId), this.getVault(tokenId)]);
    if (!plan || !vault) throw new Error("This vault has no standing payments.");
    const call = await this.withdrawCall(vault, request);
    const { params } = call.args as { params: Record<string, unknown> };
    await this.opts.wallet.send(this.stander(), [
      { methodName: "withdraw", args: { token_id: tokenId, params: { chain: request.chain, ...params } }, gas: 300n * TGAS, deposit: call.deposit },
    ]);
    return this.settledRequest(tokenId, plan.withdrawals);
  }

  /* ---------- vault names: a TLA name per vault (contracts/names) ---------- */

  get namesId() {
    return this.opts.namesId ?? null;
  }

  get tlaId() {
    return this.opts.tlaId ?? null;
  }

  private naming() {
    const { namesId, tlaId, tlaRegistryId } = this.opts;
    if (!namesId || !tlaId || !tlaRegistryId) throw new Error("This deployment has no vault names.");
    return { names: namesId, tla: tlaId, registry: tlaRegistryId };
  }

  async getVaultName(tokenId: string): Promise<VaultName | null> {
    if (!this.opts.namesId || !this.opts.tlaId || !this.opts.tlaRegistryId) return null;
    const { names, tla, registry } = this.naming();
    const accountId = await this.near.view<string | null>(names, "name_of", { token_id: tokenId });
    if (!accountId) return null;
    const label = accountId.slice(0, -(tla.length + 1));
    type Lease = { owner: string; expires_at: string; lifecycle: string } | null;
    const [account, lease] = await Promise.all([
      jsonRpc<{ amount: string }>(this.ep.near, "query", { request_type: "view_account", finality: "final", account_id: accountId }),
      this.near.view<Lease>(registry, "get_sub_account", { tla_id: tla, name: label }),
    ]);
    const held = lease?.owner === names;
    return { token_id: tokenId, account_id: accountId, balance: account.amount, expires_at_ns: held ? lease.expires_at : null, lifecycle: held ? lease.lifecycle : null, held };
  }

  async namePrice(label: string) {
    const { tla, registry } = this.naming();
    const [price, available] = await Promise.all([
      this.near.view<{ rent_yocto: string; creation_deposit_yocto: string; total_yocto: string }>(registry, "get_rent_price", { tla_id: tla, name: label }),
      this.near.view<boolean>(registry, "is_name_available", { tla_id: tla, name: label }),
    ]);
    return { rent: price.rent_yocto, deposit: price.creation_deposit_yocto, total: price.total_yocto, available } satisfies NamePrice & { available: boolean };
  }

  async nameVault(tokenId: string, label: string, signer: string) {
    this.signerFor(signer);
    const { names } = this.naming();
    const price = await this.namePrice(label);
    if (!price.available) throw new Error(`ERR_NAME_TAKEN: ${label}.${this.opts.tlaId} is already rented.`);
    await this.opts.wallet.send(names, [{ methodName: "name_vault", args: { token_id: tokenId, label }, gas: 240n * TGAS, deposit: BigInt(price.total) }]);
    for (let i = 0; i < 20; i++) {
      const n = await this.getVaultName(tokenId);
      if (n) return n;
      const pending = await this.near.view<unknown>(names, "pending_of", { token_id: tokenId });
      if (!pending && i > 1) throw new Error("ERR_NAMING_REFUSED: the name wasn't rented, and your deposit went back.");
      await sleep(1000);
    }
    throw new Error("The name was asked for, but it hasn't appeared yet. Check the vault page in a moment.");
  }

  async withdrawFromName(tokenId: string, receiver: string, amountYocto: string, signer: string) {
    this.signerFor(signer);
    const { names } = this.naming();
    const before = await this.getVaultName(tokenId);
    if (!before) throw new Error("ERR_NOT_NAMED: this vault has no name.");
    await this.opts.wallet.send(names, [{ methodName: "withdraw", args: { token_id: tokenId, receiver_id: receiver, amount: amountYocto }, gas: 100n * TGAS, deposit: ONE_YOCTO }]);
    for (let i = 0; i < 10; i++) {
      await sleep(1500);
      const after = await this.getVaultName(tokenId);
      if (after && BigInt(after.balance) < BigInt(before.balance)) return after;
    }
    throw new Error("ERR_WITHDRAWAL_REFUSED: nothing left the name. Only the holder of the opened vault can take NEAR out, leaving what the account needs for storage.");
  }

  async renewName(tokenId: string, signer: string) {
    this.signerFor(signer);
    const { tla, registry } = this.naming();
    const name = await this.getVaultName(tokenId);
    if (!name) throw new Error("ERR_NOT_NAMED: this vault has no name.");
    const label = name.account_id.slice(0, -(tla.length + 1));
    const { rent } = await this.namePrice(label);
    // The quote includes slippage; the registry refunds whatever the rent didn't need.
    await this.opts.wallet.send(registry, [{ methodName: "renew_sub_account", args: { tla_id: tla, name: label }, gas: 100n * TGAS, deposit: BigInt(rent) }]);
    return (await this.getVaultName(tokenId)) as VaultName;
  }

  /* ---------- the market: escrow by transfer (docs/features/market.md) ---------- */

  get marketId() {
    return this.opts.marketId ?? null;
  }

  private market() {
    if (!this.opts.marketId) throw new Error("This deployment has no market.");
    return this.opts.marketId;
  }

  async listings() {
    if (!this.opts.marketId) return [];
    return this.near.view<MarketListing[]>(this.opts.marketId, "listings", { from_index: 0, limit: 100 });
  }

  async getListing(tokenId: string) {
    if (!this.opts.marketId) return null;
    return this.near.view<MarketListing | null>(this.opts.marketId, "listing", { token_id: tokenId });
  }

  marketConfig() {
    this.marketCfg ??= this.near.view<MarketConfig>(this.market(), "get_config");
    return this.marketCfg;
  }

  private async sendAll(txs: { receiverId: string; calls: FunctionCall[] }[]) {
    if (txs.length > 1 && this.opts.wallet.sendMany) return this.opts.wallet.sendMany(txs);
    const out = [];
    for (const t of txs) out.push(await this.opts.wallet.send(t.receiverId, t.calls));
    return out;
  }

  async listVault(tokenId: string, priceYocto: string, signer: string) {
    this.signerFor(signer);
    const market = this.market();
    const [{ listing_deposit, min_price }, balance] = await Promise.all([
      this.marketConfig(),
      this.near.view<string>(market, "deposit_of", { account_id: signer }),
    ]);
    if (BigInt(priceYocto) < BigInt(min_price)) throw new Error("ERR_PRICE: the price is below the market's minimum.");
    // nft_transfer_call forwards only 1 yoctoNEAR, so the listing deposit is paid to the market first.
    const send = {
      receiverId: this.opts.contractId,
      calls: [
        {
          methodName: "nft_transfer_call",
          args: { receiver_id: market, token_id: tokenId, msg: JSON.stringify({ price: priceYocto }) },
          gas: 100n * TGAS,
          deposit: ONE_YOCTO,
        },
      ],
    };
    const deposit = { receiverId: market, calls: [{ methodName: "deposit_for_listing", args: {}, gas: 30n * TGAS, deposit: BigInt(listing_deposit) }] };
    const results = await this.sendAll(BigInt(balance) >= BigInt(listing_deposit) ? [send] : [deposit, send]);
    // Bearer's transfer returns `false` when the market refused the listing and sent the vault back.
    if (results.at(-1)?.returnValue === false) throw new Error("The market sent the vault back, so it isn't listed.");
    for (let i = 0; i < 20; i++) {
      const listing = await this.getListing(tokenId);
      if (listing) return listing;
      await sleep(1000);
    }
    throw new Error("The vault was sent, but its listing hasn't appeared yet. Check the market in a moment.");
  }

  async buyVault(tokenId: string, priceYocto: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.market(), [{ methodName: "buy", args: { token_id: tokenId }, gas: 100n * TGAS, deposit: BigInt(priceYocto) }]);
    // Settlement takes a few receipts: the vault moves to the buyer, then the seller is paid.
    for (let i = 0; i < 20; i++) {
      const vault = await this.getVault(tokenId);
      if (vault?.owner_id === signer) return vault;
      const listing = await this.getListing(tokenId);
      if (listing?.state.kind === "listed") throw new Error("The vault didn't move, so your payment was refunded. The listing stands.");
      await sleep(1000);
    }
    throw new Error("The sale hasn't settled yet. Check the vault page in a moment.");
  }

  async delistVault(tokenId: string, signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.market(), [{ methodName: "delist", args: { token_id: tokenId }, gas: 100n * TGAS, deposit: ONE_YOCTO }]);
    for (let i = 0; i < 20; i++) {
      const vault = await this.getVault(tokenId);
      if (vault?.owner_id === signer) return vault;
      await sleep(1000);
    }
    throw new Error("The vault hasn't come back yet. Check the vault page in a moment.");
  }

  async marketBalances(accountId: string): Promise<MarketBalances> {
    const market = this.market();
    const [claimable, deposit] = await Promise.all([
      this.near.view<string>(market, "claimable_of", { account_id: accountId }, "final"),
      this.near.view<string>(market, "deposit_of", { account_id: accountId }, "final"),
    ]);
    return { claimable, deposit };
  }

  async claimPayout(signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.market(), [{ methodName: "claim", args: {}, gas: 50n * TGAS, deposit: ONE_YOCTO }]);
    return this.marketBalances(signer);
  }

  async withdrawListingDeposit(signer: string) {
    this.signerFor(signer);
    await this.opts.wallet.send(this.market(), [{ methodName: "withdraw_deposit", args: {}, gas: 50n * TGAS, deposit: ONE_YOCTO }]);
    return this.marketBalances(signer);
  }

  /** Transactions never change, so each is read once, from an archival node. */
  private txCache = new Map<string, Promise<{ method: string | null; deposit: string }>>();

  private txCall(hash: string, signer: string) {
    let hit = this.txCache.get(hash);
    if (!hit) {
      type Tx = { transaction: { actions: ({ FunctionCall?: { method_name: string; deposit: string } } | string)[] } };
      hit = jsonRpc<Tx>(this.ep.nearArchival, "tx", { tx_hash: hash, sender_account_id: signer, wait_until: "NONE" }).then((r) => {
        const call = r.transaction.actions.map((a) => (typeof a === "string" ? undefined : a.FunctionCall)).find(Boolean);
        return { method: call?.method_name ?? null, deposit: call?.deposit ?? "0" };
      });
      hit.catch(() => this.txCache.delete(hash));
      this.txCache.set(hash, hit);
    }
    return hit;
  }

  /** What the index told us about each account, kept between reads so it's asked rarely. */
  private activityIndex = new Map<string, { ids: Set<string>; indexedAt: number; payouts: Map<string, Payout> }>();

  /**
   * Bearer vaults that minted to or moved through the account, newest first, from NearBlocks'
   * index. Each page of 25 costs one credit of its rate limit; a next page is read only while
   * they come back full. Throws if the index refuses.
   */
  private async accountVaultIds(accountId: string, pages: number) {
    type Move = { contract_account_id: string; token_id: string };
    type Page = { data?: Move[]; meta?: { next_page?: string | null } };
    const base = `${this.ep.nearblocks}/accounts/${encodeURIComponent(accountId)}/nft-txns?contract=${encodeURIComponent(this.opts.contractId)}`;
    const ids: string[] = [];
    let next: string | null = null;
    for (let i = 0; i < pages; i++) {
      const url: string = next ? `${base}&next=${encodeURIComponent(next)}` : base;
      const r: Page | null = await getJson<Page>(url);
      if (!r) break; // No history at all.
      if (!r.data) throw new Error("NearBlocks' index didn't answer");
      for (const m of r.data) if (m.contract_account_id === this.opts.contractId) ids.push(m.token_id);
      next = r.data.length >= 25 ? (r.meta?.next_page ?? null) : null;
      if (!next) break;
    }
    return ids;
  }

  /** The market's latest 25 payments to the account (one credit): sale payouts, and deposits back. */
  private async marketPayouts(accountId: string, market: string): Promise<Payout[]> {
    type Receipt = { predecessor_account_id: string; transaction_hash: string; actions: { action: string }[]; actions_agg: { deposit: string }; block: { block_timestamp: string } };
    const url = `${this.ep.nearblocks}/accounts/${encodeURIComponent(accountId)}/receipts?predecessor=${encodeURIComponent(market)}`;
    const r = await getJson<{ data?: Receipt[] }>(url);
    return (r?.data ?? [])
      .filter((x) => x.predecessor_account_id === market && x.actions.some((a) => a.action === "TRANSFER"))
      .map((x) => ({ tx: x.transaction_hash, atMs: Number(BigInt(x.block.block_timestamp) / 1_000_000n), amount: x.actions_agg.deposit }));
  }

  /**
   * What happened to each vault the account has held is read from its custody log on-chain, every
   * time. Which vaults those are comes from the ones it holds now, the ones seen before, and
   * NearBlocks' index. The index is rate-limited, so it's asked on the first read and then every
   * 10 minutes; a vault that leaves the account in between is still read, since it was seen here.
   * A sale's payout is the market's transfer to the seller, and its price is what the buyer
   * attached to that transaction, read from an archival node. Payouts are asked for only while a
   * sale's is missing: on the next read for a sale in the last 15 minutes (the index takes a
   * moment to catch up), with the 10-minute read for older ones. Throws if the index can't be
   * read the first time, so callers keep what they had.
   */
  async accountActivity(accountId: string): Promise<AccountActivity> {
    const market = this.opts.marketId ?? null;
    const known = this.activityIndex.get(accountId);
    const index = known ?? { ids: new Set<string>(), indexedAt: 0, payouts: new Map<string, Payout>() };
    const due = Date.now() - index.indexedAt >= REINDEX_MS;
    let partial = false;
    const [found, owned, schedules] = await Promise.all([
      // The whole history the first time; after that, anything new is on the newest page.
      due
        ? this.accountVaultIds(accountId, known ? 1 : 4).catch((e: unknown) => {
            if (!known) throw e;
            partial = true;
            return null;
          })
        : null,
      this.listVaults(accountId),
      this.opts.scheduleId ? this.schedules() : Promise.resolve([] as HandoverSchedule[]),
    ]);
    if (found) {
      for (const id of found) index.ids.add(id);
      index.indexedAt = Date.now();
    }
    for (const v of owned) index.ids.add(v.token_id);
    this.activityIndex.set(accountId, index);

    const vaults = await Promise.all([...index.ids].map((id) => this.getVault(id)));
    const events = vaults.flatMap((v) => (v ? custodyEvents(v, accountId, market, this.opts.scheduleId ?? null, this.opts.lendId ?? null, this.opts.switchId ?? null, this.opts.standingId ?? null) : []));

    // Match each sale to the market's payment to the seller, made in the same transaction a moment after the vault moved.
    const payoutFor = (e: AccountEvent) => [...index.payouts.values()].find((x) => x.atMs >= e.atMs - 5_000 && x.atMs <= e.atMs + 60_000);
    const sold = events.filter((e) => e.kind === "sold");
    if (market && sold.some((e) => !payoutFor(e) && (due || Date.now() - e.atMs < RECENT_SALE_MS))) {
      try {
        for (const p of await this.marketPayouts(accountId, market)) index.payouts.set(p.tx, p);
      } catch {
        partial = true;
      }
    }
    await Promise.all(
      sold.map(async (e) => {
        const p = payoutFor(e);
        if (!p) return;
        const tx = e.counterparty ? await this.txCall(p.tx, e.counterparty).catch(() => null) : null;
        e.paidYocto = p.amount;
        e.tx = p.tx;
        e.priceYocto = tx?.method === "buy" ? tx.deposit : null;
      }),
    );
    for (const s of schedules) {
      if (s.recipient !== accountId || s.state.kind !== "waiting") continue;
      const atMs = Number(BigInt(s.scheduled_at_ns) / 1_000_000n);
      events.push({ id: `scheduled_for_you:${s.token_id}:${s.scheduled_at_ns}`, kind: "scheduled_for_you", tokenId: s.token_id, atMs, counterparty: s.giver, byOthers: true, releaseAtMs: Number(BigInt(s.release_at_ns) / 1_000_000n) });
    }
    events.sort((a, b) => b.atMs - a.atMs);
    return { events, source: "NearBlocks index and the contracts' own records", partial };
  }

  private txLogs = new Map<string, Promise<LoggedOutcome[]>>();

  /** Every receipt's logs in one transaction, from an archival node. Never changes, so kept. */
  private txOutcomes(hash: string) {
    let hit = this.txLogs.get(hash);
    if (!hit) {
      type Status = { receipts_outcome: { outcome: LoggedOutcome }[] };
      // Archival nodes find a transaction by its hash; the sender only routes the lookup.
      hit = jsonRpc<Status>(this.ep.nearArchival, "EXPERIMENTAL_tx_status", {
        tx_hash: hash,
        sender_account_id: this.opts.contractId,
        wait_until: "NONE",
      }).then((r) => r.receipts_outcome.map((o) => ({ executor_id: o.outcome.executor_id, logs: o.outcome.logs })));
      hit.catch(() => this.txLogs.delete(hash));
      this.txLogs.set(hash, hit);
    }
    return hit;
  }

  /**
   * Every transaction that minted or moved the vault, newest first, from NearBlocks' index. Each
   * page of 25 costs one credit of its rate limit, so the next page is read only when this one is
   * full; a vault's custody log keeps 16 holders, so a fourth page is never needed in practice.
   */
  private async vaultMoves(tokenId: string) {
    // The row's own timestamp is the transfer's block: the custody log's clock, to the nanosecond.
    type Move = { transaction_hash: string; block_timestamp: string };
    type Page = { data?: Move[]; meta?: { next_page?: string | null } };
    const base = `${this.ep.nearblocks}/nfts/${encodeURIComponent(this.opts.contractId)}/tokens/${encodeURIComponent(tokenId)}/txns`;
    const rows: Move[] = [];
    let next: string | null = null;
    for (let page = 0; page < 4; page++) {
      const url: string = next ? `${base}?next=${encodeURIComponent(next)}` : base;
      const r: Page | null = await getJson<Page>(url).catch(() => null);
      if (!r?.data) return { rows, complete: false };
      rows.push(...r.data);
      next = r.data.length >= 25 ? (r.meta?.next_page ?? null) : null;
      if (!next) return { rows, complete: true };
    }
    return { rows, complete: false };
  }

  /**
   * NearBlocks' index lists every transaction that moved the vault (one call; it's rate-limited).
   * Each one's logs are read from an archival node, and the escrow contracts' events in them are
   * kept: a listing logs its price, a sale its buyer, a loan request its terms. Funding a loan and
   * checking in to a switch don't move the vault, so those come from the escrow's current record.
   * If the index can't be read, the current record is all there is, and `complete` is false.
   */
  async vaultHistory(tokenId: string): Promise<VaultHistory> {
    const escrows = { market: this.opts.marketId, schedule: this.opts.scheduleId, lend: this.opts.lendId, switch: this.opts.switchId, standing: this.opts.standingId };
    const [moves, listing, schedule, loan, sw, plan] = await Promise.all([
      this.vaultMoves(tokenId),
      this.getListing(tokenId),
      this.getSchedule(tokenId),
      this.getLoan(tokenId),
      this.getSwitch(tokenId),
      this.getStandingPlan(tokenId),
    ]);
    let complete = moves.complete;
    const logged: EscrowEvent[] = [];
    // One transaction can move the vault more than once (a refused listing comes straight back).
    const txs = [...new Map(moves.rows.map((m) => [m.transaction_hash, m.block_timestamp])).entries()];
    for (let i = 0; i < txs.length; i += 4) {
      const batch = await Promise.all(
        txs.slice(i, i + 4).map(([tx, at]) =>
          this.txOutcomes(tx)
            .then((outcomes) => escrowEventsInLogs(outcomes, tokenId, escrows, at, tx))
            .catch(() => {
              complete = false;
              return [];
            }),
        ),
      );
      logged.push(...batch.flat());
    }
    return {
      events: mergeHistory(logged, recordEvents({ listing, schedule, loan, switch: sw, plan })),
      source: "NearBlocks index, NEAR archival RPC and the contracts' own records",
      complete,
    };
  }

  /**
   * Re-reads a recorded attack transaction from an archival node and reports how the contract
   * answered. Nothing is sent: the attacks were real transactions, signed by test accounts.
   */
  async runAttack(kind: AttackKind): Promise<AttackResult> {
    const a = this.opts.recordedAttacks?.find((x) => x.kind === kind);
    if (!a) throw new Error(`No "${kind}" attack was recorded on this contract. It runs in the sandbox tests (pnpm test:contracts).`);
    const r = await jsonRpc<{ status: { Failure?: unknown; SuccessValue?: string } }>(this.ep.nearArchival, "tx", {
      tx_hash: a.txHash,
      sender_account_id: a.signerId,
      wait_until: "NONE",
    });
    const failure = r.status.Failure ? JSON.stringify(r.status.Failure) : null;
    return {
      kind,
      rejected: failure !== null,
      errorCode: failure?.match(/ERR_[A-Z_]+|MethodNotFound/)?.[0] ?? null,
      testName: a.testName,
      txHash: a.txHash,
      simulated: false,
    };
  }
}

