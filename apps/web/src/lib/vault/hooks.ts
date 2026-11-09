"use client";

import type { AttackKind, ChainTag, Finish, VaultView, WithdrawalStage, WithdrawRequest } from "@bearer/sdk";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { IS_SIMULATED, MARKET_CONTRACT } from "@/lib/config";
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
  listing: (id: string) => ["listing", id] as const,
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
    void qc.invalidateQueries({ queryKey: keys.listing(id) });
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

/* ---------- the market ---------- */

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
