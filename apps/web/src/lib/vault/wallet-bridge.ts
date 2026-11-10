"use client";

import type { FunctionCall, WalletAdapter } from "@bearer/sdk";
import type { NearConnector } from "@hot-labs/near-connect";
import { NEAR_RPC } from "@/lib/config";

let connector: Promise<NearConnector> | null = null;
let account: string | null = null;

/** One near-connect instance for the app, created on first use in the browser. */
export function getConnector() {
  connector ??= import("@hot-labs/near-connect").then(
    ({ NearConnector }) =>
      new NearConnector({
        network: "testnet",
        providers: { testnet: [NEAR_RPC] },
        autoConnect: true,
      }),
  );
  return connector;
}

/** The wallet provider keeps this in step with near-connect's signed-in account. */
export function setConnectedAccount(id: string | null) {
  account = id;
}

let link: WalletAdapter | null = null;

/** While a Bearer link is open in this tab, its key signs instead of near-connect's wallet. */
export function setLinkWallet(wallet: WalletAdapter | null) {
  link = wallet;
}

function decodeReturn(value: string | undefined) {
  if (!value) return null;
  const text = atob(value);
  return text ? JSON.parse(text) : null;
}

type Outcome = { transaction: { hash: string }; status: { SuccessValue?: string; Failure?: unknown } };

const toActions = (calls: FunctionCall[]) =>
  calls.map((c) => ({
    type: "FunctionCall" as const,
    params: { methodName: c.methodName, args: c.args, gas: c.gas.toString(), deposit: c.deposit.toString() },
  }));

function result(outcome: Outcome) {
  if (outcome.status?.Failure) throw new Error(JSON.stringify(outcome.status.Failure));
  return { txHash: outcome.transaction.hash, returnValue: decodeReturn(outcome.status?.SuccessValue) };
}

/** @bearer/sdk's wallet interface: the open Bearer link, or the wallet the user picked in near-connect. */
export const appWallet: WalletAdapter = {
  accountId: () => link?.accountId() ?? account,
  async send(receiverId, calls) {
    if (link) return link.send(receiverId, calls);
    const wallet = await (await getConnector()).wallet();
    return result((await wallet.signAndSendTransaction({ receiverId, actions: toActions(calls) })) as unknown as Outcome);
  },
  async sendMany(txs) {
    if (link?.sendMany) return link.sendMany(txs);
    const wallet = await (await getConnector()).wallet();
    const outcomes = (await wallet.signAndSendTransactions({
      transactions: txs.map((t) => ({ receiverId: t.receiverId, actions: toActions(t.calls) })),
    })) as unknown as Outcome[];
    return outcomes.map(result);
  },
};
