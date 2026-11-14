import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import type { ReactNode } from "react";
import { AppFooter, AppHeader } from "@/components/shell";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Merit: paid code review on GitHub", template: "%s · Merit" },
  description:
    "Maintainers fund a code-review reward before the review happens. A reviewer whose feedback the maintainer verifies led to a fix claims it. Testnet prototype.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <Providers>
          <AppHeader />
          <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-16 pt-6 sm:px-6">{children}</main>
          <AppFooter />
        </Providers>
      </body>
    </html>
  );
}
