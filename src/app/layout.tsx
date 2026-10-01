import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "レンジ表",
  description:
    "米国株ウォッチリストの終値が、直近20日の高値と安値のどこにあるかを見る表。読み取り専用。",
  applicationName: "レンジ表",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f0e7" },
    { media: "(prefers-color-scheme: dark)", color: "#12140f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={plexMono.variable} suppressHydrationWarning>
      <body className="antialiased">
        <Script id="range-theme" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem("range-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
