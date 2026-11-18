# Feature: a risk note from an attested model

**Branch:** `next` · **Where:** the loan panel on a pledged vault's page ("Risk note · NEAR AI") ·
**Server:** `apps/web/src/app/api/risk-note/route.ts`, `apps/web/src/lib/nearai/` · **Status:** built on
18 Nov 2026, while judging ran; not on `main`

**For:** whoever decides whether this ships, and anyone checking how Bearer uses NEAR AI. What it
does, what it proves, and what it doesn't.

## What it is

On a loan request, a lender can press **Get a risk note**. An open model running in NEAR AI Cloud's
confidential enclaves (`z-ai/glm-5.3-flash` by default) reads the loan's public facts and writes a
short note: a rating of the risk to the lender (lower, moderate, higher), a one-line summary, up to
four points and a caveat.

The page shows the note only with the checks behind it. **Check the enclaves now** runs the same
attestation on its own, and needs no key.

## What's checked, and where

Everything runs on Bearer's server, in `apps/web/src/lib/nearai/attest.ts`, following
[docs.near.ai/cloud/verification](https://docs.near.ai/cloud/verification). Nothing is taken on
NEAR AI's word.

Before the model is asked, a fresh attestation of every instance serving it:

| Check | How |
|---|---|
| Fresh | 32 random bytes made for this request must come back in every instance's Intel and NVIDIA evidence |
| Intel TDX | Each instance's quote is verified with DCAP against Intel's own certification service (`api.trustedservices.intel.com`), with `@phala/dcap-qvl` 0.7.1; TCB status must be `UpToDate` |
| Not debuggable | The TD's debug bit is off |
| Published code | `mr_config_id` binds the docker compose the enclave runs (sha256 of `app_compose`), the event log's `compose-hash` event agrees, and the event log replays to the quote's RTMR3 |
| NVIDIA GPUs | NVIDIA's attestation service checks the GPU evidence; its answer is an ES384 JWT verified against NVIDIA's published keys, with the overall result `true` and our nonce |
| Key in the enclave | The quote's report data is the instance's signing address, zero-padded, then our nonce |
| One signing key | Every instance signs as the same address |

If any check fails, the model isn't asked. After it answers:

| Check | How |
|---|---|
| Signed in the enclave | NEAR AI's signature for the reply is over `{model}:{sha256(request)}:{sha256(reply)}`, hashed from the exact bytes sent and received; it recovers (EIP-191) to the attested key, and its kind is `provider_tee`, the model's enclave, not the gateway |

If the signature doesn't verify, the note isn't shown. **The evidence, to check yourself** lists the
nonce, the signer, the composes, both hashes, the signed text and the signature, and copies the
whole result, request and reply bytes included, as JSON.

## What it proves, and what it doesn't

- **It proves integrity.** The note shown is what that open model, in genuine, non-debuggable Intel
  TDX enclaves with attested NVIDIA GPUs, wrote about exactly these facts, word for word.
- **It doesn't protect secrets, because there are none.** The facts are public: a vault's state and
  custody are on NEAR, its balances on public chains, the loan's terms in the lending contract. A
  vault's link key is never sent anywhere.
- **The facts can't be chosen by the visitor.** The server reads them from NEAR testnet and public
  chain data for the vault number given; the request carries nothing else. The vault's name, which
  its owner chooses, isn't included, so it can't instruct the model.
- **It's advice.** The model can't move anything; the lending contract's rules decide what happens.
  It's told there is no NEAR price and not to compare the loan's NEAR with the collateral's dollar
  estimate.
- **The compose, not the weights.** The quote binds the docker compose each enclave runs, which pins
  every image by digest; NEAR AI's compose-manager in it loads the model. Bearer doesn't re-verify
  the model weights.

## On testnet

On 18 Nov 2026 the enclave check passed against NEAR AI Cloud from this machine and through the app
on vault No. 0027: three instances of `z-ai/glm-5.3-flash`, each Intel quote `UpToDate`, 24 NVIDIA
Hopper GPUs passed by NVIDIA, one signing key `0x3b753b44…fa0c`, in 4.8–7.7 s. The tamper tests in
`pnpm --filter web check:nearai` were caught: a replayed nonce, a changed compose, the debug bit set
(Intel then rejects the quote's signature), an unbound signing address, and reply signatures over
other hashes, by another key or by the gateway.

The same day, with a key, a real note on vault No. 0027's loan (1 NEAR lent, 1.05 back, overdue
since 13 Nov, 0.00006 tBTC of collateral): rated **higher** risk, "the vault is intact and sealed but
the loan is overdue and the collateral is only ~$6 of testnet tBTC". The enclaves were attested
first (all seven checks), and the reply's signature recovered to `0x3b753b44…fa0c` over
`z-ai/glm-5.3-flash:2cc3e01c…8e25:5e6d0a17…c3b5`; 26.8 s in all. The whole result, request and reply
bytes included, is in
[`apps/web/scripts/reports/risk-note-27-2026-11-18.json`](../../apps/web/scripts/reports/risk-note-27-2026-11-18.json),
and `check:nearai -- --verify` re-checks it offline: the hashes, the signed text, the signer and that
the note is the signed reply. A copy with "higher" edited to "lower" in the reply fails.

At GLM's default reasoning effort the same note took 75 s (817 reasoning tokens); the request sets
`reasoning_effort: "low"`, which brought it to about 12–15 s. NEAR AI ignored the other ways of
turning reasoning down that were tried.

## Try it

- `pnpm --filter web check:nearai`: the live attestation and the tamper tests, no key needed. With
  `NEAR_AI_API_KEY` in the environment, the repository's `.env` or `apps/web/.env.local`, add
  `-- --ask 27` to write a real note on vault No. 0027's loan.
- `pnpm --filter web check:nearai -- --verify scripts/reports/risk-note-27-2026-11-18.json`: the
  saved real note, checked offline.
- `pnpm dev`, open a pledged vault (`/v/27`) and press **Check the enclaves now**. With
  `NEAR_AI_API_KEY` in `apps/web/.env.local` (the app reads that file, not the repository's `.env`),
  **Get a risk note** works too.
- In the simulated demo the panel shows a labelled stand-in written by the page; no model is asked.

## Setup and cost

- `NEAR_AI_API_KEY` (server only, never `NEXT_PUBLIC_`): a NEAR AI Cloud key, from cloud.near.ai.
  Without it, only the enclave check runs.
- `NEAR_AI_MODEL`: another open model NEAR AI serves from its own TEEs, if wanted.
- Each note is kept for ten minutes per loan state, and an enclave check for a minute, so pressing
  again doesn't spend credits. Only loans that exist can be asked about.

## Files

- `apps/web/src/lib/nearai/attest.ts`: the attestation and signature checks.
- `apps/web/src/lib/nearai/risk-note.ts`: the facts, the prompt and the call.
- `apps/web/src/app/api/risk-note/route.ts`: the route.
- `apps/web/src/components/lend/risk-note.tsx`: the panel.
- `apps/web/scripts/nearai-check.mts`: the live check and the tamper tests.
- Threats A1–A8 in [docs/THREAT_MODEL.md](../THREAT_MODEL.md).
