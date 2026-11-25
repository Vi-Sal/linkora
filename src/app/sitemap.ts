import { routes } from "@/lib/routes";
import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL;
  return site
    ? Object.keys(routes).map((p) => ({ url: new URL(p, site).href }))
    : [];
}
