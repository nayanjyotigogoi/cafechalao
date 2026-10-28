import type { Metadata, Viewport } from "next";
import { Eczar, Fraunces, IBM_Plex_Mono, Mukta, Sora } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

/* Fonts from the brand sheet: Eczar (headings), Mukta (UI, Hindi), IBM Plex Mono (prices, timers),
   Fraunces + Sora only for the CafeChalao lockup. */
const eczar = Eczar({ subsets: ["latin", "devanagari"], weight: ["600", "700", "800"], variable: "--font-eczar" });
const mukta = Mukta({ subsets: ["latin", "devanagari"], weight: ["400", "500", "600", "700"], variable: "--font-mukta" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });
const fraunces = Fraunces({ subsets: ["latin"], weight: ["600"], variable: "--font-fraunces" });
const sora = Sora({ subsets: ["latin"], weight: ["500"], variable: "--font-sora" });

/* No fixed <title>: each café's name is set from its settings (useTitle in TenantProvider). */
export const metadata: Metadata = {
  description: "Billing, kitchen, dine-in, delivery, stock, staff and reports for your café — in one app.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/brand/cafechalao-icon-small-light.svg" },
  appleWebApp: { capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#5E6B33",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${eczar.variable} ${mukta.variable} ${plex.variable} ${fraunces.variable} ${sora.variable} min-h-dvh antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
