/**
 * What the risk-note route returns, and what the page shows. Shared by the server route and the
 * browser; nothing here is secret.
 */

/** One thing that was checked, in words, with what was found. */
export interface Check {
  id: "fresh" | "intel" | "debug" | "code" | "gpu" | "bound" | "key" | "signed";
  label: string;
  ok: boolean;
  detail: string;
}

/** A fresh attestation of the model's enclaves, checked here, before the model is asked anything. */
export interface ModelEvidence {
  model: string;
  /** 32 random bytes, hex, made for this request. Both the Intel and the NVIDIA evidence must carry it. */
  nonce: string;
  /** The key every attested instance signs replies with, or null if none passed. */
  signingAddress: string | null;
  /** How many instances of the model NEAR AI attested; each was checked. */
  instances: number;
  /** The docker composes the enclaves run, by name and sha256, as bound into their Intel quotes. */
  composes: { name: string | null; sha256: string | null }[];
  ok: boolean;
  checks: Check[];
  /** ISO time. */
  checkedAt: string;
}

export type RiskRating = "lower" | "moderate" | "higher";

export interface RiskNote {
  rating: RiskRating;
  summary: string;
  points: string[];
  caveat: string;
}

/** The model's reply's signature, checked against the attested key. */
export interface SignatureCheck {
  ok: boolean;
  /** What NEAR AI signed: "{model}:{sha256(request)}:{sha256(response)}". */
  text: string;
  signature: string;
  /** The address the signature recovers to. */
  signer: string | null;
  kind: string | null;
  detail: string;
}

export interface RiskNoteResult {
  model: string;
  /** The public facts the model was given, exactly as sent. */
  facts: Record<string, unknown>;
  note: RiskNote | null;
  /** The model's reply as text, in case it isn't the expected JSON. */
  raw: string;
  evidence: ModelEvidence;
  signature: SignatureCheck | null;
  /** The exact bytes sent and received, so anyone can hash them again. */
  requestBody: string;
  responseBody: string;
  requestHash: string;
  responseHash: string;
  chatId: string | null;
  /** ISO time. */
  at: string;
  /** True in the simulated demo: no model was asked. */
  simulated: boolean;
}

export interface RiskNoteStatus {
  /** Whether this deployment has a NEAR AI key, so notes can be asked for. */
  configured: boolean;
  model: string;
}
