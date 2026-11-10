import { ImageResponse } from "next/og";
import { cardSvg, cardText } from "@/lib/nft/card-svg";
import { loadVault } from "@/lib/nft/load";

export const alt = "A Bearer vault: its card and its seal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The link preview for a vault page: the card as it is now, and what the seal says. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vault = await loadVault(id);
  const opened = vault?.state.kind === "opened";
  // The server that rasterises this has no system fonts, so the SVG brings the shapes and the
  // card's words are drawn below with the image renderer's own font.
  const card = vault ? `data:image/svg+xml;base64,${Buffer.from(cardSvg(vault, { text: false })).toString("base64")}` : null;
  const words = vault ? cardText(vault) : null;
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
        {card && words ? (
          // The card is 600 × 378 in the SVG, drawn here at 0.9 scale.
          <div style={{ display: "flex", position: "relative", width: 540, height: 340, borderRadius: 28, boxShadow: "0 40px 80px rgba(0,0,0,0.6)" }}>
            <img src={card} width={540} height={340} alt="" style={{ position: "absolute", top: 0, left: 0 }} />
            <div style={{ position: "absolute", left: 33, top: 37, fontSize: 15, fontWeight: 600, letterSpacing: 4, lineHeight: 1, color: words.muted }}>BEARER</div>
            <div style={{ position: "absolute", left: 33, top: 164 - (words.lines.length - 1) * 16, display: "flex", flexDirection: "column" }}>
              {words.lines.map((l) => (
                <div key={l} style={{ fontSize: words.lines.length > 1 ? 26 : 29, fontWeight: 500, lineHeight: 1.12, color: words.text }}>
                  {l}
                </div>
              ))}
              <div style={{ marginTop: 8, fontSize: 16, lineHeight: 1, color: words.muted }}>{words.serial}</div>
            </div>
            <div
              style={{
                position: "absolute",
                left: 33,
                top: 277,
                height: 31,
                display: "flex",
                alignItems: "center",
                padding: "0 14px",
                borderRadius: 16,
                border: `1px solid rgba(${words.pill.rgb},0.55)`,
                backgroundColor: `rgba(${words.pill.rgb},0.18)`,
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: 1.1,
                color: words.pill.color,
              }}
            >
              {words.state}
            </div>
          </div>
        ) : null}
      </div>
    ),
    size,
  );
}
