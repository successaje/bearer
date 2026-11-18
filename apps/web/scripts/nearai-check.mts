/**
 * Checks NEAR AI Cloud's private inference the way the risk note does, live, and shows the checks
 * catching tampering. Needs no key:
 *
 *   pnpm --filter web check:nearai
 *
 * With NEAR_AI_API_KEY set, `-- --ask <vault number>` also writes a real risk note on that vault's
 * loan and checks the reply's signature (it spends a little NEAR AI credit). It reads the key from
 * the environment, the repository's .env or apps/web/.env.local.
 *
 * `-- --verify <file>` checks a saved note offline instead, e.g. the one in scripts/reports.
 */
import { readFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  attestModel,
  checkInstance,
  checkSignature,
  fetchReport,
  newNonce,
  personalSignSigner,
  sha256Hex,
} from "../src/lib/nearai/attest";
import { loanFacts, NEAR_AI_MODEL, writeRiskNote } from "../src/lib/nearai/risk-note";
import type { RiskNoteResult } from "../src/lib/nearai/types";

let passed = 0;
let failed = 0;
const t = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `\n    ${detail}` : ""}`);
  if (ok) passed++;
  else failed++;
};

// 0. A saved note, checked offline: its bytes hash to what was signed, the signature recovers to
// the key its attestation bound, and the note shown is the signed reply.
const saved = process.argv.indexOf("--verify");
if (saved > 0) {
  const r = JSON.parse(readFileSync(process.argv[saved + 1] ?? "", "utf8")) as RiskNoteResult;
  const reqHash = sha256Hex(r.requestBody);
  const respHash = sha256Hex(r.responseBody);
  t("The request bytes hash to the request hash", reqHash === r.requestHash, reqHash);
  t("The reply bytes hash to the reply hash", respHash === r.responseHash, respHash);
  t(
    "NEAR AI signed exactly {model}:{request hash}:{reply hash}",
    r.signature?.text === `${r.model}:${reqHash}:${respHash}`,
  );
  const signer = r.signature ? personalSignSigner(r.signature.text, r.signature.signature) : null;
  t("The signature recovers to the key the attestation bound", signer === r.evidence.signingAddress, `${signer}`);
  const reply = JSON.parse(r.responseBody) as { choices: { message: { content: string } }[] };
  t("The note is the signed reply's content", reply.choices[0].message.content === r.raw);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

console.log(`NEAR AI Cloud, model ${NEAR_AI_MODEL}\n`);

// 1. A fresh attestation of every instance, every check.
const started = Date.now();
const evidence = await attestModel(NEAR_AI_MODEL);
for (const c of evidence.checks) t(c.label, c.ok, c.detail);
console.log(`  ${evidence.instances} instance(s), checked in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);

// 2. The same checks catch tampering, on a fresh report.
const nonce = newNonce();
const [report] = await fetchReport(NEAR_AI_MODEL, nonce);
const copy = () => structuredClone(report);
const good = await checkInstance(copy(), nonce);
t(
  "A fresh report passes with its own nonce",
  good.fresh && good.bound && good.debugOff && good.intel.ok && good.code.ok && good.gpu.ok,
);
const replayed = await checkInstance(copy(), newNonce());
t(
  "Replayed with another nonce: not fresh, not bound, GPUs refused",
  !replayed.fresh && !replayed.bound && !replayed.gpu.ok,
);
const compose = copy();
const tcb = typeof compose.info.tcb_info === "string" ? JSON.parse(compose.info.tcb_info) : compose.info.tcb_info;
compose.info.tcb_info = { ...tcb, app_compose: `${tcb.app_compose} ` };
t("A changed compose file fails the code check", !(await checkInstance(compose, nonce)).code.ok);
const debug = copy();
const quote = Buffer.from(debug.intel_quote, "hex");
quote[168] |= 1;
debug.intel_quote = quote.toString("hex");
const d = await checkInstance(debug, nonce);
t("The debug bit set: caught, and Intel refuses the altered quote", !d.debugOff && !d.intel.ok, d.intel.status);
const moved = copy();
moved.signing_address = `0x${"ab".repeat(20)}`;
t("A signing address the quote doesn't bind is refused", !(await checkInstance(moved, nonce)).bound);

// 3. Reply signatures, with a stand-in key.
const key = secp256k1.utils.randomSecretKey();
const signer = `0x${Buffer.from(keccak_256(secp256k1.getPublicKey(key, false).slice(1)).slice(12)).toString("hex")}`;
const sign = (text: string) => {
  const msg = new TextEncoder().encode(text);
  const h = keccak_256(
    new Uint8Array([...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]),
  );
  const s = secp256k1.sign(h, key, { prehash: false, format: "recovered" });
  return `0x${Buffer.from([...s.slice(1), s[0] + 27]).toString("hex")}`;
};
const text = `${NEAR_AI_MODEL}:aa:bb`;
const sig = (over = {}) => ({
  text,
  signature: sign(text),
  signing_address: signer,
  signing_algo: "ecdsa",
  signature_kind: "provider_tee",
  ...over,
});
t("personal_sign recovers the signer", personalSignSigner(text, sign(text)) === signer);
t(
  "Signed by the attested key over these hashes: verified",
  checkSignature(sig(), NEAR_AI_MODEL, "aa", "bb", signer).ok,
);
t(
  "Other hashes than the bytes sent and received: refused",
  !checkSignature(sig(), NEAR_AI_MODEL, "aa", "cc", signer).ok,
);
t(
  "A key that isn't the attested one: refused",
  !checkSignature(sig(), NEAR_AI_MODEL, "aa", "bb", `0x${"cd".repeat(20)}`).ok,
);
t(
  "Signed by the gateway, not the model's enclave: refused",
  !checkSignature(sig({ signature_kind: "gateway" }), NEAR_AI_MODEL, "aa", "bb", signer).ok,
);

// 4. A real note, if asked.
const ask = process.argv.indexOf("--ask");
if (ask > 0) {
  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) throw new Error("Set NEAR_AI_API_KEY to ask for a note.");
  const { facts } = await loanFacts(process.argv[ask + 1] ?? "");
  const note = await writeRiskNote(facts, apiKey);
  console.log(`\nRisk note on vault No. ${process.argv[ask + 1]}:`, JSON.stringify(note.note, null, 2));
  t("The note's enclaves attested before it was asked", note.evidence.ok);
  t("The reply was signed in the attested enclave", note.signature?.ok === true, note.signature?.detail);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
