import { notFound } from "next/navigation";
import { Pages } from "@/components/Pages";
import { limits } from "@/lib/server/config";
import { routes } from "@/lib/routes";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string[] }> };
export async function generateMetadata({ params }: Props) {
  const p = "/" + (await params).slug.join("/");
  return {
    title: routes[p] || "Linkora",
    alternates: process.env.SITE_URL ? { canonical: p } : undefined,
  };
}
export default async function Page({ params }: Props) {
  const path = "/" + (await params).slug.join("/");
  if (!Object.hasOwn(routes, path)) notFound();
  return <Pages path={path} limits={limits} />;
}
