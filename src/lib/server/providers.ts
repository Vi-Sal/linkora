import { directMedia } from "./providers/direct";
import { youtube } from "./providers/youtube";
import { tiktok } from "./providers/tiktok";
import path from "node:path";
import { downloadTrack } from "./retrieve";
import { z } from "zod";
import { limits, Problem } from "./config";
import { normalize, networks, requestPublic, urlOf } from "./urls";
import { extractor } from "./native";
import { fromProbe, probe, qualityOptions } from "./media";
import type { Media, Quality } from "../models";
const format = z.object({
  format_id: z.string(),
  url: z.string(),
  protocol: z.string().optional(),
  vcodec: z.string().nullish(),
  acodec: z.string().nullish(),
  ext: z.string(),
  height: z.number().nullish(),
  width: z.number().nullish(),
  tbr: z.number().nullish(),
  filesize: z.number().nullish(),
  filesize_approx: z.number().nullish(),
  has_drm: z.union([z.boolean(), z.string()]).nullish(),
  http_headers: z.record(z.string(), z.string()).optional(),
});
type Format = z.infer<typeof format>;
const info = z.object({
  id: z.string(),
  title: z.string(),
  uploader: z.string().nullish(),
  channel: z.string().nullish(),
  thumbnail: z.string().nullish(),
  duration: z.number().nullish(),
  availability: z.string().nullish(),
  is_live: z.boolean().nullish(),
  age_limit: z.number().nullish(),
  formats: z.array(format).optional(),
  has_drm: z.boolean().nullish(),
  subtitles: z
    .record(
      z.string(),
      z.array(z.object({ url: z.string(), ext: z.string().optional() })),
    )
    .nullish(),
});
export type Source = {
  media: Media;
  file?: string;
  tracks?: Format[];
  captions?: Record<string, string>;
};
function safeImage(v: unknown) {
  try {
    return typeof v === "string" ? urlOf(v).href : undefined;
  } catch {
    return undefined;
  }
}
async function preview(
  url: string,
  platform: Media["platform"],
  signal: AbortSignal,
): Promise<{
  title: string;
  creator: string;
  thumb?: string;
  duration: number;
}> {
  const services: Record<string, string> = {
    YouTube: "https://www.youtube.com/oembed",
    TikTok: "https://www.tiktok.com/oembed",
    Vimeo: "https://vimeo.com/api/oembed.json",
    SoundCloud: "https://soundcloud.com/oembed",
  };
  const endpoint = new URL(services[platform]);
  endpoint.search = new URLSearchParams({ url, format: "json" }).toString();
  const { response } = await requestPublic(
    endpoint.href,
    [endpoint.hostname],
    signal,
  );
  let data = "";
  for await (const chunk of response) {
    data += chunk.toString();
    if (data.length > 262144) {
      response.destroy();
      throw new Problem(
        "EXTRACTION_FAILED",
        "The provider returned too much metadata.",
      );
    }
  }
  const d = z
    .object({
      title: z.string(),
      author_name: z.string().optional(),
      thumbnail_url: z.string().optional(),
      duration: z.number().optional(),
    })
    .parse(JSON.parse(data));
  return {
    title: d.title,
    creator: d.author_name || "",
    thumb: safeImage(d.thumbnail_url),
    duration: d.duration || 0,
  };
}
export async function analyzeUrl(
  value: string,
  id: string,
  dir: string,
  signal: AbortSignal,
): Promise<Source> {
  let source = normalize(value);
  if (source.short) {
    const r = await requestPublic(
      source.url,
      [
        "www.tiktok.com",
        "m.tiktok.com",
        "tiktok.com",
        "vm.tiktok.com",
        "vt.tiktok.com",
      ],
      signal,
    );
    r.response.destroy();
    source = normalize(r.final);
    if (source.short)
      throw new Problem(
        "INVALID_URL",
        "TikTok did not resolve this short link to a video.",
      );
  }
  const { url, platform } = source;
  if (platform === "Direct link") return directMedia(url, id, dir, signal);
  const base = {
    id,
    platform,
    page: url,
    formats: [],
    width: 0,
    height: 0,
    audio: false,
    duration: 0,
  };
  async function restricted(error: Problem): Promise<Source> {
    try {
      return {
        media: {
          ...base,
          ...(await preview(url, platform, signal)),
          reason: error.message,
          code: error.code,
        },
      };
    } catch {
      throw error;
    }
  }
  if (platform !== "TikTok" && platform !== "YouTube")
    return restricted(
      new Problem(
        "EXPORT_NOT_PERMITTED",
        "This provider supplies preview metadata. A permitted download integration is unavailable.",
      ),
    );
  const provider = platform === "YouTube" ? youtube : tiktok;
  const restriction = provider.authorization(url);
  if (restriction)
    return restricted(new Problem("EXPORT_NOT_PERMITTED", restriction));
  let d: z.infer<typeof info>;
  try {
    d = info.parse(
      JSON.parse(
        await extractor(
          ["--dump-single-json", "--skip-download", "--", url],
          networks[platform],
          signal,
        ),
      ),
    );
  } catch (e) {
    return restricted(
      e instanceof Problem
        ? e
        : new Problem(
            "EXTRACTION_FAILED",
            "The provider did not return usable media metadata.",
          ),
    );
  }
  const metadata = {
    ...base,
    title: d.title,
    creator: d.uploader || d.channel || "",
    thumb: safeImage(d.thumbnail),
    duration: d.duration || 0,
  };
  const deny = (reason: string, code = "EXPORT_NOT_PERMITTED") => ({
    media: { ...metadata, reason, code },
  });
  if (
    d.has_drm ||
    d.is_live ||
    (d.age_limit || 0) >= 18 ||
    (d.availability && !["public", "unlisted"].includes(d.availability))
  )
    return deny(
      "This media is live, protected, or requires restricted access.",
    );
  if (!d.duration || d.duration > limits.duration)
    return deny(
      "The duration is unknown or exceeds the server limit.",
      "DURATION_LIMIT_EXCEEDED",
    );
  const allowed = networks[platform];
  let tracks = (d.formats || []).filter((f) => {
    let u: URL;
    try {
      u = urlOf(f.url);
    } catch {
      return false;
    }
    return (
      !f.has_drm &&
      f.protocol === "https" &&
      allowed.some((h) => u.hostname === h || u.hostname.endsWith("." + h)) &&
      (f.filesize || f.filesize_approx || 0) <= limits.maxFile &&
      provider.acceptsRendition(f.format_id)
    );
  });
  if (!tracks.length)
    return deny(
      platform === "TikTok"
        ? "TikTok did not supply an eligible publisher download rendition."
        : "YouTube did not supply an eligible unprotected HTTPS rendition.",
    );
  const denied = await provider.downloadRestriction?.(url, signal);
  if (denied) return deny(denied);
  // Check the small set of renditions actually needed by the advertised presets.
  const candidates = new Set<Format>();
  const hasPicture = tracks.some((f) => f.vcodec && f.vcodec !== "none");
  const height = Math.max(0, ...tracks.map((f) => f.height || 0));
  const hasSound = tracks.some((f) => f.acodec && f.acodec !== "none");
  const candidatesFor = qualityOptions(
    height,
    hasPicture,
    hasSound,
    d.duration,
    true,
  );
  const provisional: Source = {
    media: { ...metadata, formats: candidatesFor },
    tracks,
  };
  for (const option of candidatesFor)
    for (const f of selectedTracks(provisional, option)) candidates.add(f);
  const verified: Format[] = [];
  let failure = "The publisher download could not be validated.";
  for (const f of candidates) {
    const h: Record<string, string> = { Range: "bytes=0-1023" };
    for (const [k, v] of Object.entries(f.http_headers || {}))
      if (["user-agent", "referer"].includes(k.toLowerCase())) h[k] = v;
    try {
      const { response } = await requestPublic(
        f.url,
        [new URL(f.url).hostname],
        AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        2,
        h,
      );
      const length = Number(
        response.headers["content-range"]?.split("/").pop() ||
          response.headers["content-length"],
      );
      try {
        if (length > limits.maxFile) {
          failure = "The media exceeds the server file limit.";
          continue;
        }
        if (
          !/^(video|audio)\/|application\/octet-stream/i.test(
            response.headers["content-type"] || "",
          )
        )
          continue;
        for await (const chunk of response) {
          if (chunk.length) {
            if (
              Number.isFinite(length) &&
              length > 0 &&
              (response.statusCode === 200 || response.headers["content-range"])
            )
              f.filesize = length;
            verified.push(f);
          }
          break;
        }
      } finally {
        response.destroy();
      }
    } catch (e) {
      signal.throwIfAborted();
      if (e instanceof Problem) failure = e.message;
    }
  }
  if (!verified.length) return deny(failure, "FORMAT_UNAVAILABLE");
  tracks = verified;
  const sourceVideo = tracks
      .filter((f) => f.vcodec && f.vcodec !== "none")
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0],
    audio = tracks.some((f) => f.acodec && f.acodec !== "none");
  const media = {
    ...metadata,
    width: sourceVideo?.width || 0,
    height: sourceVideo?.height || 0,
    audio,
    formats: qualityOptions(
      sourceVideo?.height || 0,
      !!sourceVideo,
      audio,
      d.duration,
      true,
    ),
  };
  media.formats = media.formats.filter((option) => {
    if (option.kind !== "video") return true;
    const chosen = selectedTracks({ media, tracks }, option);
    const v = chosen[0];
    const a = chosen[1] || v;
    option.copy =
      v.height === option.height &&
      /^(avc|h264)/i.test(v.vcodec || "") &&
      (a.acodec === "none" || /^(aac|mp4a)/i.test(a.acodec || ""));
    if (
      option.copy &&
      chosen.every((track) => track.filesize || track.filesize_approx)
    ) {
      option.estimate = chosen.reduce(
        (n, track) => n + (track.filesize || track.filesize_approx || 0),
        0,
      );
    }
    return (
      (limits.heavy || option.copy) &&
      (!option.estimate || option.estimate < limits.maxFile)
    );
  });
  if (platform === "TikTok" && sourceVideo && !sourceVideo.height) {
    try {
      const file = path.join(dir, "source");
      await downloadTrack(sourceVideo, platform, file, signal, () => {});
      const actual = fromProbe(await probe(file, signal), {
        id,
        platform,
        title: d.title,
      });
      return {
        file,
        media: {
          ...actual,
          page: url,
          thumb: metadata.thumb,
          creator: metadata.creator,
        },
      };
    } catch (e) {
      signal.throwIfAborted();
      return deny(
        e instanceof Problem
          ? e.message
          : "The publisher download could not be validated.",
        e instanceof Problem ? e.code : "EXTRACTION_FAILED",
      );
    }
  }
  const captions: Record<string, string> = {};
  if (sourceVideo)
    for (const ext of ["png", "jpg"])
      media.formats.push({
        id: ext,
        kind: "image",
        ext,
        label: ext.toUpperCase(),
      });
  for (const [lang, choices] of Object.entries(d.subtitles || {}).slice(
    0,
    64,
  )) {
    if (!/^[a-zA-Z0-9_-]{1,24}$/.test(lang)) continue;
    const cap = choices.find((c) => {
      try {
        const u = urlOf(c.url);
        return (
          ["vtt", "srt"].includes(c.ext || "") &&
          allowed.some((h) => u.hostname === h || u.hostname.endsWith("." + h))
        );
      } catch {
        return false;
      }
    });
    if (cap) {
      captions[lang] = cap.url;
      for (const ext of ["srt", "vtt"])
        media.formats.push({
          id: "caption-" + lang + "-" + ext,
          kind: "subtitle",
          ext,
          language: lang,
          track: 0,
          label: lang + " · " + ext.toUpperCase(),
        });
    }
  }
  if (!media.formats.length)
    return deny(
      "The available tracks cannot produce an enabled output format.",
      "FORMAT_UNAVAILABLE",
    );
  return { media, tracks, captions };
}
export function selectedTracks(source: Source, q: Quality) {
  const tracks = source.tracks || [],
    audio = tracks
      .filter((f) => f.acodec && f.acodec !== "none")
      .sort(
        (a, b) =>
          Number(a.vcodec !== "none") - Number(b.vcodec !== "none") ||
          Number(/^mp4a|aac/i.test(b.acodec || "")) -
            Number(/^mp4a|aac/i.test(a.acodec || "")) ||
          (b.tbr || 0) - (a.tbr || 0),
      )[0];
  if (q.kind === "audio") return [audio].filter(Boolean);
  const video = tracks
    .filter(
      (f) =>
        f.vcodec && f.vcodec !== "none" && (f.height || 0) >= (q.height || 0),
    )
    .sort(
      (a, b) =>
        (a.height || 0) - (b.height || 0) ||
        Number(b.acodec !== "none") - Number(a.acodec !== "none") ||
        Number(/^avc|h264/i.test(b.vcodec || "")) -
          Number(/^avc|h264/i.test(a.vcodec || "")) ||
        (b.tbr || 0) - (a.tbr || 0),
    )[0];
  if (!video)
    throw new Problem(
      "FORMAT_UNAVAILABLE",
      "The selected resolution is unavailable.",
    );
  return video.acodec === "none" && audio ? [video, audio] : [video];
}
