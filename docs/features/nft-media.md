# Feature: a living token image, and link previews

**Branch:** `feat/nft-media` · **Routes:** `/nft/[id].svg`, `/v/[id]/opengraph-image` · **Status:** ready to review (one small contract change)

**For:** whoever decides whether this ships. What wallets and chat apps will show, the contract
change behind it, and how it was checked.

## What it is

- **The token's image follows its seal** (brief 3.3 Should #9). Each vault token's NEP-177
  `media` points at `/nft/{id}.svg` on the web app. That route reads the vault from the chain on
  every request and draws the card in its finish, with the wax seal **intact** while sealed and
  **split** once opened, plus a state line ("SEALED · 0 SIGNATURES EVER REQUESTED" or "OPENED ·
  CAN'T CHANGE HANDS"). Any NEAR wallet that shows NFT media shows the live state, with no further
  transactions.
- **Link previews.** `/v/[id]` gets an Open Graph image built from the same card: "Sealed. Nobody
  can have signed for it." or "Opened. It can't change hands.", and "Check the live seal before you
  accept it." That's what appears when a vault link is pasted into an OTC chat.

The SVG is self-contained (system fonts, inline gradients, no external references), so it works
inside an `<img>` and in wallets that sanitise SVG.

## The contract change

- `new(signer_id, config, base_uri: Option<String>)`: `base_uri` goes into the NFT contract
  metadata (NEP-177). It's optional, and existing callers keep working (no media).
- `create_vault` sets `media: "{id}.svg"` when `base_uri` is set. The `extra` field already
  switches from `{"state":"sealed"}` to `"opened"` in `break_seal`.
- No change to the contract's state struct. A new deployment is needed to set `base_uri`
  (`BEARER_MEDIA_BASE_URI` in `.env` for `pnpm spike:testnet setup`).

## Checked

- Sandbox: new test "points each token at a live image of its seal": media `{id}.svg`,
  `base_uri` set, `extra.state` sealed then opened. 27 sandbox tests and 21 unit tests pass;
  clippy is clean.
- Live, against `v3a.bearer-1108-ffb3.testnet` in testnet mode: `/nft/3.svg` sealed, `/nft/4.svg`
  and `/nft/2.svg` opened. Vault No. 0004 was opened by the Bitcoin withdrawal, and its image
  shows the broken seal. Unknown vaults return 404. The OG image renders at 1200 × 630.
- Production build passes.

## Notes

- In mock mode the server can't see the browser's mock state, so these routes serve the seeded
  demo vaults (42, 17, 29, 63, 51).
- `cache-control: max-age=30` keeps wallets close to the live state without hammering the RPC.
- The vault page and its Open Graph image live in a route group, `app/v/[id]/(card)/`. An
  `opengraph-image` applies to its segment and every page below it, so at `app/v/[id]/` it would
  also cover `/v/[id]/certificate` and `/v/[id]/handover`, and Next.js would report "URL data in
  `generateMetadata()`" on each. In the group it covers the vault page only, whose `PerRequest`
  marker (`await connection()` inside `<Suspense>`) keeps it per-request. A marker in a layout
  doesn't count; it has to be in the page.
