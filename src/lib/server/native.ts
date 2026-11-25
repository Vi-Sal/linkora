import { spawn } from "node:child_process";
import path from "node:path";
import { Problem, config, limits } from "./config";
export const binaries = {
  ffmpeg: process.env.FFMPEG_BIN || "ffmpeg",
  ffprobe: process.env.FFPROBE_BIN || "ffprobe",
  python: process.env.PYTHON_BIN || "python3",
};
export async function native(
  bin: string,
  args: string[],
  signal: AbortSignal,
  opts: {
    line?: (line: string) => void;
    env?: Record<string, string>;
    input?: string;
  } = {},
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        PYTHONIOENCODING: "utf-8",
        ...opts.env,
      },
    });
    let stdout = "",
      pending = "",
      stderr = "",
      abort: unknown;
    const stop = (why: unknown) => {
      abort = why;
      child.kill("SIGKILL");
    };
    const cancel = () => stop(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(
      () =>
        stop(
          new Problem(
            "PROCESS_TIMEOUT",
            "The native media tool timed out.",
            408,
          ),
        ),
      config.timeout,
    );
    timer.unref();
    child.stdout.setEncoding("utf8").on("data", (s: string) => {
      if (opts.line) {
        pending += s;
        const lines = pending.split(/[\r\n]+/);
        pending = lines.pop() || "";
        for (const l of lines) opts.line(l);
      } else stdout += s;
      if (stdout.length + pending.length > 8_000_000)
        stop(
          new Problem(
            "EXTRACTION_FAILED",
            "Media metadata exceeded the safe response limit.",
          ),
        );
    });
    child.stderr.setEncoding("utf8").on("data", (s: string) => {
      stderr = (stderr + s).slice(-8192);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input);
    child.once("error", () => {
      abort = new Problem(
        "DEPENDENCY_UNAVAILABLE",
        "A required media executable could not start.",
        503,
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (abort) return reject(abort);
      if (code !== 0) {
        let reason = "The provider could not supply a usable media stream.",
          key = "EXTRACTION_FAILED";
        // yt-dlp can emit unrelated warnings before the terminal error.
        const terminalError =
          stderr
            .split(/\r?\n/)
            .filter((line) => /^ERROR:/i.test(line))
            .at(-1) || stderr;
        if (
          bin === binaries.python &&
          /confirm.{0,30}(?:not a bot|human)|captcha/i.test(terminalError)
        ) {
          key = "PLATFORM_RESTRICTED";
          reason =
            "The provider requires a human verification check for this server.";
        } else if (
          bin === binaries.python &&
          /HTTP Error 429|Too Many Requests/i.test(terminalError)
        ) {
          key = "PLATFORM_RESTRICTED";
          reason = "The provider rate-limited this server (HTTP 429).";
        } else if (
          bin === binaries.python &&
          /HTTP Error 403|403 Forbidden/i.test(terminalError)
        ) {
          key = "PLATFORM_RESTRICTED";
          reason =
            "The provider denied this server access to the media (HTTP 403).";
        } else if (
          bin === binaries.python &&
          /not available in your country|geo.restricted/i.test(terminalError)
        ) {
          key = "PLATFORM_RESTRICTED";
          reason = "The provider restricts this media in the server's region.";
        } else if (
          /private video|members.only|login required|sign in to view/i.test(
            terminalError,
          )
        ) {
          key = "PRIVATE_MEDIA";
          reason = "The provider requires an account or private access.";
        } else if (
          /bot|captcha|403|429|blocked|challenge|not available in your country/i.test(
            terminalError,
          )
        ) {
          key = "PLATFORM_RESTRICTED";
          reason = "The provider restricted access from this server.";
        } else if (
          /unavailable|not available|removed|not found/i.test(stderr)
        ) {
          key = "MEDIA_UNAVAILABLE";
          reason = "The provider reports that this media is unavailable.";
        } else if (/ModuleNotFoundError/.test(stderr)) {
          key = "DEPENDENCY_UNAVAILABLE";
          reason = "The server is missing the yt-dlp package.";
        } else if (bin === binaries.ffprobe) {
          key = "INVALID_MEDIA_FILE";
          reason = "FFprobe could not validate this file as supported media.";
        } else if (bin === binaries.ffmpeg) {
          key = "FFMPEG_FAILED";
          reason =
            "FFmpeg could not process this media with the selected settings.";
        }
        console.warn(
          JSON.stringify({
            event: "native_exit",
            tool: path.basename(bin),
            exit: code,
            key,
            reason,
          }),
        );
        return reject(new Problem(key, reason));
      }
      if (pending) opts.line?.(pending);
      resolve(stdout);
    });
  });
}
export const demux = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,mp3,wav,aac,flac,ogg,mpeg,mpegts,srt,webvtt,image2,png_pipe,jpeg_pipe",
];
export function extractor(
  args: string[],
  hosts: string[],
  signal: AbortSignal,
  opts: {
    line?: (s: string) => void;
    input?: string;
    exactHosts?: boolean;
  } = {},
) {
  return native(
    binaries.python,
    [
      "-I",
      path.resolve("scripts/extractor.py"),
      "--ignore-config",
      "--no-plugin-dirs",
      "--no-playlist",
      "--no-cache-dir",
      "--no-geo-bypass",
      "--fixup",
      "never",
      "--no-js-runtimes",
      "--no-remote-components",
      "--proxy",
      "",
      "--socket-timeout",
      "10",
      "--retries",
      "0",
      "--extractor-retries",
      "0",
      ...args,
    ],
    signal,
    {
      ...opts,
      env: {
        LINKORA_EGRESS_HOSTS: hosts.join(","),
        LINKORA_EXACT_HOSTS: opts.exactHosts ? "1" : "0",
        LINKORA_MAX_BYTES: String(limits.maxFile),
      },
    },
  );
}
