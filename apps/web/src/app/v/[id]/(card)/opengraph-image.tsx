import { ImageResponse } from "next/og";
import { cardSvg } from "@/lib/nft/card-svg";
import { loadVault } from "@/lib/nft/load";

export const alt = "A Bearer vault: its card and its seal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The link preview for a vault page: the card as it is now, and what the seal says. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vault = await loadVault(id);
  const opened = vault?.state.kind === "opened";
  const card = vault ? `data:image/svg+xml;base64,${Buffer.from(cardSvg(vault)).toString("base64")}` : null;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 80px",
          background: "radial-gradient(70% 90% at 75% 45%, rgba(201,162,39,0.22), #0b0b0f 70%)",
          backgroundColor: "#0b0b0f",
          color: "#f4f4f5",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 470 }}>
          <div style={{ fontSize: 22, letterSpacing: 6, color: "#e8cd7a" }}>BEARER</div>
          <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.05, marginTop: 24, letterSpacing: -2 }}>
            {vault ? (opened ? "Opened. It can't change hands." : "Sealed. Nobody can have signed for it.") : "A sealed vault you can hand to anyone."}
          </div>
          <div style={{ fontSize: 26, color: "#a1a1aa", marginTop: 24, lineHeight: 1.35 }}>
            {vault ? "Check the live seal before you accept it." : "Native Bitcoin, Base and Solana, on NEAR."}
          </div>
        </div>
        {card ? (
          <img src={card} width={540} height={340} alt="" style={{ borderRadius: 28, boxShadow: "0 40px 80px rgba(0,0,0,0.6)" }} />
        ) : null}
      </div>
    ),
    size,
  );
}
