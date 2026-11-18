/**
 * Checks NEAR AI Cloud's private inference, the way its verification docs describe
 * (docs.near.ai/cloud/verification), with nothing taken on trust from NEAR AI itself:
 *
 * 1. Fresh: a nonce made here must come back in every instance's report, Intel and NVIDIA.
 * 2. Intel: each instance's TDX quote is verified against Intel's own certification service
 *    (DCAP, @phala/dcap-qvl with collateral from api.trustedservices.intel.com), status UpToDate.
 * 3. Not debuggable: the TD's debug bit is off.
 * 4. Code: the quote binds the published docker compose (mr_config_id), and the event log replays
 *    to the quote's RTMR3, including the compose-hash event.
 * 5. GPUs: NVIDIA's attestation service checks the GPU evidence; its answer is a JWT verified here
 *    against NVIDIA's published keys, with the overall result true and our nonce.
 * 6. Bound: the quote's report data is the instance's signing address followed by our nonce, so the
 *    key that signs replies lives inside that attested enclave.
 * 7. Signed: the reply's signature recovers to that same address, over the hashes of the exact
 *    bytes sent and received.
 *
 * Server only: it fetches Intel's and NVIDIA's services and uses the API key for the signature.
 */
import { getCollateralFromPcs, verify as verifyQuote } from "@phala/dcap-qvl";
import { p384 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256, sha384 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base64urlnopad, hex } from "@scure/base";
import type { Check, ModelEvidence, SignatureCheck } from "./types";

export const NEAR_AI_API = "https://cloud-api.near.ai/v1";
const NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";
const NRAS_JWKS = "https://nras.attestation.nvidia.com/.well-known/jwks.json";
const TIMEOUT_MS = 30_000;

// Offsets in a TDX quote, version 4: a 48-byte header, then the TD report body.
const TD_ATTRIBUTES = 168;
const MR_CONFIG_ID = 232;
const RTMR3 = 520;
const REPORT_DATA = 568;

const utf8 = (s: string) => new TextEncoder().encode(s);
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const short = (h: string, n = 8) => (h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-4)}` : h);
export const sha256Hex = (s: string) => hex.encode(sha256(utf8(s)));

async function get<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function newNonce() {
  return hex.encode(crypto.getRandomValues(new Uint8Array(32)));
}

/* ---------- the attestation report ---------- */

type EventLogEntry = { imr: number; event_type: number; digest: string; event: string; event_payload: string };
export type ModelAttestation = {
  model_name?: string;
  signing_address: string;
  signing_algo: string;
  request_nonce: string;
  intel_quote: string;
  nvidia_payload?: string;
  event_log: EventLogEntry[] | string;
  info: { tcb_info: string | { app_compose: string } };
};

export async function fetchReport(model: string, nonce: string) {
  const q = new URLSearchParams({ model, provider: "near", signing_algo: "ecdsa", nonce });
  const report = await get<{ model_attestations?: ModelAttestation[] }>(`${NEAR_AI_API}/attestation/report?${q}`, {
    headers: { "x-no-aliasing": "true" },
  });
  return report.model_attestations ?? [];
}

/** dstack's digest for a runtime event that the log leaves empty. */
function eventDigest(e: EventLogEntry) {
  if (e.digest) return hex.decode(e.digest);
  const type = new Uint8Array(4);
  new DataView(type.buffer).setUint32(0, e.event_type >>> 0, true);
  return sha384(
    new Uint8Array([...type, ...utf8(":"), ...utf8(e.event), ...utf8(":"), ...hex.decode(e.event_payload || "")]),
  );
}

function replayRtmr3(log: EventLogEntry[]) {
  let rtmr: Uint8Array = new Uint8Array(48);
  for (const e of log) if (e.imr === 3) rtmr = sha384(new Uint8Array([...rtmr, ...eventDigest(e)]));
  return rtmr;
}

/* ---------- NVIDIA ---------- */

type Jwk = { kid: string; kty: string; crv: string; x: string; y: string };
let jwks: { at: number; keys: Jwk[] } | null = null;

async function nvidiaKeys() {
  if (!jwks || Date.now() - jwks.at > 3_600_000)
    jwks = { at: Date.now(), keys: (await get<{ keys: Jwk[] }>(NRAS_JWKS)).keys };
  return jwks.keys;
}

/** Verifies an ES384 JWT from NVIDIA's attestation service against its published keys. */
async function nvidiaClaims(jwt: string): Promise<Record<string, unknown>> {
  const [h, p, s] = jwt.split(".");
  const header = JSON.parse(new TextDecoder().decode(base64urlnopad.decode(h))) as { kid?: string; alg?: string };
  if (header.alg !== "ES384") throw new Error(`NVIDIA's token uses ${header.alg}, not ES384`);
  let key = (await nvidiaKeys()).find((k) => k.kid === header.kid);
  if (!key) {
    jwks = null;
    key = (await nvidiaKeys()).find((k) => k.kid === header.kid);
  }
  if (!key || key.crv !== "P-384")
    throw new Error(`NVIDIA's token names key ${header.kid}, which NVIDIA doesn't publish`);
  const pub = new Uint8Array([4, ...base64urlnopad.decode(key.x), ...base64urlnopad.decode(key.y)]);
  // NVIDIA's ES384 signatures aren't low-S normalised; P-384 ECDSA doesn't require it.
  if (!p384.verify(base64urlnopad.decode(s), utf8(`${h}.${p}`), pub, { lowS: false }))
    throw new Error("NVIDIA's token signature doesn't verify");
  const claims = JSON.parse(new TextDecoder().decode(base64urlnopad.decode(p))) as Record<string, unknown>;
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) throw new Error("NVIDIA's token has expired");
  return claims;
}

async function checkGpus(payloadText: string | undefined, nonce: string) {
  if (!payloadText) return { ok: false, gpus: 0, detail: "no GPU evidence" };
  const payload = JSON.parse(payloadText) as { nonce?: string; arch?: string };
  if (payload.nonce?.toLowerCase() !== nonce)
    return { ok: false, gpus: 0, detail: "the GPU evidence carries another nonce" };
  const body = await get<[[string, string], Record<string, string>?]>(NRAS, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: payloadText,
  });
  const claims = await nvidiaClaims(body[0][1]);
  const gpus = Object.keys(body[1] ?? {}).length;
  const ok = claims["x-nvidia-overall-att-result"] === true && String(claims.eat_nonce).toLowerCase() === nonce;
  return {
    ok,
    gpus,
    arch: payload.arch ?? null,
    detail: ok ? "" : "NVIDIA's overall result isn't true for this nonce",
  };
}

/* ---------- one instance ---------- */

interface InstanceResult {
  address: string;
  fresh: boolean;
  bound: boolean;
  debugOff: boolean;
  intel: { ok: boolean; status: string };
  code: { ok: boolean; sha256: string | null; name: string | null };
  gpu: { ok: boolean; gpus: number; arch?: string | null; detail: string };
}

/** One instance's evidence, checked. Exported for tests. */
export async function checkInstance(m: ModelAttestation, nonce: string): Promise<InstanceResult> {
  const quote = hex.decode(m.intel_quote);
  const address = m.signing_address.toLowerCase();
  const reportData = quote.slice(REPORT_DATA, REPORT_DATA + 64);
  const padded = new Uint8Array(32);
  padded.set(hex.decode(address.replace(/^0x/, "")));
  const bound =
    m.signing_algo === "ecdsa" && eq(reportData.slice(0, 32), padded) && eq(reportData.slice(32), hex.decode(nonce));

  const tcb =
    typeof m.info.tcb_info === "string" ? (JSON.parse(m.info.tcb_info) as { app_compose: string }) : m.info.tcb_info;
  const log = typeof m.event_log === "string" ? (JSON.parse(m.event_log) as EventLogEntry[]) : m.event_log;
  const composeHash = sha256(utf8(tcb.app_compose));
  const mrConfig = new Uint8Array([1, ...composeHash, ...new Uint8Array(15)]);
  const composeEvent = log.find((e) => e.imr === 3 && e.event === "compose-hash");
  const codeOk =
    eq(quote.slice(MR_CONFIG_ID, MR_CONFIG_ID + 48), mrConfig) &&
    composeEvent?.event_payload?.toLowerCase() === hex.encode(composeHash) &&
    eq(replayRtmr3(log), quote.slice(RTMR3, RTMR3 + 48));
  let name: string | null = null;
  try {
    name = (JSON.parse(tcb.app_compose) as { name?: string }).name ?? null;
  } catch {
    name = null;
  }

  const [intel, gpu] = await Promise.all([
    getCollateralFromPcs(quote)
      .then((c) => verifyQuote(quote, c, Math.floor(Date.now() / 1000)))
      .then((r) => ({ ok: r.status === "UpToDate", status: r.status }))
      .catch((e: unknown) => ({ ok: false, status: `not verified: ${String(e).slice(0, 120)}` })),
    checkGpus(m.nvidia_payload, nonce).catch((e: unknown) => ({ ok: false, gpus: 0, detail: String(e).slice(0, 160) })),
  ]);

  return {
    address,
    fresh: m.request_nonce?.toLowerCase() === nonce,
    bound,
    debugOff: (quote[TD_ATTRIBUTES] & 1) === 0,
    intel,
    code: { ok: codeOk, sha256: hex.encode(composeHash), name },
    gpu,
  };
}

/** A fresh attestation of `model`'s enclaves, every instance checked. Needs no API key. */
export async function attestModel(model: string, nonce = newNonce()): Promise<ModelEvidence> {
  const checkedAt = new Date().toISOString();
  let instances: InstanceResult[] = [];
  let fetchError: string | null = null;
  try {
    const reports = await fetchReport(model, nonce);
    instances = await Promise.all(reports.map((m) => checkInstance(m, nonce)));
  } catch (e) {
    fetchError = String(e instanceof Error ? e.message : e).slice(0, 200);
  }
  const n = instances.length;
  const all = (f: (i: InstanceResult) => boolean) => n > 0 && instances.every(f);
  const addresses = [...new Set(instances.map((i) => i.address))];
  const statuses = [...new Set(instances.map((i) => i.intel.status))];
  const gpus = instances.reduce((s, i) => s + i.gpu.gpus, 0);
  const arch = instances.find((i) => i.gpu.arch)?.gpu.arch;
  const composes = [
    ...new Map(instances.map((i) => [i.code.sha256, { name: i.code.name, sha256: i.code.sha256 }])).values(),
  ];
  const of = (k: number) => (n === 1 ? "the instance" : k === n ? `all ${n} instances` : `${k} of ${n} instances`);

  const checks: Check[] = fetchError
    ? [
        {
          id: "fresh",
          label: "Attestation",
          ok: false,
          detail: `NEAR AI's attestation couldn't be read: ${fetchError}`,
        },
      ]
    : [
        {
          id: "fresh",
          label: "Fresh",
          ok: all((i) => i.fresh),
          detail: `Our nonce ${short(nonce)} came back in ${of(instances.filter((i) => i.fresh).length)}.`,
        },
        {
          id: "intel",
          label: "Intel TDX",
          ok: all((i) => i.intel.ok),
          detail: `Each quote checked against Intel's certification service: ${statuses.join(", ") || "none"}.`,
        },
        {
          id: "debug",
          label: "Not debuggable",
          ok: all((i) => i.debugOff),
          detail: "The enclave's debug bit is off, so its memory can't be read from outside.",
        },
        {
          id: "code",
          label: "Published code",
          ok: all((i) => i.code.ok),
          detail: n
            ? `Each quote binds the docker compose its enclave runs (${composes.map((c) => `${c.name ?? "unnamed"}, sha256 ${short(c.sha256 ?? "")}`).join("; ")}), and its event log replays to the quote's RTMR3. The compose pins every image by digest; NEAR AI's compose-manager in it loads the model.`
            : "No compose to check.",
        },
        {
          id: "gpu",
          label: "NVIDIA GPUs",
          ok: all((i) => i.gpu.ok),
          detail: all((i) => i.gpu.ok)
            ? `NVIDIA's attestation service passed ${gpus} ${arch ?? ""} GPUs with our nonce; its signed answer checks against NVIDIA's keys.`
            : `Not passed: ${instances.map((i) => i.gpu.detail).find(Boolean) ?? "no evidence"}.`,
        },
        {
          id: "bound",
          label: "Key in the enclave",
          ok: all((i) => i.bound),
          detail: "Each quote's report data is the instance's signing address, then our nonce.",
        },
        {
          id: "key",
          label: "One signing key",
          ok: n > 0 && addresses.length === 1,
          detail:
            addresses.length === 1
              ? `Every instance signs as ${addresses[0]}.`
              : `Instances disagree: ${addresses.join(", ") || "none"}.`,
        },
      ];

  return {
    model,
    nonce,
    signingAddress: addresses.length === 1 ? addresses[0] : null,
    instances: n,
    composes,
    ok: checks.every((c) => c.ok),
    checks,
    checkedAt,
  };
}

/* ---------- the reply's signature ---------- */

/** The address an EIP-191 personal_sign signature over `text` recovers to. */
export function personalSignSigner(text: string, signatureHex: string): string {
  const sig = hex.decode(signatureHex.replace(/^0x/, ""));
  if (sig.length !== 65) throw new Error(`a ${sig.length}-byte signature`);
  const msg = utf8(text);
  const digest = keccak_256(new Uint8Array([...utf8(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  const recovered = new Uint8Array([v, ...sig.slice(0, 64)]);
  const pub = secp256k1.Point.fromBytes(secp256k1.recoverPublicKey(recovered, digest, { prehash: false })).toBytes(
    false,
  );
  return `0x${hex.encode(keccak_256(pub.slice(1)).slice(12))}`;
}

type SignatureResponse = {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind?: string;
};

export async function fetchSignature(chatId: string, model: string, apiKey: string): Promise<SignatureResponse> {
  const q = new URLSearchParams({ model, signing_algo: "ecdsa" });
  let last: unknown = null;
  // The signature is stored a moment after the reply.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await get<SignatureResponse>(`${NEAR_AI_API}/signature/${encodeURIComponent(chatId)}?${q}`, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw last instanceof Error ? last : new Error("no signature");
}

/** The reply's signature: over exactly these hashes, by exactly the attested key. */
export function checkSignature(
  sig: SignatureResponse,
  model: string,
  requestHash: string,
  responseHash: string,
  attested: string | null,
): SignatureCheck {
  const expected = `${model}:${requestHash}:${responseHash}`;
  let signer: string | null = null;
  try {
    signer = personalSignSigner(sig.text, sig.signature);
  } catch (e) {
    return {
      ok: false,
      text: sig.text,
      signature: sig.signature,
      signer,
      kind: sig.signature_kind ?? null,
      detail: `The signature doesn't parse: ${String(e)}`,
    };
  }
  const problems = [
    sig.signature_kind && sig.signature_kind !== "provider_tee"
      ? `it was signed by the ${sig.signature_kind}, not the model's enclave`
      : null,
    sig.signing_algo !== "ecdsa" ? `it uses ${sig.signing_algo}` : null,
    sig.text !== expected ? "it signs other hashes than the bytes sent and received" : null,
    signer !== sig.signing_address.toLowerCase() ? "it doesn't recover to the address NEAR AI names" : null,
    signer !== attested ? "the signer isn't the attested enclave key" : null,
  ].filter(Boolean);
  return {
    ok: problems.length === 0,
    text: sig.text,
    signature: sig.signature,
    signer,
    kind: sig.signature_kind ?? null,
    detail: problems.length
      ? `Not verified: ${problems.join("; ")}.`
      : `Signed inside the attested enclave by ${signer}, over the SHA-256 of the exact request and reply.`,
  };
}
