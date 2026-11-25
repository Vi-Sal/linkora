import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { Problem } from "./config";
export async function storeStream(
  readable: Readable,
  file: string,
  cap: number,
  signal: AbortSignal,
) {
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _, cb) {
      size += chunk.length;
      cb(
        size > cap
          ? new Problem(
              "FILE_TOO_LARGE",
              "The media exceeds the server file limit.",
              413,
            )
          : null,
        chunk,
      );
    },
  });
  await pipeline(
    readable,
    limiter,
    createWriteStream(file, { flags: "wx", mode: 0o600 }),
    { signal },
  );
  return size;
}
