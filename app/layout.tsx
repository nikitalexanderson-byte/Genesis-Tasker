import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./dark-theme.css";
import "./tablet-layout.css";
import "./universal-ui.css";
import "./web-standart.css";
import "./experimental-theme.css";
import "./layout-refinements.css";
import "./popup-surfaces.css";
import "./dark-palettes.css";
import "./daylight-surfaces.css";
import "./green-classic-surfaces.css";
import "./lunar-hero-web.css";
import { AppUrlCleaner } from "./AppUrlCleaner";
import { ButtonTooltips } from "./ButtonTooltips";
import { DialogDismissal } from "./DialogDismissal";
import { DialogHeaderActions } from "./DialogHeaderActions";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "Genesis Tasker",
      template: "%s · Genesis Tasker",
    },
    description:
      "GENESIS — календарь задач и менеджер проектов с планом дня, напоминаниями и необязательной синхронизацией Google Calendar и Google Tasks.",
    applicationName: "Genesis Tasker",
    authors: [{ name: "nikitalexanderson" }],
    manifest: "/manifest.webmanifest",
    category: "productivity",
    keywords: ["календарь", "планировщик", "эллинизм", "лунный календарь", "Genesis Tasker"],
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Genesis Tasker",
    },
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    openGraph: {
      title: "Genesis Tasker",
      description: "Календарь задач и менеджер проектов с синхронизацией Google Calendar и Google Tasks.",
      type: "website",
      url: origin,
      images: [{ url: `${origin}/og.png`, width: 1732, height: 899, alt: "GENESIS — сакральный календарь" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Genesis Tasker",
      description: "Календарь задач и менеджер проектов с синхронизацией Google Calendar и Google Tasks.",
      images: [`${origin}/og.png`],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07171b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body><AppUrlCleaner /><ButtonTooltips /><DialogDismissal /><DialogHeaderActions />{children}</body>
    </html>
  );
}
