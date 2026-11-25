import path from "node:path";
import { limits } from "../config";
import { storeStream } from "../storage";
import { requestPublic } from "../urls";
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
  const { response } = await requestPublic(url, null, signal);
  await storeStream(response, file, limits.maxFile, signal);
  const filename = new URL(url).pathname.split("/").pop() || "Media";
  let title = filename;
  try {
    title = decodeURIComponent(filename);
  } catch {
    // Keep the original filename when it contains invalid percent escapes.
  }
  return {
    file,
    media: {
      ...fromProbe(await probe(file, signal), {
        id,
        title,
        platform,
      }),
      page: url,
    },
  };
}
