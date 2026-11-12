"use client";

import type { AttackKind, ChainTag, Finish, LoanTerms, VaultLoan, VaultView, WithdrawalStage, WithdrawRequest } from "@bearer/sdk";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { IS_SIMULATED, LEND_CONTRACT, MARKET_CONTRACT, SCHEDULE_CONTRACT, SWITCH_CONTRACT } from "@/lib/config";
import { getVaultClient } from "./client";
import { fetchContractFacts } from "./contract-facts";

export const keys = {
  vaults: (owner: string) => ["vaults", owner] as const,
  vault: (id: string) => ["vault", id] as const,
  withdrawals: (id: string) => ["withdrawals", id] as const,
  observe: (id: string) => ["observe", id] as const,
  progress: (id: string, index: number) => ["progress", id, index] as const,
  account: (id: string) => ["account", id] as const,
  listings: ["listings"] as const,
  schedules: ["schedules"] as const,
  schedule: (id: string) => ["schedule", id] as const,
  listing: (id: string) => ["listing", id] as const,
  loans: ["loans"] as const,
  loan: (id: string) => ["loan", id] as const,
  switches: ["switches"] as const,
  switchFor: (id: string) => ["switch", id] as const,
};

/** Brief 3.4: deposits appear automatically, polled every 10 s. */
const POLL_MS = 10_000;

export function useVaults(owner: string | null) {
  return useQuery({
    queryKey: keys.vaults(owner ?? ""),
    queryFn: async () => (await getVaultClient()).listVaults(owner as string),
    enabled: Boolean(owner),
    refetchInterval: POLL_MS,
  });
}

export function useVault(id: string) {
  return useQuery({
    queryKey: keys.vault(id),
    queryFn: async () => (await getVaultClient()).getVault(id),
    // Keys arrive a block or two after creation; poll faster until they do.
    refetchInterval: (q) => (q.state.data && !q.state.data.keys ? 1_000 : POLL_MS),
  });
}

export function useWithdrawals(id: string) {
  return useQuery({
    queryKey: keys.withdrawals(id),
    queryFn: async () => (await getVaultClient()).getWithdrawals(id),
    refetchInterval: (q) => (q.state.data?.some((w) => w.status === "pending") ? 1_500 : POLL_MS),
  });
}

export function useObservation(vault: VaultView | null | undefined) {
  return useQuery({
    queryKey: keys.observe(vault?.token_id ?? ""),
    queryFn: async () => (await getVaultClient()).observe(vault as VaultView),
    enabled: Boolean(vault),
    refetchInterval: (q) => (q.state.data?.some((o) => o.pending !== "0") ? 3_000 : POLL_MS),
  });
}

/** Observations and withdrawals for a list of vaults, sharing the per-vault cache entries. */
export function useVaultSummaries(vaults: VaultView[] | undefined) {
  const list = vaults ?? [];
  const observations = useQueries({
    queries: list.map((v) => ({
      queryKey: keys.observe(v.token_id),
      queryFn: async () => (await getVaultClient()).observe(v),
      refetchInterval: POLL_MS,
    })),
  });
  const withdrawals = useQueries({
    queries: list.map((v) => ({
      queryKey: keys.withdrawals(v.token_id),
      queryFn: async () => (await getVaultClient()).getWithdrawals(v.token_id),
      refetchInterval: POLL_MS,
    })),
  });
  return list.map((v, i) => ({ vault: v, observations: observations[i]?.data, withdrawals: withdrawals[i]?.data }));
}

const DONE: WithdrawalStage[] = ["confirmed", "failed"];

export function useWithdrawalProgress(id: string, index: number | null) {
  return useQuery({
    queryKey: keys.progress(id, index ?? -1),
    queryFn: async () => (await getVaultClient()).trackWithdrawal(id, index as number),
    enabled: index !== null,
    // Public RPCs are shared: poll the live adapter gently.
    refetchInterval: (q) => (q.state.data && DONE.includes(q.state.data.stage) ? false : IS_SIMULATED ? 700 : 4000),
  });
}

/** The contract's lock state and code hash, from the chain on testnet. */
export function useContractFacts() {
  return useQuery({ queryKey: ["contract-facts"], queryFn: () => fetchContractFacts(), staleTime: 60_000 });
}

/** Live adapter only: sends a signed withdrawal to its chain (anyone may). */
export function useBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; index: number }) => {
      const client = await getVaultClient();
      if (!client.broadcast) throw new Error("Broadcasting happens on its own in the simulated demo.");
      return client.broadcast(v.id, v.index);
    },
    onSuccess: (p, v) => qc.setQueryData(keys.progress(v.id, v.index), p),
  });
}

export function useAccountExists(accountId: string | null) {
  return useQuery({
    queryKey: keys.account(accountId ?? ""),
    queryFn: async () => (await getVaultClient()).accountExists(accountId as string),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return (id: string) => {
    void qc.invalidateQueries({ queryKey: ["vaults"] });
    void qc.invalidateQueries({ queryKey: keys.vault(id) });
    void qc.invalidateQueries({ queryKey: keys.withdrawals(id) });
    void qc.invalidateQueries({ queryKey: keys.observe(id) });
    void qc.invalidateQueries({ queryKey: keys.listings });
    void qc.invalidateQueries({ queryKey: ["activity"] });
    void qc.invalidateQueries({ queryKey: keys.schedules });
    void qc.invalidateQueries({ queryKey: keys.schedule(id) });
    void qc.invalidateQueries({ queryKey: keys.listing(id) });
    void qc.invalidateQueries({ queryKey: keys.loans });
    void qc.invalidateQueries({ queryKey: keys.loan(id) });
    void qc.invalidateQueries({ queryKey: keys.switches });
    void qc.invalidateQueries({ queryKey: keys.switchFor(id) });
  };
}

export function useCreateVault() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { name?: string; finish: Finish; signer: string }) =>
      (await getVaultClient()).createVault({ name: v.name, finish: v.finish }, v.signer),
    onSuccess: (vault) => refresh(vault.token_id),
  });
}

export function useTransfer() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; receiver: string; signer: string }) =>
      (await getVaultClient()).transfer(v.id, v.receiver, v.signer),
    onSuccess: (vault) => refresh(vault.token_id),
  });
}

export function useBreakSealAndWithdraw() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; request: WithdrawRequest; signer: string }) =>
      (await getVaultClient()).breakSealAndWithdraw(v.id, v.request, v.signer),
    onSuccess: (_w, v) => refresh(v.id),
  });
}

export function useWithdraw() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; request: WithdrawRequest; signer: string }) =>
      (await getVaultClient()).withdraw(v.id, v.request, v.signer),
    onSuccess: (_w, v) => refresh(v.id),
  });
}

/* ---------- scheduled handover ---------- */

export function useSchedules() {
  return useQuery({ queryKey: keys.schedules, queryFn: async () => (await getVaultClient()).schedules(), refetchInterval: POLL_MS });
}

export function useSchedule(id: string) {
  return useQuery({ queryKey: keys.schedule(id), queryFn: async () => (await getVaultClient()).getSchedule(id), refetchInterval: POLL_MS });
}

export function useScheduleFacts() {
  return useQuery({
    queryKey: ["schedule-facts", SCHEDULE_CONTRACT],
    queryFn: () => fetchContractFacts(SCHEDULE_CONTRACT as string),
    enabled: Boolean(SCHEDULE_CONTRACT),
    staleTime: 60_000,
  });
}

export function useScheduleHandover() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; recipient: string; releaseAtMs: number; cancellable: boolean; signer: string }) =>
      (await getVaultClient()).scheduleHandover(v.id, v.recipient, v.releaseAtMs, v.cancellable, v.signer),
    onSuccess: (_s, v) => refresh(v.id),
  });
}

export function useReleaseHandover() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; signer: string }) => (await getVaultClient()).releaseHandover(v.id, v.signer),
    onSettled: (_r, _e, v) => refresh(v.id),
  });
}

export function useCancelHandover() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; signer: string }) => (await getVaultClient()).cancelHandover(v.id, v.signer),
    onSuccess: (_r, v) => refresh(v.id),
  });
}

/* ---------- an account's activity: the bell and the account page ---------- */

export function useAccountActivity(accountId: string | null) {
  return useQuery({
    queryKey: ["activity", accountId],
    queryFn: async () => (await getVaultClient()).accountActivity(accountId as string),
    enabled: Boolean(accountId),
    // NearBlocks' free index is rate-limited, so once a minute; a failed read keeps the last one.
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useMarketBalances(accountId: string | null) {
  return useQuery({
    queryKey: ["market-balances", accountId],
    queryFn: async () => (await getVaultClient()).marketBalances(accountId as string),
    enabled: Boolean(accountId && MARKET_CONTRACT),
    refetchInterval: 60_000,
  });
}

export function useMarketPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, signer }: { kind: "claim" | "deposit"; signer: string }) => {
      const c = await getVaultClient();
      return kind === "claim" ? c.claimPayout(signer) : c.withdrawListingDeposit(signer);
    },
    onSuccess: (b, v) => {
      qc.setQueryData(["market-balances", v.signer], b);
      void qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

/* ---------- the market ---------- */

/* ---------- borrowing against a vault ---------- */

export function useLoans() {
  return useQuery({ queryKey: keys.loans, queryFn: async () => (await getVaultClient()).loans(), refetchInterval: POLL_MS });
}

export function useLoan(id: string) {
  return useQuery({ queryKey: keys.loan(id), queryFn: async () => (await getVaultClient()).getLoan(id), refetchInterval: POLL_MS });
}

/** The lending account's lock state: until it has no full-access keys, its key holder could act as the owner of every pledged vault. */
export function useLendFacts() {
  return useQuery({
    queryKey: ["lend-facts", LEND_CONTRACT],
    queryFn: () => fetchContractFacts(LEND_CONTRACT as string),
    enabled: Boolean(LEND_CONTRACT),
    staleTime: 60_000,
  });
}

export function useLendConfig() {
  return useQuery({
    queryKey: ["lend-config"],
    queryFn: async () => (await getVaultClient()).lendConfig(),
    enabled: Boolean(LEND_CONTRACT),
    staleTime: Infinity,
  });
}

export function useRequestLoan() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; terms: LoanTerms; signer: string }) => (await getVaultClient()).requestLoan(v.id, v.terms, v.signer),
    onSuccess: (_l, v) => refresh(v.id),
  });
}

export function useFundLoan() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { loan: VaultLoan; signer: string }) => (await getVaultClient()).fundLoan(v.loan, v.signer),
    onSettled: (_l, _e, v) => refresh(v.loan.token_id),
  });
}

export function useRepayLoan() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; signer: string }) => (await getVaultClient()).repayLoan(v.id, v.signer),
    onSettled: (_r, _e, v) => refresh(v.id),
  });
}

export function useForecloseLoan() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; signer: string }) => (await getVaultClient()).forecloseLoan(v.id, v.signer),
    onSettled: (_r, _e, v) => refresh(v.id),
  });
}

export function useCancelLoanRequest() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; signer: string }) => (await getVaultClient()).cancelLoanRequest(v.id, v.signer),
    onSuccess: (_r, v) => refresh(v.id),
  });
}

/* ---------- a dead man's switch ---------- */

export function useSwitches() {
  return useQuery({ queryKey: keys.switches, queryFn: async () => (await getVaultClient()).switches(), refetchInterval: POLL_MS });
}

export function useSwitch(id: string) {
  return useQuery({ queryKey: keys.switchFor(id), queryFn: async () => (await getVaultClient()).getSwitch(id), refetchInterval: POLL_MS });
}

/** The switch account's lock state: until it has no full-access keys, its key holder could act as the owner of every vault in it. */
export function useSwitchFacts() {
  return useQuery({
    queryKey: ["switch-facts", SWITCH_CONTRACT],
    queryFn: () => fetchContractFacts(SWITCH_CONTRACT as string),
    enabled: Boolean(SWITCH_CONTRACT),
    staleTime: 60_000,
  });
}

export function useSwitchConfig() {
  return useQuery({
    queryKey: ["switch-config"],
    queryFn: async () => (await getVaultClient()).switchConfig(),
    enabled: Boolean(SWITCH_CONTRACT),
    staleTime: Infinity,
  });
}

export function useArmSwitch() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; beneficiary: string; intervalMs: number; signer: string }) =>
      (await getVaultClient()).armSwitch(v.id, v.beneficiary, v.intervalMs, v.signer),
    onSuccess: (_s, v) => refresh(v.id),
  });
}

export function useCheckIn() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; signer: string }) => (await getVaultClient()).checkIn(v.id, v.signer),
    onSettled: (_s, _e, v) => refresh(v.id),
  });
}

export function useUpdateSwitch() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; beneficiary?: string; intervalMs?: number; signer: string }) =>
      (await getVaultClient()).updateSwitch(v.id, { beneficiary: v.beneficiary, intervalMs: v.intervalMs }, v.signer),
    onSettled: (_s, _e, v) => refresh(v.id),
  });
}

export function useTakeBackSwitch() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; signer: string }) => (await getVaultClient()).takeBackSwitch(v.id, v.signer),
    onSettled: (_r, _e, v) => refresh(v.id),
  });
}

export function useReleaseSwitch() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; signer: string }) => (await getVaultClient()).releaseSwitch(v.id, v.signer),
    onSettled: (_r, _e, v) => refresh(v.id),
  });
}

export function useListings() {
  return useQuery({ queryKey: keys.listings, queryFn: async () => (await getVaultClient()).listings(), refetchInterval: POLL_MS });
}

export function useListing(id: string) {
  return useQuery({ queryKey: keys.listing(id), queryFn: async () => (await getVaultClient()).getListing(id), refetchInterval: POLL_MS });
}

/** The market account's lock state: until it has no full-access keys, its key holder could act as the owner of every listed vault. */
export function useMarketFacts() {
  return useQuery({
    queryKey: ["market-facts", MARKET_CONTRACT],
    queryFn: () => fetchContractFacts(MARKET_CONTRACT as string),
    enabled: Boolean(MARKET_CONTRACT),
    staleTime: 60_000,
  });
}

export function useMarketConfig() {
  return useQuery({ queryKey: ["market-config"], queryFn: async () => (await getVaultClient()).marketConfig(), staleTime: Infinity });
}

export function useListVault() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; priceYocto: string; signer: string }) =>
      (await getVaultClient()).listVault(v.id, v.priceYocto, v.signer),
    onSuccess: (_l, v) => refresh(v.id),
  });
}

export function useBuyVault() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; priceYocto: string; signer: string }) =>
      (await getVaultClient()).buyVault(v.id, v.priceYocto, v.signer),
    onSuccess: (_v, v) => refresh(v.id),
  });
}

export function useDelistVault() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; signer: string }) => (await getVaultClient()).delistVault(v.id, v.signer),
    onSuccess: (_v, v) => refresh(v.id),
  });
}

export function useRunAttack() {
  return useMutation({
    mutationFn: async (v: { id: string; kind: AttackKind }) => (await getVaultClient()).runAttack(v.kind, v.id),
  });
}

export function useSimulateDeposit() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: string; chain: ChainTag }) => {
      const client = await getVaultClient();
      if (!client.simulateDeposit) throw new Error("Deposits can only be simulated in mock mode.");
      await client.simulateDeposit(v.id, v.chain);
    },
    onSuccess: (_r, v) => refresh(v.id),
  });
}

/** Current time, ticking. Starts at 0 so server and client render alike. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
