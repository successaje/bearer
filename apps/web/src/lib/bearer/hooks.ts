"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getBearerClient } from "./client";
import type { Card, ChainTag, Finish, OpenInput, RequestStage } from "./types";

export const queryKeys = {
  cards: (owner: string) => ["cards", owner] as const,
  card: (id: string) => ["card", id] as const,
  request: (id: string) => ["request", id] as const,
  claim: (key: string) => ["claim", key] as const,
  account: (id: string) => ["account", id] as const,
};

/** Brief 3.3: deposits appear automatically, polled every 10 s. */
const POLL_MS = 10_000;

export function useCards(owner: string | null) {
  return useQuery({
    queryKey: queryKeys.cards(owner ?? ""),
    queryFn: async () => (await getBearerClient()).listCards(owner as string),
    enabled: Boolean(owner),
    refetchInterval: POLL_MS,
  });
}

export function useCard(id: string) {
  return useQuery({
    queryKey: queryKeys.card(id),
    queryFn: async () => (await getBearerClient()).getCard(id),
    // Poll faster while a signature is in flight so the seal updates as soon as it lands.
    refetchInterval: (q) => (q.state.data?.pending.length ? 2_000 : POLL_MS),
  });
}

const TERMINAL: RequestStage[] = ["confirmed", "failed"];

export function useOpenRequest(requestId: string | null) {
  return useQuery({
    queryKey: queryKeys.request(requestId ?? ""),
    queryFn: async () => (await getBearerClient()).getRequest(requestId as string),
    enabled: Boolean(requestId),
    refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.stage) ? false : 700),
  });
}

export function useClaimLookup(key: string | null) {
  return useQuery({
    queryKey: queryKeys.claim(key ?? ""),
    queryFn: async () => (await getBearerClient()).getClaim(key as string),
    enabled: Boolean(key),
    retry: 1,
  });
}

export function useAccountExists(accountId: string | null) {
  return useQuery({
    queryKey: queryKeys.account(accountId ?? ""),
    queryFn: async () => (await getBearerClient()).accountExists(accountId as string),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });
}

/** Wraps a card-changing call and refreshes everything that shows that card. */
function useCardMutation<TVars>(fn: (vars: TVars) => Promise<Card>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (card) => {
      qc.setQueryData(queryKeys.card(card.id), card);
      void qc.invalidateQueries({ queryKey: ["cards"] });
      void qc.invalidateQueries({ queryKey: ["card", card.id] });
    },
  });
}

export function useCreateCard() {
  return useCardMutation(async (v: { name: string; finish: Finish; signer: string }) =>
    (await getBearerClient()).createCard({ name: v.name, finish: v.finish }, v.signer),
  );
}

export function useHandOver() {
  return useCardMutation(async (v: { id: string; receiver: string; signer: string }) =>
    (await getBearerClient()).handOver(v.id, v.receiver, v.signer),
  );
}

export function useCreateClaimLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; signer: string }) =>
      (await getBearerClient()).createClaimLink(v.id, v.signer),
    onSuccess: (_res, v) => {
      void qc.invalidateQueries({ queryKey: ["card", v.id] });
      void qc.invalidateQueries({ queryKey: ["cards"] });
    },
  });
}

export function useCancelClaimLink() {
  return useCardMutation(async (v: { id: string; signer: string }) =>
    (await getBearerClient()).cancelClaimLink(v.id, v.signer),
  );
}

export function useClaim() {
  return useCardMutation(async (v: { key: string; receiver: string }) =>
    (await getBearerClient()).claim(v.key, v.receiver),
  );
}

export function useCreateAccountAndClaim() {
  return useCardMutation(async (v: { key: string; accountId: string }) =>
    (await getBearerClient()).createAccountAndClaim(v.key, v.accountId),
  );
}

export function useList() {
  return useCardMutation(async (v: { id: string; priceNear: string; signer: string }) =>
    (await getBearerClient()).list(v.id, v.priceNear, v.signer),
  );
}

export function useDelist() {
  return useCardMutation(async (v: { id: string; signer: string }) =>
    (await getBearerClient()).delist(v.id, v.signer),
  );
}

export function useBuy() {
  return useCardMutation(async (v: { id: string; buyer: string; expectedLogVersion: number }) =>
    (await getBearerClient()).buy(v.id, v.buyer, v.expectedLogVersion),
  );
}

export function useOpen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; input: OpenInput; signer: string }) =>
      (await getBearerClient()).open(v.id, v.input, v.signer),
    onSuccess: (req) => {
      qc.setQueryData(queryKeys.request(req.id), req);
      void qc.invalidateQueries({ queryKey: ["card", req.cardId] });
      void qc.invalidateQueries({ queryKey: ["cards"] });
    },
  });
}

export function useProveEvm() {
  return useCardMutation(async (v: { id: string }) => (await getBearerClient()).proveEvmSettled(v.id));
}

export function useExpirePending() {
  return useCardMutation(async (v: { id: string; idx: number }) =>
    (await getBearerClient()).expirePending(v.id, v.idx),
  );
}

export function useSimulateDeposit() {
  return useCardMutation(async (v: { id: string; chain: ChainTag }) => {
    const client = await getBearerClient();
    if (!client.simulateDeposit) throw new Error("Deposits can only be simulated in mock mode.");
    return client.simulateDeposit(v.id, v.chain);
  });
}

/**
 * Current time, ticking every `intervalMs`. Starts at 0 so server and client
 * render the same thing; anything time-based only appears once data has loaded.
 */
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
