import path from "node:path";
import type { Readable } from "node:stream";
import { fromProbe, probe } from "../media";
import { storeStream } from "../storage";
import type { Source } from "../providers";
export async function localMedia(
  input: { name: string; body: Readable },
  id: string,
  dir: string,
  cap: number,
  signal: AbortSignal,
): Promise<Source> {
  const file = path.join(dir, "source");
  await storeStream(input.body, file, cap, signal);
  return {
    file,
    media: fromProbe(await probe(file, signal), {
      id,
      platform: "Local file",
      title: input.name,
    }),
  };
}
