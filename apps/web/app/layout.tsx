import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountControls } from "../components/account-controls";
import "./globals.css";
export const metadata: Metadata = {
  title: "Raahi — Make room for someone real",
  description:
    "Intentional connections for adults in India. Raahi is in development.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <AccountControls />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
