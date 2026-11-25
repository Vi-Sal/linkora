import { stat } from "node:fs/promises";
import { limits, Problem } from "./config";
import { extractor } from "./native";
import { networks } from "./urls";
import type { JobView } from "../models";
export async function downloadTrack(
  f: { url: string; ext: string; http_headers?: Record<string, string> },
  platform: "YouTube" | "TikTok",
  file: string,
  signal: AbortSignal,
  progress: (p: Partial<JobView>) => void,
) {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.http_headers || {}))
    if (
      ["referer", "user-agent", "accept", "accept-language"].includes(
        k.toLowerCase(),
      )
    )
      headers[k] = v;
  const data = {
    id: "media",
    title: "media",
    extractor: "generic",
    extractor_key: "Generic",
    url: f.url,
    protocol: "https",
    ext: f.ext,
    http_headers: headers,
  };
  await extractor(
    [
      "--load-info-json",
      "-",
      "--no-simulate",
      "--no-part",
      "--no-mtime",
      "--max-filesize",
      String(limits.maxFile),
      "--progress",
      "--newline",
      "--progress-template",
      "download:LINKORA %(progress)j",
      "--output",
      file,
    ],
    networks[platform],
    signal,
    {
      input: JSON.stringify(data),
      line: (l) => {
        if (!l.startsWith("LINKORA ")) return;
        try {
          const p = JSON.parse(l.slice(8)),
            total = p.total_bytes || p.total_bytes_estimate;
          progress({
            bytes: p.downloaded_bytes,
            total,
            ratio: total ? Math.min(1, p.downloaded_bytes / total) : undefined,
            speed: p.speed,
            eta: p.eta,
          });
        } catch {}
      },
    },
  );
  const size = await stat(file).catch(() => null);
  if (!size?.size || size.size > limits.maxFile)
    throw new Problem(
      "FILE_TOO_LARGE",
      "The selected stream is unavailable within the file limit.",
    );
}
