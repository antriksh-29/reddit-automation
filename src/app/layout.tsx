import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reddit Lead Intelligence",
  description:
    "Monitor Reddit for relevant posts, analyze threads with AI, and draft contextual responses.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Fonts from DESIGN-SYSTEM.md: Satoshi (display), DM Sans (body), Geist (data), JetBrains Mono (code) */}
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@700,500&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Geist:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-bg-primary text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
