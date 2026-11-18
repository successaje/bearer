import { cardSvg } from "@/lib/nft/card-svg";
import { loadVault } from "@/lib/nft/load";

/**
 * GET /nft/mainnet/1.svg: a mainnet vault's `media`. The mainnet contract's `base_uri` is
 * `https://bearer-near.vercel.app/nft/mainnet`, fixed at deploy, so this path is where wallets look.
 * It reads NEAR mainnet on every request, like the testnet route beside it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const vault = await loadVault(file.replace(/\.svg$/, ""), { mainnet: true });
  if (!vault) return new Response("No such vault on mainnet", { status: 404 });
  return new Response(cardSvg(vault), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=30, s-maxage=30",
      "access-control-allow-origin": "*",
    },
  });
}
