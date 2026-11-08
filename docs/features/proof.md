# Feature: the proof page

**Branch:** `feat/proof` · **Route:** `/proof` (linked in the header and footer) · **Status:** ready to review

**For:** whoever decides whether this ships. What the page shows, where every number comes from,
and how to keep it honest.

## What it is

"Don't trust us. Check." One page that gathers the evidence behind Bearer's claims, in the style
of an eval dashboard (braintrust.dev's bars, Bearer's gold):

1. **Live from NEAR testnet.** The reader's browser asks a public RPC (FastNEAR; both it and
   rpc.testnet.near.org allow cross-origin requests) about the contract, with no Bearer server in
   between: whether it is locked (full-access keys), its code hash, the MPC signer's version, how
   many vaults exist, and the chains and deposits it is configured with. Each card has a "Check it
   yourself" curl command.
2. **Signed by NEAR's MPC network.** One bar per real signing request on testnet: Base
   (`withdraw_evm`, N = 5, median line), Ed25519 (N = 5), Bitcoin (1–4 inputs, one run each, shown
   as a range rather than a median), Solana (N = 1). Each time links to its NEAR transaction.
3. **Where the withdrawals landed.** Base: confirmed on Base Sepolia, with its explorer link.
   Bitcoin: funded, waiting to broadcast. Solana: signed and verified, waiting for devnet SOL.
4. **Gas, measured.** Bitcoin's callback (reserved 30 Tgas vs 2.8–4.4 used) and the whole
   withdrawal vs NEAR's 300 Tgas limit.
5. **Every attack we know of.** T1–T17 from docs/THREAT_MODEL.md with the defence, the tests and a
   status: Proven, Partly, Not yet, By design.
6. **Run it yourself.** The commands for unit tests, sandbox tests and the testnet spike.

## Honesty

- Every measured number is generated from the committed spike reports in
  `contracts/tests/spike/reports` (the file is named in each series' `source`); nothing was typed
  in by hand. When a report changes, regenerate `apps/web/src/lib/proof/data.ts`'s runs from it.
- The live "Contract locked" card says **Not locked yet** today: the spike deployment
  (`v3a.bearer-1108-ffb3.testnet`) still has a full-access key. It turns green only when the
  locked deploy removes it (brief 4.10). Point `NEXT_PUBLIC_PROOF_CONTRACT` at the locked account.
- Statuses come from the threat model; a row is Proven only when its test passes. Partly and Not
  yet are shown as plainly as Proven.
- Latency includes up to half a second of polling, as docs/SPIKES.md says.

## Try it

`pnpm dev`, open `/proof`, and press **Run the checks again**. Open a "Check it yourself" command in
a terminal and compare. Checked at 1440 px and 390 px, dark and light.

## Files

- `apps/web/src/app/proof/page.tsx`: the page.
- `apps/web/src/components/proof/{live-checks,charts,threat-table}.tsx`.
- `apps/web/src/lib/proof/data.ts`: measured data and the threat table; `live.ts`: the RPC checks.
- Header, footer and sitemap gain a "Proof" link.

## Later

- Show the Bitcoin and Solana broadcasts here once they land (update `LANDED`).
- A CI job that regenerates `data.ts` from the reports, so the page can't drift.
