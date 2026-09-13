import type { Metadata, Viewport } from "next";
import { Archivo, Archivo_Black, IBM_Plex_Mono } from "next/font/google";
import { BRAND_ACCENT, BRAND_NAME } from "@/lib/config";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-body" });
const archivoBlack = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: "Motor de clips y tracker de métricas para podcasts",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // El color de acento es el único token de marca: se inyecta como variable CSS.
  const accent = /^#[0-9a-fA-F]{6}$/.test(BRAND_ACCENT) ? BRAND_ACCENT : "#ff6a00";
  return (
    <html lang="es" style={{ ["--accent" as string]: accent }}>
      <body className={`${archivo.variable} ${archivoBlack.variable} ${plexMono.variable}`}>{children}</body>
    </html>
  );
}
