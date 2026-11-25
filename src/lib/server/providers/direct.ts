import path from "node:path";
import { downloadTrack } from "../retrieve";
import { fromProbe, probe } from "../media";
import type { Source } from "../providers";
export async function directMedia(
  url: string,
  id: string,
  dir: string,
  signal: AbortSignal,
): Promise<Source> {
  const platform = "Direct link";
  const file = path.join(dir, "source");
  await downloadTrack({ url, ext: "bin" }, platform, file, signal, () => {});
  return {
    file,
    media: {
      ...fromProbe(await probe(file, signal), {
        id,
        title: decodeURIComponent(
          new URL(url).pathname.split("/").pop() || "Media",
        ),
        platform,
      }),
      page: url,
    },
  };
}
