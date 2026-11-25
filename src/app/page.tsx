import { Pages } from "@/components/Pages";
import { limits } from "@/lib/server/config";
export const dynamic = "force-dynamic";
export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Linkora",
            applicationCategory: "MultimediaApplication",
            operatingSystem: "Web browser",
          }),
        }}
      />
      <Pages path="/" limits={limits} />
    </>
  );
}
