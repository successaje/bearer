"use client";

import type { WalletAdapter } from "@bearer/sdk";
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

function decodeReturn(value: string | undefined) {
  if (!value) return null;
  const text = atob(value);
  return text ? JSON.parse(text) : null;
}

/** @bearer/sdk's wallet interface, backed by whichever wallet the user picked in near-connect. */
export const nearConnectWallet: WalletAdapter = {
  accountId: () => account,
  async send(receiverId, calls) {
    const wallet = await (await getConnector()).wallet();
    const outcome = (await wallet.signAndSendTransaction({
      receiverId,
      actions: calls.map((c) => ({
        type: "FunctionCall" as const,
        params: { methodName: c.methodName, args: c.args, gas: c.gas.toString(), deposit: c.deposit.toString() },
      })),
    })) as unknown as { transaction: { hash: string }; status: { SuccessValue?: string; Failure?: unknown } };
    if (outcome.status?.Failure) throw new Error(JSON.stringify(outcome.status.Failure));
    return { txHash: outcome.transaction.hash, returnValue: decodeReturn(outcome.status?.SuccessValue) };
  },
};
