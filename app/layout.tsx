import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdSpark — Creative Automation for Social Ad Campaigns",
  description:
    "AI-powered creative automation platform. Generate, manage, and optimize ad creatives across social platforms.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
