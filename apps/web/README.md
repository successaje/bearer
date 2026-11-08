# Bearer web app

Next.js 16 (App Router), Tailwind CSS 4, Radix primitives, TanStack Query.

```bash
pnpm install          # from the repo root
pnpm dev              # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm build
```

## Modes

`NEXT_PUBLIC_NETWORK=mock` (default) runs against an in-browser mock of the contract with seeded demo
cards and demo accounts (ada, tunde, mira). Its state persists in localStorage. Everything simulated is labelled
SIMULATED. `testnet` is wired through the same `BearerClient` interface (`src/lib/bearer/client.ts`) and will use
`@bearer/sdk` once it exists.

## Map

- `src/app`: routes: `/`, `/cards`, `/create`, `/c/[id]`, `/claim`, `/verify`, `/how`, plus 404, error, icon, robots, sitemap.
- `src/lib/bearer`: types, seal rules (`seal.ts`), client interface, mock client and seed data, React Query hooks.
- `src/components`: brand (seal, chain icons), card views, sheets (hand over, open, list, fund), layout, theme, wallet.

## Themes

Light, dark and system, stored in localStorage (`bearer:theme`) and applied by an inline script before first paint.
Colors are CSS variables in `src/app/globals.css`; components use semantic classes (`bg-surface`, `text-fg-2`, …).
Six card finishes live in `src/components/card/bearer-card.tsx`.
