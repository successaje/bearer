# Card art: what a vault is for

The card is still the object you hold: it flips to show who held it, prints as a certificate and
hands over by QR code. What changes is its face. A vault's name can pick a category, and the card
draws that category's art: on the site, in the NFT image wallets show (`/nft/[id].svg`), and in the
link preview (`/v/[id]` Open Graph image).

| | Category | | Category |
|---|---|---|---|
| 🎁 | Gift | 💌 | Love letter (a link in a message) |
| 🎂 | Birthday | 🍕 | Pizza money (fun: 10,000 BTC once bought two pizzas) |
| 🏆 | Prize | 🚀 | To the moon (fun) |
| 🐷 | Savings | 💰 | Treasure (fun) |
| ⏳ | Time capsule | | No match: the classic card |

## How a vault picks one

The locked contract stores only a name (at most 32 bytes) and a finish, so the category comes from
the name (`apps/web/src/lib/vault/category.ts`):

1. **A leading emoji.** The create form's "What's it for?" puts it there: "🎂 Theo's birthday". It
   costs 4 or 5 of the 32 bytes, and the form counts bytes, as the contract does. Wallets and
   explorers show the emoji too.
2. **Otherwise, a few plain words**, matched whole: "1st Son College Fund" is savings, "A Bearer link"
   is a love letter, "Hackathon prize" is a prize.
3. **Otherwise**, the classic card.

The finish still sets the colours; the art brings its own, so every category reads on every finish.

## How it's drawn

`apps/web/src/lib/vault/category-art.ts`: one flat SVG per category in a 200 × 200 box, with no
fonts (the ₿ on coins is drawn with strokes) and no external references, so the same drawing works
in the page, in an `<img>` in a wallet, and when the link preview is rasterised on a server with no
system fonts. With art, the name wraps to two lines in the left half of the card.
