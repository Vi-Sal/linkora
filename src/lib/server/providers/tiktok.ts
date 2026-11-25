import { requestPublic } from "../urls";
import type { PlatformProvider } from "./types";
// A downloadable rendition and the public post's download control must agree.
async function permitsTikTokDownload(url: string, signal: AbortSignal) {
  const { response } = await requestPublic(url, ["www.tiktok.com"], signal);
  let html = "";
  for await (const chunk of response) {
    html += chunk.toString();
    if (html.length > 4_000_000) {
      response.destroy();
      return false;
    }
  }
  const match = html.match(
    /<script[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return false;
  try {
    const post = JSON.parse(match[1])?.__DEFAULT_SCOPE__?.[
      "webapp.video-detail"
    ]?.itemInfo?.itemStruct;
    return (
      String(post?.id) === new URL(url).pathname.split("/").pop() &&
      [true, 1].includes(post?.itemControl?.videoCanDownload)
    );
  } catch {
    return false;
  }
}

export const tiktok: PlatformProvider = {
  name: "TikTok",
  authorization: () => undefined,
  acceptsRendition: (id) => /^download(?:_addr)?(?:-\d+)?$/.test(id),
  async downloadRestriction(url, signal) {
    return (await permitsTikTokDownload(url, signal).catch(() => false))
      ? undefined
      : "The public post does not confirm that the publisher enabled downloads.";
  },
};
