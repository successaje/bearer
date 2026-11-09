# Feature: printable bearer certificate

**Branch:** `feat/certificate` · **Route:** `/v/[id]/certificate` · **Status:** ready to review

**For:** whoever decides whether this ships. What it is, why it fits Bearer, how to try it, and
what it deliberately does not claim.

## What it is

A one-page certificate for any vault, styled after an old bearer bond and printable on A4
landscape (or saved as PDF from the print dialog). Brief 3.3 lists it as a Should (#10) and 10.2
as signature moment 5.

It shows, as of the moment it's printed:

- the vault's serial (`No. 0042`), name and issue date;
- the seal, with the state written out ("Unopened · no signature has ever been requested") and a
  timestamp;
- three bond-style **coupons** with what each chain held (observed, with the dollar estimate
  labelled "est.");
- the Bitcoin, Base and Solana deposit addresses, grouped in fours;
- the **endorsements**: the custody log as "Pay to … / Held by …" lines;
- a QR code to the live vault page, captioned "Scan to check the live seal".

The frame, corner rosettes and watermark are guilloche drawn with math (hypotrochoids and
phase-shifted sine waves, `components/certificate/guilloche.tsx`): no images, so it prints
crisply at any size. A line of microprint runs along the bottom, as on banknotes. The display
serif (Instrument Serif) is loaded for this page only.

## Honesty

A certificate is the kind of object people mistake for the thing itself, so the page says plainly,
on the paper and beside it:

- "This paper does not hold the vault: the NEAR token does."
- Everything on it is a snapshot with a timestamp; the QR goes to the live page.
- Testnet prototype, not audited, not a security, not financial advice.
- Values are observed and marked "est."; in mock mode the issue line says "(simulated)".

## Try it

1. `pnpm dev`, open `/v/42` and click **Print a bearer certificate** (under the value), or go to
   `/v/42/certificate` directly.
2. **Print or save as PDF.** Header, footer and toolbar are hidden; the certificate fills one A4
   landscape page with exact colours (`print-color-adjust: exact`).
3. Try an opened vault (`/v/29`): the seal is broken and the state line changes.

Checked: one A4 landscape page from headless Chrome's print path (842 × 595 pt); dark and light
themes (the paper stays ivory in both, as a printed object should); 390 px phones, where it
scales to fit with a "turn your phone sideways" hint.

## Files

- `apps/web/src/app/v/[id]/certificate/page.tsx`: route.
- `apps/web/src/components/certificate/certificate-view.tsx`: the certificate and toolbar.
- `apps/web/src/components/certificate/guilloche.tsx`: frame, rosettes, watermark.
- `apps/web/src/app/globals.css`: `@media print` rules.
- `site-header.tsx`, `site-footer.tsx`: `print:hidden`.
- `vault-detail-view.tsx`: the entry link.

## Later

- A claim QR next to the vault QR, if claim links ship (brief 3.3 #8).
- Letter-size variant (`@page size: letter landscape`) chosen from the toolbar.
