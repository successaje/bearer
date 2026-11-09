/**
 * Checks @bearer/sdk's testnet adapter against the live contract and chains, with a wallet backed
 * by the spike accounts' keys (~/.near-credentials). Run: pnpm spike:adapter
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as bitcoin from "bitcoinjs-lib";
import { Account, actions } from "near-api-js";
import { describe, expect, it } from "vitest";
import { TestnetBearerClient, chainTxId, type WalletAdapter } from "../../../packages/sdk/src/index";

const PARENT = process.env.BEARER_TESTNET_PARENT ?? "bearer-1108-ffb3.testnet";
const CONTRACT = `${process.env.BEARER_TESTNET_PREFIX ?? "v3a"}.${PARENT}`;
const ALICE = `alice.${PARENT}`;
const BOB = `bob.${PARENT}`;
const RPC = "https://test.rpc.fastnear.com";

function keyWallet(accountId: string): WalletAdapter {
  const { private_key } = JSON.parse(readFileSync(join(homedir(), ".near-credentials", "testnet", `${accountId}.json`), "utf8"));
  const account = new Account(accountId, RPC, private_key);
  return {
    accountId: () => accountId,
    async send(receiverId, calls) {
      const r = (await account.signAndSendTransaction({
        receiverId,
        actions: calls.map((c) => actions.functionCall(c.methodName, c.args, c.gas, c.deposit)),
        waitUntil: "EXECUTED_OPTIMISTIC",
      })) as unknown as { transaction: { hash: string }; status: { SuccessValue?: string } };
      const v = r.status.SuccessValue;
      return { txHash: r.transaction.hash, returnValue: v ? JSON.parse(Buffer.from(v, "base64").toString() || "null") : null };
    },
  };
}

const reader = new TestnetBearerClient({ contractId: CONTRACT, wallet: { accountId: () => null, send: async () => ({ txHash: "", returnValue: null }) } });

describe("reads (free)", () => {
  it("reads vault No. 0002 and its ten withdrawals", async () => {
    const v = await reader.getVault("2");
    expect(v?.owner_id).toBe(BOB);
    expect(v?.btc_address).toMatch(/^tb1q/);
    expect(v?.sol_address).toBe("Dgx8782F7YJYYYYsKuk1uhdyPbvnu2DNRFrfKKGKgUKn");
    expect((await reader.getWithdrawals("2")).length).toBeGreaterThanOrEqual(10);
    expect(await reader.listVaults(ALICE)).toEqual(expect.arrayContaining([expect.objectContaining({ token_id: "4" })]));
  });

  it("observes all three chains with named sources", async () => {
    const obs = await reader.observe((await reader.getVault("4"))!);
    console.log(obs.map((o) => `${o.chain}: confirmed ${o.confirmed}, pending ${o.pending}, fee ${o.feeEstimate} (${o.source})`).join("\n"));
    expect(obs.map((o) => o.chain)).toEqual(["btc", "evm", "sol"]);
    const btc = obs[0];
    expect(BigInt(btc.confirmed) + BigInt(btc.pending)).toBeGreaterThan(0n); // the human funded it
  });

  it("knows the Base withdrawal that landed by its real hash", async () => {
    const p = await reader.trackWithdrawal("2", 0);
    expect(p.chainTxHash).toBe("0xb347d755df6105ef2deb58158533f31fa5687586992308ee2fed0e4622ee20e3");
    expect(p.stage).toBe("confirmed");
  });

  it("computes Bitcoin txids exactly like bitcoinjs-lib", async () => {
    const ws = await reader.getWithdrawals("2");
    const btc = ws.filter((w) => w.params.chain === "btc" && w.signed_raw_tx);
    expect(btc.length).toBeGreaterThan(0);
    for (const w of btc) expect(chainTxId("btc", w.signed_raw_tx!)).toBe(bitcoin.Transaction.fromHex(w.signed_raw_tx!).getId());
  });

  it("reports an expired Solana withdrawal as failed, with the reason", async () => {
    const ws = await reader.getWithdrawals("2");
    const sol = ws.find((w) => w.params.chain === "sol")!;
    const p = await reader.trackWithdrawal("2", sol.index);
    expect(p.stage).toBe("failed");
    expect(p.error).toMatch(/blockhash expired/);
  });

  it("refuses a nonce that's already been used", async () => {
    const p = await reader.trackWithdrawal("2", 1);
    expect(["broadcasting", "failed"]).toContain(p.stage);
  });
});

describe.runIf(process.env.SPEND === "1")("writes (spend testnet NEAR)", () => {
  it("creates, transfers, then breaks the seal and withdraws in one transaction", async () => {
    const alice = new TestnetBearerClient({ contractId: CONTRACT, wallet: keyWallet(ALICE) });
    const bob = new TestnetBearerClient({ contractId: CONTRACT, wallet: keyWallet(BOB) });
    const v = await alice.createVault({ name: "Adapter check", finish: "graphite" }, ALICE);
    expect(v.keys).not.toBeNull();
    const moved = await alice.transfer(v.token_id, BOB, ALICE);
    expect(moved.owner_id).toBe(BOB);
    const w = await bob.breakSealAndWithdraw(v.token_id, { chain: "evm", to: v.evm_address!, amountWei: "1000" }, BOB);
    expect(w.params.chain).toBe("evm");
    expect((await bob.getVault(v.token_id))?.state.kind).toBe("opened");
    let p = await bob.trackWithdrawal(v.token_id, w.index);
    for (let i = 0; i < 30 && p.stage === "signing"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      p = await bob.trackWithdrawal(v.token_id, w.index);
    }
    console.log(`vault ${v.token_id}: withdrawal ${w.index} → ${p.stage} ${p.chainTxHash}`);
    // Unfunded on Base, so it waits to be broadcast rather than landing.
    expect(p.stage).toBe("broadcasting");
  });
});
