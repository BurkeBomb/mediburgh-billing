import type { Metadata } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/app/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "Mediburgh Billing System",
  description: "Continuous real-time clinical claim capture and administration engine",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-[#0b0f14]">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0b0f14" />
      </head>
      <body className="h-full font-sans antialiased text-slate-100 selection:bg-teal-500/30 selection:text-teal-200">
        {/* Core Layout Content Mount Checkpoint */}
        <div className="relative min-h-screen flex flex-col">
          {children}
        </div>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
