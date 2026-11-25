/** Run against a real single-process server. Fixtures are generated locally and discarded. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Media, JobView, Limits } from "../src/lib/models";
const base =
  (process.env.TEST_BASE_URL || "http://127.0.0.1:10000") + "/api/v1/";
const dir = await mkdtemp(path.join(tmpdir(), "linkora-test-"));
const fixture = path.join(dir, "controlled.mp4"),
  sub = path.join(dir, "captions.srt");
let cookie = "";
async function hit(
  route: string,
  method = "GET",
  payload?: unknown,
  owner = true,
) {
  const res = await fetch(base + route, {
    method,
    headers: {
      ...(owner && cookie ? { cookie } : {}),
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return res;
}
async function data<T>(res: Response): Promise<T> {
  const b = await res.json();
  assert.equal(b.success, true, b.message);
  return b.data;
}
async function upload(buf: Buffer, name: string) {
  const res = await fetch(base + "media/upload", {
    method: "POST",
    headers: {
      cookie,
      "Content-Type": "application/octet-stream",
      "X-Filename": encodeURIComponent(name),
    },
    body: new Uint8Array(buf),
  });
  cookie = res.headers.get("set-cookie")?.split(";")[0] || cookie;
  return res;
}
async function progress(id: string) {
  const res = await hit("jobs/" + id + "/progress");
  assert.match(res.headers.get("content-type") || "", /text\/event-stream/);
  const lines = (await res.text())
    .split("\n")
    .filter((l) => l.startsWith("data: "));
  assert(lines.length > 0);
  const events = lines.map((l) => JSON.parse(l.slice(6)) as JobView);
  return events;
}
async function checkResult(j: JobView, ext: string) {
  const events = await progress(j.id),
    last = events.at(-1)!;
  assert.equal(last.state, "COMPLETED", last.message);
  const res = await hit("jobs/" + j.id + "/download");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") || "", /attachment/);
  const out = path.join(dir, "out." + ext);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.length, last.size);
  await writeFile(out, buf);
  return JSON.parse(
    execFileSync(
      process.env.FFPROBE_BIN || "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", out],
      { encoding: "utf8" },
    ),
  ) as {
    streams: {
      codec_name: string;
      height?: number;
      width?: number;
      bit_rate?: string;
    }[];
    format: { duration: string };
  };
}
try {
  const limits = await data<Limits>(await hit("limits"));
  await writeFile(sub, "1\n00:00:00,100 --> 00:00:01,500\nLinkora caption\n");
  execFileSync(process.env.FFMPEG_BIN || "ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440",
    "-i",
    sub,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "2:s",
    "-t",
    "5",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-c:s",
    "mov_text",
    "-metadata:s:s:0",
    "language=eng",
    "-threads",
    "1",
    fixture,
  ]);
  const buf = await readFile(fixture);
  assert.equal(
    (await upload(Buffer.from("invalid media bytes"), "test.mp4")).status,
    422,
  );
  const m = await data<Media>(await upload(buf, "controlled.mp4"));
  assert.equal(m.height, 360);
  assert.equal(m.audio, true);
  assert(!m.formats.some((q) => q.id === "mp4-720"));
  assert(m.formats.some((q) => q.kind === "subtitle"));
  const create = async (format: string, edit = {}) =>
    data<JobView>(
      await hit("media/process", "POST", { mediaId: m.id, format, edit }),
    );
  const invalid = await hit("media/process", "POST", {
    mediaId: m.id,
    format: "mp4-720",
  });
  assert.equal(invalid.status, 422);
  assert.equal(
    (
      await hit(
        "media/process",
        "POST",
        { mediaId: m.id, format: "mp3-128" },
        false,
      )
    ).status,
    410,
  );
  const c = await create("webm");
  assert.equal(
    (await hit("jobs/" + c.id, "GET", undefined, false)).status,
    404,
  );
  const detached = await hit("jobs/" + c.id + "/progress");
  await detached.body?.cancel();
  await hit("jobs/" + c.id, "DELETE");
  assert.equal((await progress(c.id)).at(-1)?.state, "CANCELLED");
  const retry = await data<JobView>(
    await hit("jobs/" + c.id + "/retry", "POST"),
  );
  const webm = await checkResult(retry, "webm");
  assert(webm.streams.some((s) => s.codec_name === "vp9"));
  console.log("PASS session isolation, SSE reconnect, cancellation, retry");
  const mp4 = await create("mp4-best");
  const original = await checkResult(mp4, "mp4");
  assert(original.streams.some((s) => s.codec_name === "h264"));
  assert(original.streams.some((s) => s.codec_name === "aac"));
  const mp3 = await create("mp3-192", {
    mode: "audio",
    start: 0.25,
    end: 2.25,
    volume: 0.8,
    fadeIn: 0.1,
    fadeOut: 0.2,
  });
  const sound = await checkResult(mp3, "mp3");
  assert.equal(sound.streams[0].codec_name, "mp3");
  assert.equal(Number(sound.streams[0].bit_rate), 192000);
  assert(Math.abs(Number(sound.format.duration) - 2) < 0.15);
  for (const ext of ["m4a", "wav", "aac", "mov", "jpg", "png"])
    await checkResult(
      await create(
        ext,
        ext === "jpg" || ext === "png" ? { mode: "thumbnail", start: 0.5 } : {},
      ),
      ext,
    );
  const caption = m.formats.find((q) => q.ext === "vtt")!;
  await checkResult(await create(caption.id, { mode: "subtitles" }), "vtt");
  assert.match(
    await readFile(path.join(dir, "out.vtt"), "utf8"),
    /Linkora caption/,
  );
  const trimmed = await checkResult(
    await create("mp4-best", { mode: "trim", start: 1, end: 3 }),
    "mp4",
  );
  assert(Math.abs(Number(trimmed.format.duration) - 2) < 0.15);
  const square = await checkResult(
    await create("mp4-360", { mode: "resize", aspect: "1:1", fit: "crop" }),
    "mp4",
  );
  assert.equal(square.streams[0].width, square.streams[0].height);
  await checkResult(
    await create("mp4-360", { mode: "compress", compression: "small" }),
    "mp4",
  );
  console.log(
    "PASS upload validation, MP4, MP3, WAV, M4A, AAC, MOV, WebM, frames, captions, trim, resize and compression",
  );
  const last = await create("mp4-best");
  await checkResult(last, "mp4");
  assert.equal(
    (await hit("jobs/" + last.id + "/download", "GET", undefined, false))
      .status,
    404,
  );
  if (limits.ttl <= 60) {
    await new Promise((r) => setTimeout(r, (limits.ttl + 1) * 1000));
    assert.equal((await hit("jobs/" + last.id + "/download")).status, 410);
    console.log("PASS completed-file expiry");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
