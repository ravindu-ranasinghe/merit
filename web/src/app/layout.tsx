import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { AppFooter, AppHeader, AppMain } from "@/components/shell";
import { Providers } from "./providers";
import { AmbientField } from "@/components/ambient-field";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Merit: paid code review on GitHub", template: "%s · Merit" },
  description:
    "Maintainers fund a code-review reward before the review happens. A reviewer whose feedback the maintainer verifies led to a fix claims it. Testnet prototype.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="flex min-h-dvh flex-col" suppressHydrationWarning>
        <AmbientField />
        <Providers>
          <AppHeader />
          <AppMain>{children}</AppMain>
          <AppFooter />
        </Providers>
      </body>
    </html>
  );
}
