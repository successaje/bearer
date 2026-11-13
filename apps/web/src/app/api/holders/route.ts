/**
 * The gate for /v/[id]/holders. It opens only for the vault's current holder, checked here on the
 * server, never trusted from the browser:
 *
 * 1. The request is a NEP-413 message naming this vault, signed in the last five minutes for this
 *    site, and the signature is valid for the public key sent.
 * 2. That key is a full-access key of the account, read from NEAR testnet.
 * 3. That account holds the vault right now, read from the Bearer contract at a final block.
 *
 * Only then does the response carry the holders' room. A seller is refused the moment the vault
 * changes hands, and the new holder can open it the same block.
 */
import { BEARER_CONTRACT, IS_SIMULATED, NEAR_RPC } from "@/lib/config";
import { holderMessage, MAX_AGE_MS, nonceTime, verifySignature, type HolderRequest, type HolderResult } from "@/lib/holders/nep413";
import { base64 } from "@scure/base";

type Custody = { account_id: string; since_ns: string };

async function rpc<T>(params: Record<string, unknown>): Promise<{ result: T; block_height: number }> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "holders", method: "query", params: { finality: "final", ...params } }),
    cache: "no-store",
  });
  const json = (await res.json()) as { result?: T & { block_height: number; error?: string }; error?: { cause?: { name?: string }; message?: string } };
  if (json.error || !json.result || json.result.error) {
    throw Object.assign(new Error(json.error?.cause?.name ?? json.result?.error ?? json.error?.message ?? "RPC error"), { rpc: true });
  }
  return { result: json.result, block_height: json.result.block_height };
}

/** What the gate opens onto. It is only ever sent from here, after the checks pass. */
function room(tokenId: string, blockHeight: number) {
  const no = `No. ${tokenId.padStart(4, "0")}`;
  return {
    title: "The holders' room",
    body: [
      `This page opened because you just proved you hold vault ${no}. Your key signed a message naming this vault. NEAR testnet confirmed it's a full-access key of your account. And the Bearer contract says your account holds the vault, at block ${blockHeight.toLocaleString("en-US")}.`,
      "The server runs the check at every visit; the page itself decides nothing. When the vault changes hands, this page closes for you and opens for the new holder, as soon as the transfer is final.",
      "A community can put anything behind the same check: a members' page, an event pass, a download. Whoever holds the vault gets in, and nobody who held it before does.",
    ],
  };
}

const reply = (body: HolderResult, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const nsToIso = (ns: string) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();

export async function POST(request: Request) {
  if (IS_SIMULATED) return reply({ ok: false, reason: "bad_request", message: "The holders' page works on NEAR testnet." }, 400);

  let body: HolderRequest;
  try {
    body = (await request.json()) as HolderRequest;
  } catch {
    return reply({ ok: false, reason: "bad_request", message: "Send JSON." }, 400);
  }
  const { tokenId, accountId, publicKey, signature } = body ?? {};
  if (![tokenId, accountId, publicKey, signature, body?.nonce].every((v) => typeof v === "string" && v.length < 600) || !/^\d{1,10}$/.test(tokenId)) {
    return reply({ ok: false, reason: "bad_request", message: "Missing or malformed fields." }, 400);
  }

  // 1. A fresh signature over this vault's message, for this site.
  let nonce: Uint8Array;
  try {
    nonce = base64.decode(body.nonce);
  } catch {
    return reply({ ok: false, reason: "bad_request", message: "The nonce isn't base64." }, 400);
  }
  if (nonce.length !== 32) return reply({ ok: false, reason: "bad_request", message: "The nonce must be 32 bytes." }, 400);
  if (Math.abs(Date.now() - nonceTime(nonce)) > MAX_AGE_MS) {
    return reply({ ok: false, reason: "expired", message: "This signature is more than five minutes old. Sign again." }, 401);
  }
  const recipient = new URL(request.url).host;
  let valid = false;
  try {
    valid = verifySignature(signature, publicKey, holderMessage(tokenId), nonce, recipient);
  } catch {
    valid = false;
  }
  if (!valid) return reply({ ok: false, reason: "bad_signature", message: "The signature doesn't match this vault's message." }, 401);

  try {
    // 2. The key belongs to the account, with full access (NEP-413 requires it).
    let permission: unknown;
    try {
      permission = (await rpc<{ permission: unknown }>({ request_type: "view_access_key", account_id: accountId, public_key: publicKey })).result.permission;
    } catch (e) {
      if ((e as { rpc?: boolean }).rpc) {
        return reply({ ok: false, reason: "not_full_access", message: `That key isn't a key of ${accountId}.` }, 401);
      }
      throw e;
    }
    if (permission !== "FullAccess") {
      return reply({ ok: false, reason: "not_full_access", message: "That key is limited to function calls; sign with a full-access key." }, 401);
    }

    // 3. The account holds the vault now.
    const { result, block_height } = await rpc<{ result: number[] }>({
      request_type: "call_function",
      account_id: BEARER_CONTRACT,
      method_name: "vault",
      args_base64: base64.encode(new TextEncoder().encode(JSON.stringify({ token_id: tokenId }))),
    });
    const vault = JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result))) as { owner_id: string; custody: Custody[] } | null;
    if (!vault) return reply({ ok: false, reason: "no_vault", message: `There's no vault No. ${tokenId.padStart(4, "0")}.` }, 404);

    const custody = vault.custody ?? [];
    if (vault.owner_id !== accountId) {
      // A former holder: when did it leave them?
      const last = custody.map((c) => c.account_id).lastIndexOf(accountId);
      const next = last >= 0 ? custody[last + 1] : undefined;
      return reply(
        { ok: false, reason: "not_holder", accountId, holder: vault.owner_id, heldUntil: next ? nsToIso(next.since_ns) : null, blockHeight: block_height },
        403,
      );
    }
    const since = [...custody].reverse().find((c) => c.account_id === accountId);
    return reply({
      ok: true,
      accountId,
      tokenId,
      blockHeight: block_height,
      holderSince: since ? nsToIso(since.since_ns) : null,
      room: room(tokenId, block_height),
    });
  } catch (e) {
    return reply({ ok: false, reason: "rpc", message: `NEAR testnet didn't answer: ${String((e as Error).message).slice(0, 120)}` }, 502);
  }
}
