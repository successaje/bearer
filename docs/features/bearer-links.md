# Bearer links

A sealed vault sent as a link: `https://bearer-near.vercel.app/claim#<key>`. Whoever opens it holds
the vault, and whatever is at its Bitcoin, Base and Solana addresses. No wallet, no account, no
install. It's the shortest way to hand someone a vault, and it shows Bearer's point in one move:
passing the vault on leaves nothing behind for an old copy of the link.

## How it works

- **The key is the link.** The part after `#` is a 32-byte ed25519 seed (base58). Its NEAR
  implicit account (the public key in hex, 64 characters) owns the vault on `bearer.testnet` and
  holds a little NEAR for fees.
- **It never reaches a server.** Browsers don't send the part after `#` in requests or in the
  `Referer` header. `/claim` reads it, removes it from the address bar, and keeps it in the tab's
  `sessionStorage`, which ends when the tab closes.
- **The tab signs with it.** `apps/web/src/lib/vault/bearer-link.ts` builds, signs and sends NEAR
  transactions in the browser (Borsh, ed25519, `send_tx`). While a link is open, the app's wallet
  bridge uses it instead of near-connect. So every vault page works for the link holder: transfer,
  break the seal, withdraw. Connecting a real wallet, or "Forget this link", ends it.
- **No contract changed.** The locked contract sees an ordinary account owning an NFT. Nothing in
  Bearer's rules is new: the vault is sealed or it isn't.

## What the holder can do (`/claim`)

| | What happens | Afterwards |
|---|---|---|
| **Pass it on as a new link** | The page makes a new key, funds its account from this one, moves the vault to it, and sweeps what's left. It shows the new link and a QR code. | The old link is empty. Anyone holding a copy of it gets nothing. |
| **Send it to a NEAR account** | The site's transfer sheet, signed by the link: the seal check, then `nft_transfer`. | The vault is in that account. The link is empty. |
| **Break the seal and withdraw** | The vault's own page, as its owner: break the seal, then withdraw to any address. | The vault is opened and can't change hands again. |

A link whose vault has moved on says so: "This link is empty."

## Fees

NEAR takes a call's prepaid gas up front, at about ten times the base gas price, and refunds the
unused part a block later. On testnet on 2026-11-10 a 30 Tgas `nft_transfer` needed 0.031 NEAR
available (measured: `NotEnoughBalance … cost 30919635923605000000001`). Breaking the seal and
withdrawing Bitcoin is about 105 Tgas, so about 0.12 NEAR with the withdrawal deposit. Each link's
account gets 0.2 NEAR. "Pass it on" keeps 0.04 NEAR back to move the vault, then sweeps the rest
to the new link once the refund lands.

## Making links

`contracts/tests/spike/bearer-links.ts` (`pnpm spike:links`), with the test parent's key:

```bash
pnpm spike:links treasury            # once: an opened vault to pay the links from; prints its Bitcoin address
pnpm spike:links mint <count> <sats> # each: a sealed vault, handed to a fresh key's account, paid from the treasury
pnpm spike:links status              # which links still hold their vault
```

A vault withdrawal pays one address, so one withdrawal from a funded vault fills the treasury, and
the script pays each link from it, spending the change before it confirms. The keys are written to
`~/.near-credentials/bearer-links/` (owner-only), never to the repository or the terminal.

## Limits

- **A link is cash.** Anyone who sees it first can take the vault: share each one once, with one
  person. The page says this and offers the two ways to move it out. (Threat model T18; T13 covers an old copy after it moved on.)
- **The site is trusted while the link is open,** as with any web wallet: the page holds the key in
  the tab. The code is in this repository; the deployed contracts are locked either way.
- **Testnet only.** The links hold testnet coins.
