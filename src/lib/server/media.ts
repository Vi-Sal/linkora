import { stat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { native, demux, binaries } from "./native";
import { Problem, limits } from "./config";
import { z } from "zod";
import type { Media, Quality, JobView } from "../models";
export type Track = {
  index: number;
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  tags?: { language?: string };
  disposition?: { attached_pic?: number };
};
export type Probe = {
  format: {
    duration?: string;
    size: string;
    format_name: string;
    tags?: { title?: string; artist?: string };
  };
  streams: Track[];
};
export async function probe(file: string, signal: AbortSignal): Promise<Probe> {
  const raw = await native(
    binaries.ffprobe,
    [
      "-v",
      "error",
      ...demux,
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      "-i",
      file,
    ],
    signal,
  );
  const p = JSON.parse(raw) as Probe;
  if (!p.streams?.length)
    throw new Problem(
      "INVALID_MEDIA_FILE",
      "This file contains no supported media tracks.",
    );
  if (Number(p.format.duration) > limits.duration)
    throw new Problem(
      "DURATION_LIMIT_EXCEEDED",
      "This file exceeds the server duration limit.",
    );
  if (p.streams.some((s) => (s.width || 0) * (s.height || 0) > 16777216))
    throw new Problem(
      "FORMAT_UNAVAILABLE",
      "This frame size exceeds the server processing limit.",
    );
  return p;
}
export async function thumbnail(
  file: string,
  duration: number,
  signal: AbortSignal,
) {
  const target = path.join(path.dirname(file), "preview.jpg");
  try {
    await native(
      binaries.ffmpeg,
      [
        "-nostdin",
        "-v",
        "error",
        ...demux,
        "-ss",
        String(Math.min(30, duration * 0.15)),
        "-threads",
        "1",
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=320:180:force_original_aspect_ratio=decrease",
        "-q:v",
        "5",
        "-threads",
        "1",
        "-fs",
        "131072",
        target,
      ],
      signal,
    );
    const data = await readFile(target);
    return data.length > 0 && data.length < 131072
      ? "data:image/jpeg;base64," + data.toString("base64")
      : undefined;
  } finally {
    await rm(target, { force: true });
  }
}
export function qualityOptions(
  height: number,
  hasVideo: boolean,
  audio: boolean,
  duration: number,
  copy: boolean,
  size?: number,
): Quality[] {
  const options: Quality[] = [];
  const maxHeight = Math.min(height, limits.height);
  if (hasVideo && (limits.heavy || (copy && height <= limits.height))) {
    for (const h of ["best", 1080, 720, 480, 360] as const) {
      const target = h === "best" ? maxHeight : h;
      if (target > maxHeight || (!limits.heavy && target !== height)) continue;
      options.push({
        id: "mp4-" + h,
        kind: "video",
        ext: "mp4",
        height: target,
        label: h === "best" ? "Best available" : target + "p",
        copy: copy && target === height,
        estimate: copy && target === height ? size : undefined,
      });
    }
  }
  if (audio) {
    for (const rate of [128, 192, 256, 320])
      options.push({
        id: "mp3-" + rate,
        kind: "audio",
        ext: "mp3",
        label: rate + " kbps MP3",
        rate,
        estimate: Math.round(duration * rate * 125),
      });
    for (const ext of ["m4a", "wav", "aac"])
      options.push({ id: ext, ext, kind: "audio", label: ext.toUpperCase() });
  }
  return options;
}
export function fromProbe(
  p: Probe,
  base: Pick<Media, "id" | "platform" | "title">,
): Media {
  const video = p.streams.find(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
    ),
    audio = p.streams.find((s) => s.codec_type === "audio");
  const duration = Number(p.format.duration) || 0,
    size = Number(p.format.size),
    height = video?.height || 0;
  const formats = qualityOptions(
    height,
    !!video,
    !!audio,
    duration,
    video?.codec_name === "h264" && (!audio || audio.codec_name === "aac"),
    size,
  );
  if (video && limits.heavy)
    for (const ext of ["webm", "mov"])
      formats.push({
        id: ext,
        kind: "video",
        ext,
        height: Math.min(height, limits.height),
        label: ext.toUpperCase(),
      });
  if (video)
    for (const ext of ["jpg", "png"])
      formats.push({ id: ext, kind: "image", ext, label: ext.toUpperCase() });
  for (const track of p.streams.filter(
    (s) =>
      s.codec_type === "subtitle" &&
      ["subrip", "ass", "ssa", "webvtt", "mov_text"].includes(s.codec_name),
  ))
    for (const ext of ["srt", "vtt"])
      formats.push({
        id: ext + "-" + track.index,
        kind: "subtitle",
        ext,
        track: track.index,
        label:
          (track.tags?.language || "Track " + (track.index + 1)) +
          " · " +
          ext.toUpperCase(),
      });
  if (
    !duration &&
    formats.some((f) => f.kind === "video" || f.kind === "audio")
  )
    throw new Problem(
      "INVALID_MEDIA_FILE",
      "The media must have a known, finite duration.",
    );
  return {
    ...base,
    title: p.format.tags?.title || base.title,
    creator: p.format.tags?.artist || "",
    duration,
    width: video?.width || 0,
    height,
    audio: !!audio,
    size,
    container: p.format.format_name,
    formats,
  };
}
export const editSchema = z
  .object({
    mode: z
      .enum([
        "export",
        "compress",
        "trim",
        "convert",
        "thumbnail",
        "subtitles",
        "resize",
        "audio",
      ])
      .default("export"),
    start: z.number().finite().min(0).default(0),
    end: z.number().finite().positive().optional(),
    volume: z.number().min(0).max(2).default(1),
    fadeIn: z.number().min(0).max(60).default(0),
    fadeOut: z.number().min(0).max(60).default(0),
    aspect: z.enum(["source", "16:9", "9:16", "1:1", "4:5"]).default("source"),
    fit: z.enum(["fit", "crop"]).default("fit"),
    compression: z.enum(["light", "balanced", "small"]).default("balanced"),
  })
  .strict();
export type Edit = z.infer<typeof editSchema>;
export function filename(title: string, q: Quality) {
  return (
    (title
      .normalize("NFKC")
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/[^\p{L}\p{N} _.-]/gu, "")
      .replace(/^[.\s]+/, "")
      .trim()
      .slice(0, 80) || "Linkora") +
    "-" +
    (q.height ? q.height + "p" : q.rate ? q.rate + "k" : "export") +
    "." +
    q.ext
  );
}
export function validateEdit(media: Media, q: Quality, e: Edit) {
  if (
    !["image", "subtitle"].includes(q.kind) &&
    (!media.duration ||
      e.start >= (e.end ?? media.duration) ||
      (e.end ?? media.duration) > media.duration + 0.001)
  )
    throw new Problem(
      "INVALID_RANGE",
      "Choose a time range within the source duration.",
    );
  if (
    e.mode === "thumbnail" &&
    (q.kind !== "image" || e.start >= media.duration)
  )
    throw new Problem("INVALID_RANGE", "Choose a frame within the video.");
  if (
    ["compress", "resize"].includes(e.mode) &&
    (!limits.heavy || q.kind !== "video")
  )
    throw new Problem(
      "EXPORT_DISABLED",
      "This operation requires video transcoding.",
    );
  if (e.mode === "trim" && q.kind === "video" && !limits.heavy)
    throw new Problem(
      "EXPORT_DISABLED",
      "Frame-accurate trimming requires video transcoding.",
    );
  if (e.fadeIn + e.fadeOut > (e.end ?? media.duration) - e.start)
    throw new Problem(
      "INVALID_RANGE",
      "Audio fades exceed the selected duration.",
    );
}
export async function processFile(
  files: string[],
  media: Media,
  q: Quality,
  e: Edit,
  out: string,
  signal: AbortSignal,
  progress: (p: Partial<JobView>) => void,
) {
  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-filter_threads",
    "1",
  ];
  for (const f of files) {
    args.push(...demux, "-threads", "1", "-i", f);
  }
  const dur = (e.end ?? media.duration) - e.start;
  if (e.start) args.push("-ss", String(e.start));
  if (e.end) args.push("-t", String(dur));
  const audioMap = files.length > 1 ? "1:a:0" : "0:a:0";
  const audioFx = [];
  if (e.volume !== 1) audioFx.push("volume=" + e.volume);
  if (e.fadeIn) audioFx.push("afade=t=in:d=" + e.fadeIn);
  if (e.fadeOut)
    audioFx.push("afade=t=out:st=" + (dur - e.fadeOut) + ":d=" + e.fadeOut);
  if (q.kind === "video") {
    args.push("-map", "0:v:0", "-map", audioMap + "?");
    const remux =
      q.copy &&
      e.mode !== "compress" &&
      e.mode !== "resize" &&
      !e.start &&
      !e.end &&
      !audioFx.length;
    if (remux) args.push("-c", "copy");
    else {
      if (!limits.heavy)
        throw new Problem(
          "EXPORT_DISABLED",
          "Video transcoding is disabled on this server.",
        );
      const h = Math.max(
        2,
        Math.floor((q.height || Math.min(media.height, limits.height)) / 2) * 2,
      );
      let filter = "scale=-2:" + h;
      if (e.mode === "resize" && e.aspect !== "source") {
        const [a, b] = e.aspect.split(":").map(Number);
        const w = Math.max(2, Math.round((h * a) / b / 2) * 2);
        filter =
          "scale=" +
          w +
          ":" +
          h +
          ":force_original_aspect_ratio=" +
          (e.fit === "crop"
            ? "increase,crop=" + w + ":" + h
            : "decrease,pad=" + w + ":" + h + ":(ow-iw)/2:(oh-ih)/2");
      }
      args.push("-vf", filter + ",setsar=1", "-pix_fmt", "yuv420p");
      if (q.ext === "webm")
        args.push(
          "-c:v",
          "libvpx-vp9",
          "-deadline",
          "realtime",
          "-cpu-used",
          "6",
          "-b:v",
          "0",
          "-crf",
          "34",
          "-c:a",
          "libopus",
        );
      else
        args.push(
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          e.mode === "compress"
            ? { light: "25", balanced: "29", small: "34" }[e.compression]
            : "22",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
        );
    }
    if (["mp4", "mov"].includes(q.ext)) args.push("-movflags", "+faststart");
  } else if (q.kind === "audio") {
    args.push(
      "-map",
      audioMap,
      "-vn",
      "-c:a",
      q.ext === "mp3" ? "libmp3lame" : q.ext === "wav" ? "pcm_s16le" : "aac",
    );
    if (q.ext !== "wav") args.push("-b:a", (q.rate || 192) + "k");
  } else if (q.kind === "image")
    args.push("-map", "0:v:0", "-frames:v", "1", "-an");
  else
    args.push(
      "-map",
      "0:" + q.track,
      "-c:s",
      q.ext === "srt" ? "subrip" : "webvtt",
    );
  if (audioFx.length && q.kind === "audio") args.push("-af", audioFx.join(","));
  args.push(
    "-map_metadata",
    "-1",
    "-metadata",
    "title=" + media.title.slice(0, 200),
    "-metadata",
    "artist=" + media.creator.slice(0, 200),
    "-threads",
    "1",
    "-fs",
    String(limits.maxFile),
    "-progress",
    "pipe:1",
    out,
  );
  let bytes = 0;
  await native(binaries.ffmpeg, args, signal, {
    line: (l) => {
      const [k, v] = l.split("=");
      if (k === "total_size" && Number(v) >= 0) bytes = Number(v);
      if (k === "out_time_us" && dur > 0)
        progress({
          ratio: Math.max(0, Math.min(1, Number(v) / 1e6 / dur)),
          bytes,
        });
    },
  });
  const size = (await stat(out)).size;
  if (!size || size >= limits.maxFile)
    throw new Problem(
      "FILE_TOO_LARGE",
      "Output reached the file size limit. Choose a smaller export.",
    );
  progress({ state: "FINALIZING", ratio: undefined, bytes: size });
  const result = await probe(out, signal);
  const s = result.streams;
  const type = {
    video: "video",
    audio: "audio",
    image: "video",
    subtitle: "subtitle",
  }[q.kind];
  if (
    !s.some((x) => x.codec_type === type) ||
    (q.ext === "mp3" && !s.some((x) => x.codec_name === "mp3")) ||
    (q.ext === "mp4" && !result.format.format_name.includes("mp4")) ||
    (["audio", "video"].includes(q.kind) &&
      Number(result.format.duration) < dur - Math.max(0.35, dur * 0.01))
  )
    throw new Problem(
      "FFMPEG_FAILED",
      "The output file failed final media validation.",
    );
  return { size, filename: filename(media.title, q), path: path.resolve(out) };
}
