import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { open } from "node:fs/promises";
import { NextRequest } from "next/server";
import { z } from "zod";
import { engine, type Job } from "@/lib/server/jobs";
import { limits, Problem, problem } from "@/lib/server/config";
import { editSchema } from "@/lib/server/media";
import { terminal } from "@/lib/models";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const globals = globalThis as typeof globalThis & {
  linkoraSecret?: Buffer;
  linkoraRates?: Map<string, { n: number; until: number }>;
};
const secret = (globals.linkoraSecret ??= randomBytes(32));
function signed(s: string) {
  return createHmac("sha256", secret).update(s).digest("hex");
}
function session(req: NextRequest) {
  const raw = req.cookies.get("linkora_session")?.value || "",
    [id, mac] = raw.split(".");
  if (
    /^[a-f0-9]{48}$/.test(id) &&
    mac?.length === 64 &&
    /^[a-f0-9]+$/.test(mac) &&
    timingSafeEqual(Buffer.from(mac), Buffer.from(signed(id)))
  )
    return { id, cookie: "" };
  const next = randomBytes(24).toString("hex");
  return {
    id: next,
    cookie:
      "linkora_session=" +
      next +
      "." +
      signed(next) +
      "; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400" +
      (req.nextUrl.protocol === "https:" || process.env.RENDER === "true"
        ? "; Secure"
        : ""),
  };
}
function rate(key: string, max: number) {
  const map = (globals.linkoraRates ??= new Map());
  const now = Date.now();
  for (const [k, v] of map) if (v.until <= now) map.delete(k);
  let v = map.get(key);
  if (!v) {
    v = { n: 0, until: now + 60000 };
    map.set(key, v);
  }
  if (++v.n > max)
    throw new Problem(
      "RATE_LIMITED",
      "Too many requests. Try again in a minute.",
      429,
    );
}
async function body(req: NextRequest) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new Problem("INVALID_INPUT", "Send a JSON request.", 415);
  const reader = req.body?.getReader();
  if (!reader) throw new Problem("INVALID_INPUT", "Missing request body.", 400);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new Problem("INVALID_INPUT", "Request is too large.", 413);
      }
      chunks.push(Buffer.from(r.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch (e) {
    if (e instanceof Problem) throw e;
    throw new Problem("INVALID_INPUT", "Invalid JSON request.", 400);
  } finally {
    reader.releaseLock();
  }
}
function events(j: Job, signal: AbortSignal) {
  if (j.events.listenerCount("change") >= 8)
    throw new Problem("SERVER_BUSY", "Too many progress connections.", 429);
  const enc = new TextEncoder();
  let dispose = () => {};
  const stream = new ReadableStream({
    start(c) {
      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        dispose();
        c.close();
      };
      const send = () => {
        if (done) return;
        c.enqueue(enc.encode("data: " + JSON.stringify(j.view) + "\n\n"));
        if (terminal(j.view.state)) close();
      };
      const timer = setInterval(() => {
        if (!done) c.enqueue(enc.encode(": heartbeat\n\n"));
      }, 12000);
      dispose = () => {
        clearInterval(timer);
        j.events.off("change", send);
        signal.removeEventListener("abort", close);
      };
      j.events.on("change", send);
      signal.addEventListener("abort", close, { once: true });
      if (signal.aborted) close();
      else send();
    },
    cancel() {
      dispose();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
type Context = { params: Promise<{ path: string[] }> };
async function handle(req: NextRequest, ctx: Context) {
  const { id, cookie } = session(req);
  const reply = (data: unknown, status = 200) =>
    Response.json(
      { success: true, code: "SUCCESS", message: "OK", data },
      {
        status,
        headers: cookie && req.method !== "GET" ? { "Set-Cookie": cookie } : {},
      },
    );
  try {
    const parts = (await ctx.params).path,
      key = parts.join("/"),
      method = req.method;
    const e = engine();
    await e.ready;
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      if (
        (origin && new URL(origin).host !== req.headers.get("host")) ||
        req.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new Problem(
          "FORBIDDEN",
          "Cross-site changes are not permitted.",
          403,
        );
      rate("global", 180);
      rate(id, 35);
    }
    if (method === "GET" && key === "health")
      return reply({
        status: "ready",
        worker: true,
        storage: true,
        tools: e.versions,
      });
    if (method === "GET" && key === "limits") return reply(limits);
    if (method === "GET" && key === "platforms")
      return reply([
        {
          name: "YouTube",
          preview: true,
          export: "accessible, unprotected streams within server limits",
        },
        {
          name: "TikTok",
          preview: true,
          export: "publisher download renditions",
        },
        {
          name: "Direct link",
          export: limits.direct,
        },
        { name: "Local file", export: limits.uploads },
      ]);
    if (method === "POST" && key === "media/analyze") {
      const { url } = z
        .object({ url: z.string().min(1).max(4096) })
        .strict()
        .parse(await body(req));
      return reply(await e.inspect(id, { url }, req.signal));
    }
    if (method === "POST" && key === "media/upload") {
      if (!limits.uploads)
        throw new Problem("EXPORT_DISABLED", "Uploads are disabled.");
      if (
        !req.body ||
        Number(req.headers.get("content-length")) > limits.maxUpload
      )
        throw new Problem("FILE_TOO_LARGE", "Choose a smaller file.", 413);
      let name;
      try {
        name = z
          .string()
          .min(1)
          .max(255)
          .parse(decodeURIComponent(req.headers.get("x-filename") || "Media"));
      } catch {
        throw new Problem("INVALID_INPUT", "Invalid upload filename.", 400);
      }
      return reply(
        await e.inspect(
          id,
          {
            name,
            body: Readable.fromWeb(
              req.body as Parameters<typeof Readable.fromWeb>[0],
            ),
          },
          req.signal,
        ),
      );
    }
    if (method === "POST" && ["media/process", "media/export"].includes(key)) {
      const d = z
        .object({
          mediaId: z.uuid(),
          format: z.string().max(64),
          edit: editSchema.optional(),
        })
        .strict()
        .parse(await body(req));
      return reply(
        e.create(id, d.mediaId, d.format, d.edit ?? editSchema.parse({})).view,
        202,
      );
    }
    if (
      parts[0] === "jobs" &&
      parts.length >= 2 &&
      parts.length <= 3 &&
      z.uuid().safeParse(parts[1]).success
    ) {
      const j = e.getJob(parts[1], id),
        op = parts[2];
      if (!op && method === "GET") return reply(j.view);
      if (!op && method === "DELETE") {
        e.cancel(j);
        return reply(j.view);
      }
      if (op === "retry" && method === "POST") {
        if (!["FAILED", "CANCELLED"].includes(j.view.state))
          throw new Problem(
            "INVALID_STATE",
            "Only failed or cancelled jobs can be retried.",
            409,
          );
        return reply(e.create(id, j.entry.id, j.format.id, j.edit).view, 202);
      }
      if (op === "progress" && method === "GET") return events(j, req.signal);
      if (op === "download" && method === "GET") {
        if (!j.output || j.view.state !== "COMPLETED")
          throw new Problem("INVALID_STATE", "The export is not ready.", 409);
        j.readers++;
        let file;
        try {
          file = await open(j.output, "r");
        } catch (err) {
          j.readers--;
          throw err;
        }
        const stream = file.createReadStream();
        stream.once("close", () => {
          j.readers--;
          void e.expire(j).catch(() => {});
        });
        const ext = j.format.ext;
        const mime: Record<string, string> = {
          mp4: "video/mp4",
          mp3: "audio/mpeg",
          wav: "audio/wav",
          m4a: "audio/mp4",
          aac: "audio/aac",
          jpg: "image/jpeg",
          png: "image/png",
          webm: "video/webm",
          mov: "video/quicktime",
          vtt: "text/vtt",
          srt: "application/x-subrip",
        };
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          headers: {
            "Content-Type": mime[ext],
            "Content-Length": String(j.view.size),
            "Content-Disposition":
              'attachment; filename="linkora.' +
              ext +
              "\"; filename*=UTF-8''" +
              encodeURIComponent(j.view.filename!).replace(/'/g, "%27"),
            "Cache-Control": "private, no-store",
          },
        });
      }
    }
    throw new Problem("NOT_FOUND", "Endpoint not found.", 404);
  } catch (err) {
    const p =
      err instanceof z.ZodError
        ? new Problem("INVALID_INPUT", "Invalid request parameters.", 400)
        : problem(err);
    return Response.json(
      { success: false, code: p.code, message: p.message, data: null },
      {
        status: p.status,
        headers: cookie && req.method !== "GET" ? { "Set-Cookie": cookie } : {},
      },
    );
  }
}
export { handle as GET, handle as POST, handle as DELETE };
