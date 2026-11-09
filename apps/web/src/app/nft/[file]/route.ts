import { cardSvg } from "@/lib/nft/card-svg";
import { loadVault } from "@/lib/nft/load";

/**
 * GET /nft/42.svg: the token's `media` (contract metadata `base_uri` + `42.svg`). It reads the
 * chain on every request, so wallets show the seal intact, then broken once the vault is opened.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const id = file.replace(/\.svg$/, "");
  const vault = await loadVault(id);
  if (!vault) return new Response("No such vault", { status: 404 });
  return new Response(cardSvg(vault), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // Short: the image follows the seal, and the seal can break at any moment.
      "cache-control": "public, max-age=30, s-maxage=30",
      "access-control-allow-origin": "*",
    },
  });
}
