import path from "node:path";
import type { Limits } from "../models";
function number(key: string, fallback: number) {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1)
    throw Error("Invalid configuration " + key);
  return n;
}
const flag = (key: string, defaultValue: boolean) =>
  (process.env[key] ?? String(defaultValue)) === "true";
const mb = 1024 * 1024;
export const limits: Limits = {
  maxFile: number("MAX_FILE_SIZE_MB", 100) * mb,
  maxUpload: number("MAX_UPLOAD_SIZE_MB", 100) * mb,
  duration: number("MAX_VIDEO_DURATION_SECONDS", 600),
  height: number("MAX_VIDEO_HEIGHT", 1080),
  ttl: number("FILE_TTL_SECONDS", 900),
  uploads: flag("ENABLE_LOCAL_UPLOADS", true),
  heavy: flag("ENABLE_HEAVY_TRANSCODING", true),
  batch: flag("ENABLE_BATCH_EXPORT", false),
  batchSize: number("MAX_BATCH_SIZE", 3),
  direct: flag("ENABLE_DIRECT_URL_EXPORT", true),
  directHosts: (
    process.env.DIRECT_MEDIA_HOSTS ??
    "media.w3.org,interactive-examples.mdn.mozilla.net"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};
export const config = {
  root: path.resolve(process.env.TEMP_DIR || "/tmp/linkora", "work-v1"),
  concurrency: number("MAX_CONCURRENT_JOBS", 1),
  queue: number("MAX_QUEUE_SIZE", 5),
  perOwner: number("MAX_JOBS_PER_SESSION", 1),
  quota: number("MAX_TEMP_STORAGE_MB", 512) * mb,
  timeout: number("JOB_TIMEOUT_SECONDS", 300) * 1000,
  cleanup: number("CLEANUP_INTERVAL_SECONDS", 60) * 1000,
};
const errorBrand = Symbol.for("linkora.server.problem");
export class Problem extends Error {
  readonly [errorBrand] = true;
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export function problem(e: unknown) {
  if (e instanceof Error && errorBrand in e) return e as Problem;
  if (e instanceof Error && e.name === "TimeoutError")
    return new Problem(
      "PROCESS_TIMEOUT",
      "Processing exceeded the time limit.",
      408,
    );
  if (e instanceof Error && e.name === "AbortError")
    return new Problem("JOB_CANCELLED", "Processing was cancelled.", 409);
  return new Problem(
    "PROCESSING_FAILED",
    "The media operation could not finish.",
    500,
  );
}
