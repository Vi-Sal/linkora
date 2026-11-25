import type { Metadata, Viewport } from "next";
import { Shell } from "@/components/Shell";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Linkora — Media, beautifully simplified.",
    template: "%s · Linkora",
  },
  description:
    "Preview, convert, trim and export permitted media in a glacier-inspired workspace.",
  icons: { icon: "/assets/logo.svg", apple: "/icons/icon-192.png" },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Linkora",
    description: "Media, beautifully simplified.",
    images: ["/brand/linkora.png"],
  },
  metadataBase: new URL(
    process.env.SITE_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      "http://localhost:10000",
  ),
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme:light)", color: "#f0f9ff" },
    { media: "(prefers-color-scheme:dark)", color: "#0f172a" },
  ],
};
const init =
  "try{var p=JSON.parse(localStorage.getItem('linkora.preferences')||'{}'),d=document.documentElement;d.dataset.theme=p.theme==='dark'||p.theme!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.dataset.motion=p.motion?'reduce':'system';d.dataset.opaque=String(!!p.opaque);d.lang=p.language==='km'?'km':'en'}catch{}";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: init }} />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
