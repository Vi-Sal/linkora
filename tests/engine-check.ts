import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
const root = await mkdtemp(join(tmpdir(), "linkora-engine-test-"));
Object.assign(process.env, {
  TEMP_DIR: root,
  FILE_TTL_SECONDS: "1",
  CLEANUP_INTERVAL_SECONDS: "1",
  MAX_QUEUE_SIZE: "1",
  MAX_JOBS_PER_SESSION: "1",
  JOB_TIMEOUT_SECONDS: "2",
  MAX_FILE_SIZE_MB: "1",
  MAX_UPLOAD_SIZE_MB: "1",
  MAX_TEMP_STORAGE_MB: "4",
});
const { Engine } = await import("../src/lib/server/jobs");
const { native } = await import("../src/lib/server/native");
const { editSchema } = await import("../src/lib/server/media");
const e = new Engine();
try {
  await e.ready;
  const wav = execFileSync(process.env.FFMPEG_BIN || "ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=1",
    "-f",
    "wav",
    "pipe:1",
  ]);
  const media = await e.inspect(
    "A",
    { name: "Tone.wav", body: Readable.from(wav) },
    AbortSignal.timeout(3000),
  );
  await assert.rejects(
    e.inspect(
      "B",
      { name: "large.wav", body: Readable.from(Buffer.alloc(1048577)) },
      AbortSignal.timeout(3000),
    ),
    { code: "FILE_TOO_LARGE" },
  );
  const job = e.create("A", media.id, "mp3-128", editSchema.parse({}));
  assert.throws(
    () => e.create("A", media.id, "mp3-128", editSchema.parse({})),
    { code: "QUEUE_FULL" },
  );
  await new Promise<void>((r) =>
    job.events.on("change", (v) => {
      if (v.state === "ANALYZING") {
        assert.throws(
          () => e.create("A", media.id, "mp3-128", editSchema.parse({})),
          { code: "SERVER_BUSY" },
        );
      }
      if (v.state === "COMPLETED") r();
    }),
  );
  job.readers++;
  await new Promise((r) => setTimeout(r, 1150));
  await e.sweep();
  assert(job.output);
  assert((await readdir(job.dir)).length > 0);
  job.readers--;
  await e.expire(job);
  await e.sweep();
  assert.deepEqual(await readdir(join(root, "work-v1")), []);
  await assert.rejects(
    native(
      process.execPath,
      ["-e", "setTimeout(()=>{},10000)"],
      AbortSignal.timeout(5000),
    ),
    { code: "PROCESS_TIMEOUT" },
  );
  await writeFile(join(root, "success"), "ok");
  console.log(
    "PASS queue bounds, session limit, actual byte limit, native timeout, active stream lease and disk cleanup",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
