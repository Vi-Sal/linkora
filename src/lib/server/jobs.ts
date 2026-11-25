import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readdir, rm, stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { config, limits, Problem, problem } from "./config";
import { storeStream } from "./storage";
import { downloadTrack } from "./retrieve";
import { localMedia } from "./providers/local";
import { requestPublic } from "./urls";
import { native, extractor, binaries } from "./native";
import { analyzeUrl, selectedTracks, type Source } from "./providers";
import {
  probe,
  thumbnail,
  processFile,
  validateEdit,
  type Edit,
} from "./media";
import { terminal, type JobView, type Quality } from "../models";
type Entry = {
  id: string;
  dir: string;
  owner: string;
  source: Source;
  expires: number;
  refs: number;
  disk: number;
};
export type Job = {
  view: JobView;
  owner: string;
  entry: Entry;
  format: Quality;
  edit: Edit;
  dir: string;
  ctl: AbortController;
  events: EventEmitter;
  disk: number;
  readers: number;
  output?: string;
  expiry?: NodeJS.Timeout;
};
const age = () => Date.now() + limits.ttl * 1000;
export class Engine {
  entries = new Map<string, Entry>();
  jobs = new Map<string, Job>();
  waiting: Job[] = [];
  running = 0;
  inspecting = 0;
  reserved = 0;
  closing = false;
  ready: Promise<void>;
  versions: Record<string, string> = {};
  private timer?: NodeJS.Timeout;
  private analyses = new Map<string, AbortController>();
  constructor() {
    this.ready = this.initialize();
    this.ready.catch(() => {});
  }
  private async initialize() {
    await mkdir(config.root, { recursive: true, mode: 0o700 });
    await access(config.root, constants.W_OK);
    for (const d of await readdir(config.root, { withFileTypes: true }))
      if (d.isDirectory() && /^(source|job)-[\da-f-]{36}$/.test(d.name))
        await rm(path.join(config.root, d.name), {
          recursive: true,
          force: true,
        });
    const signal = AbortSignal.timeout(15000);
    const [y, f, p, enc] = await Promise.all([
      extractor(["--version"], [], signal),
      native(binaries.ffmpeg, ["-version"], signal),
      native(binaries.ffprobe, ["-version"], signal),
      native(binaries.ffmpeg, ["-hide_banner", "-encoders"], signal),
    ]);
    for (const codec of [
      "libx264",
      "aac",
      "libmp3lame",
      "libvpx-vp9",
      "libopus",
      "png",
      "mjpeg",
      "pcm_s16le",
    ])
      if (!enc.includes(" " + codec + " "))
        throw new Problem(
          "DEPENDENCY_UNAVAILABLE",
          "The FFmpeg build lacks " + codec + ".",
          503,
        );
    this.versions = {
      "yt-dlp": y.trim(),
      FFmpeg: f.split("\n")[0].split(" ").slice(0, 3).join(" "),
      FFprobe: p.split("\n")[0].split(" ").slice(0, 3).join(" "),
    };
    this.timer = setInterval(
      () =>
        void this.sweep().catch(() =>
          console.error("Temporary storage cleanup failed"),
        ),
      config.cleanup,
    );
    this.timer.unref();
    for (const sig of ["SIGTERM", "SIGINT"] as const)
      process.once(sig, () => {
        this.closing = true;
        for (const controller of this.analyses.values()) controller.abort();
        for (const job of this.jobs.values()) this.cancel(job);
        clearInterval(this.timer);
      });
  }
  private reserve(n: number) {
    if (this.reserved + n > config.quota)
      throw new Problem(
        "STORAGE_LIMIT_EXCEEDED",
        "Temporary storage is busy. Try again after an export expires.",
        503,
      );
    this.reserved += n;
  }
  async inspect(
    owner: string,
    input: { url: string } | { name: string; body: Readable },
    signal: AbortSignal,
  ) {
    await this.ready;
    if (
      this.closing ||
      this.inspecting >= 3 ||
      this.analyses.has(owner) ||
      this.entries.size >= 64
    )
      throw new Problem(
        "SERVER_BUSY",
        "Media analysis is busy. Try again shortly.",
        429,
      );
    const cap = "url" in input ? limits.maxFile : limits.maxUpload;
    this.reserve(cap);
    this.inspecting++;
    const ctl = new AbortController();
    this.analyses.set(owner, ctl);
    const timed = AbortSignal.any([
      signal,
      ctl.signal,
      AbortSignal.timeout(Math.min(90000, config.timeout)),
    ]);
    const id = randomUUID(),
      dir = path.join(config.root, "source-" + id);
    let keep = 0;
    try {
      await mkdir(dir, { mode: 0o700 });
      let source: Source;
      if ("url" in input) source = await analyzeUrl(input.url, id, dir, timed);
      else source = await localMedia(input, id, dir, cap, timed);
      if (source.file && source.media.height && !source.media.thumb)
        source.media.thumb = await thumbnail(
          source.file,
          source.media.duration,
          timed,
        ).catch(() => undefined);
      timed.throwIfAborted();
      if (source.media.formats.length) {
        keep = source.file ? (await stat(source.file)).size : 0;
        this.entries.set(id, {
          owner,
          id,
          dir,
          source,
          expires: age(),
          refs: 0,
          disk: keep,
        });
      } else await rm(dir, { recursive: true, force: true });
      return source.media;
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    } finally {
      this.reserved -= cap - keep;
      this.inspecting--;
      this.analyses.delete(owner);
    }
  }
  getJob(id: string, owner: string) {
    const j = this.jobs.get(id);
    if (!j || j.owner !== owner)
      throw new Problem("JOB_NOT_FOUND", "Job not found.", 404);
    if (
      j.view.state === "EXPIRED" ||
      (j.view.expires && j.view.expires <= Date.now())
    )
      throw new Problem(
        "JOB_EXPIRED",
        "This export has expired. Analyze the source again.",
        410,
      );
    return j;
  }
  create(owner: string, mediaId: string, formatId: string, edit: Edit) {
    const entry = this.entries.get(mediaId);
    if (!entry || entry.owner !== owner || entry.expires <= Date.now())
      throw new Problem(
        "MEDIA_UNAVAILABLE",
        "This analysis expired or is unavailable. Analyze again.",
        410,
      );
    const q = entry.source.media.formats.find((f) => f.id === formatId);
    if (!q)
      throw new Problem(
        "FORMAT_UNAVAILABLE",
        "Choose an available export format.",
      );
    validateEdit(entry.source.media, q, edit);
    if (
      this.closing ||
      this.waiting.length >= config.queue ||
      this.jobs.size >= 200
    )
      throw new Problem(
        "QUEUE_FULL",
        "The export queue is full. Try again shortly.",
        429,
      );
    if (
      [...this.jobs.values()].filter(
        (j) => j.owner === owner && !terminal(j.view.state),
      ).length >= config.perOwner
    )
      throw new Problem(
        "SERVER_BUSY",
        "Finish or cancel your current export first.",
        429,
      );
    const id = randomUUID(),
      job: Job = {
        owner,
        entry,
        dir: path.join(config.root, "job-" + id),
        format: q,
        edit,
        ctl: new AbortController(),
        events: new EventEmitter(),
        disk: 0,
        readers: 0,
        view: { id, created: Date.now(), state: "QUEUED", quality: q.label },
      };
    entry.refs++;
    this.jobs.set(id, job);
    this.waiting.push(job);
    this.position();
    setImmediate(() => this.pump());
    return job;
  }
  private emit(j: Job, p: Partial<JobView>) {
    if (p.state && p.state !== j.view.state) {
      j.view.ratio = undefined;
      j.view.total = undefined;
      j.view.speed = undefined;
      j.view.eta = undefined;
      j.view.bytes = undefined;
      console.info(
        JSON.stringify({
          event: "job",
          id: j.view.id,
          stage: p.state,
          queued: this.waiting.length,
          elapsedMs: Date.now() - (j.view.started || j.view.created),
          size: p.size,
          code: p.code,
        }),
      );
    }
    Object.assign(j.view, p);
    j.events.emit("change", j.view);
  }
  private position() {
    this.waiting.forEach((j, i) => this.emit(j, { position: i + 1 }));
  }
  private pump() {
    while (
      !this.closing &&
      this.running < config.concurrency &&
      this.waiting.length
    ) {
      const j = this.waiting.shift()!;
      this.running++;
      this.position();
      void this.execute(j).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }
  private async execute(j: Job) {
    const timer = setTimeout(
      () =>
        j.ctl.abort(
          new Problem(
            "PROCESS_TIMEOUT",
            "Processing exceeded the time limit.",
            408,
          ),
        ),
      config.timeout,
    );
    const s = j.ctl.signal;
    let success = false;
    try {
      this.emit(j, {
        state: "ANALYZING",
        started: Date.now(),
        position: undefined,
      });
      const src = j.entry.source;
      const caption = j.format.language
        ? src.captions?.[j.format.language]
        : undefined;
      const tracks = src.file || caption ? [] : selectedTracks(src, j.format);
      const budget = (1 + tracks.length + Number(!!caption)) * limits.maxFile;
      this.reserve(budget);
      j.disk = budget;
      await mkdir(j.dir, { mode: 0o700 });
      const inputs: string[] = src.file ? [src.file] : [];
      if (caption) {
        this.emit(j, { state: "DOWNLOADING" });
        const file = path.join(j.dir, "captions");
        const { response } = await requestPublic(
          caption,
          [new URL(caption).hostname],
          s,
        );
        await storeStream(response, file, Math.min(4194304, limits.maxFile), s);
        inputs.push(file);
      }
      for (const [i, f] of tracks.entries()) {
        s.throwIfAborted();
        this.emit(j, { state: "DOWNLOADING" });
        const file = path.join(j.dir, "input-" + i);
        await downloadTrack(
          f,
          src.media.platform as "TikTok" | "YouTube",
          file,
          s,
          (p) => this.emit(j, p),
        );
        inputs.push(file);
      }
      if (!inputs.length)
        throw new Problem(
          "FORMAT_UNAVAILABLE",
          "The selected source tracks are unavailable.",
        );
      const probes = await Promise.all(inputs.map((file) => probe(file, s)));
      const actual = probes[0];
      const video = actual.streams.find(
        (track) => track.codec_type === "video",
      );
      const audio = (probes[1] || actual).streams.find(
        (track) => track.codec_type === "audio",
      );
      const canCopy =
        j.format.ext === "mp4" &&
        video?.codec_name === "h264" &&
        video.height === j.format.height &&
        (!audio || audio.codec_name === "aac");
      const outputFormat = { ...j.format, copy: canCopy };

      const realHeight = actual.streams.find(
        (v) => v.codec_type === "video",
      )?.height;
      if (j.format.height && realHeight && j.format.height > realHeight)
        throw new Problem(
          "FORMAT_UNAVAILABLE",
          "The provider returned a lower resolution. Analyze again.",
        );
      this.emit(j, {
        state:
          inputs.length > 1
            ? "MERGING"
            : j.format.kind === "audio"
              ? "CONVERTING"
              : "PROCESSING",
      });
      const out = await processFile(
        inputs,
        src.media,
        outputFormat,
        j.edit,
        path.join(j.dir, "output." + j.format.ext),
        s,
        (p) => this.emit(j, p),
      );
      s.throwIfAborted();
      for (const f of inputs) if (f !== src.file) await rm(f, { force: true });
      s.throwIfAborted();
      j.output = out.path;
      this.reserved -= j.disk - out.size;
      j.disk = out.size;
      success = true;
      this.finish(j, {
        state: "COMPLETED",
        filename: out.filename,
        size: out.size,
        ratio: 1,
      });
    } catch (err) {
      const e = problem(s.aborted ? s.reason : err);
      this.finish(j, {
        state: e.code === "JOB_CANCELLED" ? "CANCELLED" : "FAILED",
        code: e.code,
        message: e.message,
      });
    } finally {
      clearTimeout(timer);
      j.entry.refs--;
      if (!success) await this.eraseJob(j);
    }
  }
  private finish(j: Job, p: Partial<JobView>) {
    this.emit(j, { ...p, ended: Date.now(), expires: age() });
    j.expiry = setTimeout(
      () => void this.expire(j).catch(() => {}),
      limits.ttl * 1000,
    );
    j.expiry.unref();
  }
  cancel(j: Job) {
    if (terminal(j.view.state)) return;
    j.ctl.abort();
    const i = this.waiting.indexOf(j);
    if (i >= 0) {
      this.waiting.splice(i, 1);
      j.entry.refs--;
      this.finish(j, {
        state: "CANCELLED",
        code: "JOB_CANCELLED",
        message: "Processing was cancelled.",
      });
      this.position();
    }
  }
  private async eraseJob(j: Job) {
    await rm(j.dir, { recursive: true, force: true });
    this.reserved -= j.disk;
    j.disk = 0;
  }
  async expire(j: Job) {
    if (
      !terminal(j.view.state) ||
      j.readers ||
      !j.view.expires ||
      j.view.expires > Date.now()
    )
      return;
    if (j.view.state === "EXPIRED") return;
    this.emit(j, { state: "EXPIRED" });
    await this.eraseJob(j);
  }
  async sweep() {
    for (const j of this.jobs.values()) {
      await this.expire(j);
      if (
        j.view.state === "EXPIRED" &&
        Date.now() - (j.view.expires || 0) > 60000
      )
        this.jobs.delete(j.view.id);
    }
    for (const e of this.entries.values())
      if (!e.refs && e.expires <= Date.now()) {
        this.entries.delete(e.id);
        await rm(e.dir, { recursive: true, force: true });
        this.reserved -= e.disk;
      }
  }
}
const globals = globalThis as typeof globalThis & { linkoraEngine?: Engine };
export function engine() {
  return (globals.linkoraEngine ??= new Engine());
}
