import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BrandDefs } from "@/components/brand/brand-defs";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Providers } from "@/components/providers";
import { themeScript } from "@/components/theme/theme-provider";
import { SITE_URL } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const description =
  "Bitcoin that changes hands without a Bitcoin transaction. A sealed vault of native Bitcoin, Base and Solana moves to its next owner in one NEAR transaction, and they can check nothing was ever signed for it.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Bearer · Sealed until opened", template: "%s · Bearer" },
  description,
  applicationName: "Bearer",
  openGraph: {
    type: "website",
    siteName: "Bearer",
    title: "Bearer · Sealed until opened",
    description,
  },
  twitter: { card: "summary_large_image", title: "Bearer · Sealed until opened", description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0f" },
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-[60] rounded-control bg-gold px-4 py-2 font-medium text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <BrandDefs />
        <Providers>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
