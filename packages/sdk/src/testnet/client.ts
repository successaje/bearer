import type {
  AccountActivity,
  AttackKind,
  AttackResult,
  BearerClient,
  ChainObservation,
  ChainTag,
  ContractConfig,
  Finish,
  Holdings,
  StakingInfo,
  VaultStake,
  HandoverSchedule,
  MarketBalances,
  MarketConfig,
  MarketListing,
  NftInfo,
  RecordedAttack,
  TokenInfo,
  VaultView,
  WithdrawRequest,
  Withdrawal,
  WithdrawalParams,
  WithdrawalProgress,
} from "../types";

import { broadcastRaw, btcParams, chainStatus, chainTxId, evmParams, solParams, txExplorer } from "./chains";
import { TESTNET_ENDPOINTS, type TestnetEndpoints } from "./config";
import { observeBtc, observeEvm, observeSol } from "./observe";
import { NearRpc, getJson, jsonRpc } from "./rpc";
import { custodyEvents } from "../activity";

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
  /** True for a v2 contract, which holds NEAR, tokens and NFTs for each vault (holdings.rs). */
  holdings?: boolean;
  /** The schedule contract (contracts/schedule) that hands this contract's vaults over on a date, if any. */
  scheduleId?: string | null;
  /** Attacks sent to this contract as real transactions; `runAttack` re-reads their outcome. */
  recordedAttacks?: RecordedAttack[];
  wallet: WalletAdapter;
  endpoints?: Partial<TestnetEndpoints>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The standard staking pool's unlock wait, in epochs (contracts/bearer/src/staking.rs). */
const UNLOCK_EPOCHS = 4;
type RawStaking = { pool: string | null; total_shares: string; queued: string; unbonding: string; unbonding_epoch: number; busy: boolean };
type RawStake = { shares: string; queued: string; unbonding: string; unlocks_at_epoch: number | null; ready: string };

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

  /* ---------- v2: NEAR-side holdings ---------- */

  get supportsHoldings() {
    return !!this.opts.holdings;
  }

  private requireHoldings() {
    if (!this.opts.holdings) throw new Error("This contract can't hold NEAR, tokens or NFTs; that needs version 2.");
  }

  async holdings(tokenId: string) {
    this.requireHoldings();
    return this.near.view<Holdings>(this.opts.contractId, "holdings", { token_id: tokenId });
  }

  async tokenInfo(contract: string): Promise<TokenInfo> {
    const m = await this.near.view<{ symbol?: string; name?: string; decimals?: number }>(contract, "ft_metadata");
    return { contract, symbol: m.symbol ?? null, name: m.name ?? null, decimals: m.decimals ?? 0 };
  }

  async nftInfo(contract: string, nftTokenId: string): Promise<NftInfo> {
    const t = await this.near.view<{ metadata?: { title?: string | null; media?: string | null } } | null>(contract, "nft_token", {
      token_id: nftTokenId,
    });
    if (!t) throw new Error(`${contract} has no NFT ${nftTokenId}.`);
    return { contract, token_id: nftTokenId, title: t.metadata?.title ?? null, media: t.metadata?.media ?? null };
  }

  /** Re-reads holdings until `done` says the contract has settled the change (a few receipts). */
  private async settle(tokenId: string, done: (h: Holdings) => boolean, failure: string) {
    for (let i = 0; i < 20; i++) {
      const h = await this.holdings(tokenId);
      if (done(h)) return h;
      await sleep(1000);
    }
    throw new Error(failure);
  }

  async depositNear(tokenId: string, yocto: string, signer: string) {
    this.signerFor(signer);
    this.requireHoldings();
    await this.opts.wallet.send(this.opts.contractId, [{ methodName: "deposit_near", args: { token_id: tokenId }, gas: 30n * TGAS, deposit: BigInt(yocto) }]);
    return this.holdings(tokenId);
  }

  async loadToken(tokenId: string, contract: string, amount: string, signer: string) {
    this.signerFor(signer);
    this.requireHoldings();
    // ft_transfer_call returns how much the receiver used: 0 means the vault sent it all back.
    const { returnValue } = await this.opts.wallet.send(contract, [
      {
        methodName: "ft_transfer_call",
        args: { receiver_id: this.opts.contractId, amount, msg: tokenId },
        gas: 100n * TGAS,
        deposit: ONE_YOCTO,
      },
    ]);
    if (String(returnValue) === "0") {
      throw new Error("The vault returned the tokens: only its owner can load them, and it needs a little NEAR for storage.");
    }
    return this.holdings(tokenId);
  }

  async loadNft(tokenId: string, contract: string, nftTokenId: string, signer: string) {
    this.signerFor(signer);
    this.requireHoldings();
    // nft_transfer_call resolves to false when the receiver sent the NFT back.
    const { returnValue } = await this.opts.wallet.send(contract, [
      {
        methodName: "nft_transfer_call",
        args: { receiver_id: this.opts.contractId, token_id: nftTokenId, msg: tokenId },
        gas: 100n * TGAS,
        deposit: ONE_YOCTO,
      },
    ]);
    if (returnValue === false) {
      throw new Error("The vault returned the NFT: only its owner can load one, it needs a little NEAR for storage, and vaults can't hold vaults.");
    }
    return this.holdings(tokenId);
  }

  async withdrawNear(tokenId: string, receiver: string, yocto: string, signer: string) {
    this.signerFor(signer);
    this.requireHoldings();
    // The contract takes the amount off before sending; a failed transfer puts it back a block later.
    await this.opts.wallet.send(this.opts.contractId, [
      { methodName: "withdraw_near", args: { token_id: tokenId, receiver_id: receiver, amount: yocto }, gas: 50n * TGAS, deposit: ONE_YOCTO },
    ]);
    return this.holdings(tokenId);
  }

  async withdrawToken(tokenId: string, contract: string, receiver: string, amount: string, signer: string) {
    this.signerFor(signer);
    this.requireHoldings();
    await this.opts.wallet.send(this.opts.contractId, [
      {
        methodName: "withdraw_token",
        args: { token_id: tokenId, token_contract: contract, receiver_id: receiver, amount },
        gas: 60n * TGAS,
        deposit: ONE_YOCTO,
      },
    ]);
    return this.settle(
      tokenId,
      (h) => (h.tokens.find((t) => t.contract === contract)?.pending ?? "0") === "0",
      "The withdrawal hasn't settled yet.",
    );
  }

  async withdrawNft(tokenId: string, contract: string, nftTokenId: string, receiver: string, signer: string) {
    this.signerFor(signer);
    this.requireHoldings();
    await this.opts.wallet.send(this.opts.contractId, [
      {
        methodName: "withdraw_nft",
        args: { token_id: tokenId, nft_contract: contract, nft_token_id: nftTokenId, receiver_id: receiver },
        gas: 80n * TGAS,
        deposit: ONE_YOCTO,
      },
    ]);
    return this.settle(
      tokenId,
      (h) => !h.nfts.some((n) => n.contract === contract && n.token_id === nftTokenId && n.pending),
      "The withdrawal hasn't settled yet.",
    );
  }

  /* ---------- v2: staking (contracts/bearer/src/staking.rs) ---------- */

  private epochLength?: Promise<number>;

  /** Epoch number and rough timing from the recent block rate. */
  private async epochTiming() {
    this.epochLength ??= jsonRpc<{ epoch_length: number }>(this.ep.near, "EXPERIMENTAL_protocol_config", { finality: "final" }).then((c) => c.epoch_length);
    const [length, v, head] = await Promise.all([
      this.epochLength,
      jsonRpc<{ epoch_height: number; epoch_start_height: number }>(this.ep.near, "validators", [null]),
      jsonRpc<{ header: { height: number; timestamp_nanosec: string } }>(this.ep.near, "block", { finality: "final" }),
    ]);
    const back = 2000;
    const past = await jsonRpc<{ header: { height: number; timestamp_nanosec: string } }>(this.ep.near, "block", { block_id: head.header.height - back });
    const msPerBlock = Number(BigInt(head.header.timestamp_nanosec) - BigInt(past.header.timestamp_nanosec)) / 1e6 / (head.header.height - past.header.height);
    return {
      epoch: v.epoch_height,
      msPerEpoch: Math.round(length * msPerBlock),
      msToNextEpoch: Math.max(0, Math.round((v.epoch_start_height + length - head.header.height) * msPerBlock)),
    };
  }

  async staking(): Promise<StakingInfo> {
    this.requireHoldings();
    const s = await this.near.view<RawStaking>(this.opts.contractId, "staking", {}, "final");
    const [pool, timing] = await Promise.all([
      s.pool ? this.near.view<{ staked_balance: string }>(s.pool, "get_account", { account_id: this.opts.contractId }, "final") : null,
      this.epochTiming(),
    ]);
    return {
      pool: s.pool,
      poolStaked: pool?.staked_balance ?? "0",
      totalShares: s.total_shares,
      queued: s.queued,
      unbonding: s.unbonding,
      unlocksAtEpoch: s.unbonding === "0" ? null : s.unbonding_epoch + UNLOCK_EPOCHS,
      busy: s.busy,
      ...timing,
    };
  }

  async stakeOf(tokenId: string): Promise<VaultStake | null> {
    this.requireHoldings();
    const [raw, s] = await Promise.all([this.near.view<RawStake | null>(this.opts.contractId, "stake_of", { token_id: tokenId }, "final"), this.staking()]);
    if (!raw) return null;
    const owned = BigInt(s.poolStaked) - BigInt(s.queued);
    const staked = s.totalShares === "0" || owned <= 0n ? 0n : (BigInt(raw.shares) * owned) / BigInt(s.totalShares);
    return { shares: raw.shares, staked: staked.toString(), queued: raw.queued, unbonding: raw.unbonding, unlocksAtEpoch: raw.unlocks_at_epoch, ready: raw.ready };
  }

  /** Waits for the contract's pool call to finish (a few receipts), then reads the vault's stake. */
  private async afterPoolCall(tokenId: string | null) {
    for (let i = 0; i < 30; i++) {
      const s = await this.near.view<RawStaking>(this.opts.contractId, "staking", {}, "final");
      if (!s.busy) break;
      await sleep(1000);
    }
    return tokenId ? this.stakeOf(tokenId) : null;
  }

  async stake(tokenId: string, yocto: string, signer: string) {
    this.signerFor(signer);
    this.requireHoldings();
    const before = await this.stakeOf(tokenId);
    await this.opts.wallet.send(this.opts.contractId, [{ methodName: "stake", args: { token_id: tokenId, amount: yocto }, gas: 300n * TGAS, deposit: ONE_YOCTO }]);
    const after = await this.afterPoolCall(tokenId);
    if (BigInt(after?.shares ?? "0") <= BigInt(before?.shares ?? "0")) {
      throw new Error("The pool didn't take the stake, so the NEAR is back in the vault. Try again in a moment.");
    }
    return after;
  }

  async unstake(tokenId: string, yocto: string | null, signer: string) {
    this.signerFor(signer);
    this.requireHoldings();
    const before = await this.stakeOf(tokenId);
    await this.opts.wallet.send(this.opts.contractId, [{ methodName: "unstake", args: { token_id: tokenId, amount: yocto }, gas: 300n * TGAS, deposit: ONE_YOCTO }]);
    const after = await this.afterPoolCall(tokenId);
    if (BigInt(after?.shares ?? "0") >= BigInt(before?.shares ?? "0")) {
      throw new Error("The unstake was refused: it may be more than the vault has staked. Nothing changed.");
    }
    return after;
  }

  async processUnstaking(signer: string) {
    this.signerFor(signer);
    this.requireHoldings();
    await this.opts.wallet.send(this.opts.contractId, [{ methodName: "process_unstaking", args: {}, gas: 300n * TGAS, deposit: 0n }]);
    await this.afterPoolCall(null);
    return this.staking();
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

  /**
   * Which vaults moved through the account comes from NearBlocks' index (rate-limited, so two
   * calls); what happened to each is read from its custody log on-chain. A sale's payout is the
   * market's transfer to the seller, and its price is what the buyer attached to that transaction,
   * read from an archival node. Throws if the index can't be read, so callers keep what they had.
   */
  async accountActivity(accountId: string): Promise<AccountActivity> {
    const nb = this.ep.nearblocks;
    const enc = encodeURIComponent(accountId);
    type Move = { contract_account_id: string; token_id: string };
    type Receipt = { predecessor_account_id: string; transaction_hash: string; actions: { action: string }[]; actions_agg: { deposit: string }; block: { block_timestamp: string } };
    const [moves, receipts, owned, schedules] = await Promise.all([
      getJson<{ data: Move[] }>(`${nb}/accounts/${enc}/nft-txns?limit=100`),
      this.opts.marketId ? getJson<{ data: Receipt[] }>(`${nb}/accounts/${enc}/receipts?limit=100`).catch(() => null) : null,
      this.listVaults(accountId),
      this.opts.scheduleId ? this.schedules() : Promise.resolve([] as HandoverSchedule[]),
    ]);
    const ids = new Set(owned.map((v) => v.token_id));
    for (const m of moves?.data ?? []) if (m.contract_account_id === this.opts.contractId) ids.add(m.token_id);
    const vaults = await Promise.all([...ids].map((id) => this.getVault(id)));
    const market = this.opts.marketId ?? null;
    const events = vaults.flatMap((v) => (v ? custodyEvents(v, accountId, market, this.opts.scheduleId ?? null) : []));

    // Match each sale to the market's payment to the seller, made in the same transaction a moment after the vault moved.
    const payouts = (receipts?.data ?? [])
      .filter((r) => r.predecessor_account_id === market && r.actions.some((a) => a.action === "TRANSFER"))
      .map((r) => ({ tx: r.transaction_hash, atMs: Number(BigInt(r.block.block_timestamp) / 1_000_000n), amount: r.actions_agg.deposit }));
    await Promise.all(
      events
        .filter((e) => e.kind === "sold")
        .map(async (e) => {
          const p = payouts.find((x) => x.atMs >= e.atMs - 5_000 && x.atMs <= e.atMs + 60_000);
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
    return { events, source: "NearBlocks index and the contracts' own records", partial: !receipts && Boolean(market) };
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

