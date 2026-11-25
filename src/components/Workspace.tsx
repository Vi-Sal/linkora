"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  Clipboard,
  Download,
  File,
  FolderOpen,
  Link2,
  Music2,
  Video,
  WandSparkles,
  X,
  SquarePlay,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useUI } from "./Shell";
import { GlassButton, Segments } from "./Glass";
import { api, bytes, remember, time, upload } from "@/lib/client";
import {
  terminal,
  type Media,
  type JobView,
  type Quality,
  type Limits,
} from "@/lib/models";
import { tools } from "@/lib/tools";
const stages: Record<JobView["state"], string> = {
  QUEUED: "Queued",
  ANALYZING: "Reading media",
  DOWNLOADING: "Downloading media",
  PROCESSING: "Processing media",
  MERGING: "Merging tracks",
  CONVERTING: "Encoding audio",
  FINALIZING: "Validating output",
  COMPLETED: "Export ready",
  FAILED: "Unable to finish",
  CANCELLED: "Cancelled",
  EXPIRED: "Export expired",
};
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Request failed.";
type Props = { path?: string };
export function Workspace({ path = "/" }: Props) {
  const { t, prefs } = useUI(),
    motionReduced = useReducedMotion();
  const tool = tools.find((x) => x.path === path);
  const action = path.startsWith("/tools/") ? path.split("/").pop()! : "export";
  const [mode, setMode] = useState(
      path.startsWith("/tools/") ? "file" : "link",
    ),
    [url, setUrl] = useState(""),
    [media, setMedia] = useState<Media | null>(null),
    [fileUrl, setFileUrl] = useState(""),
    [kind, setKind] = useState("video"),
    [format, setFormat] = useState(""),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState<number | null>(null),
    [job, setJob] = useState<JobView | null>(null),
    [limits, setLimits] = useState<Limits | null>(null),
    [now, setNow] = useState(0);
  const [start, setStart] = useState("0"),
    [end, setEnd] = useState(""),
    [aspect, setAspect] = useState("source"),
    [fit, setFit] = useState("fit"),
    [volume, setVolume] = useState("1"),
    [fadeIn, setFadeIn] = useState("0"),
    [fadeOut, setFadeOut] = useState("0"),
    [compression, setCompression] = useState("balanced");
  const input = useRef<HTMLInputElement>(null),
    picker = useRef<HTMLInputElement>(null),
    ctl = useRef<AbortController | null>(null),
    stream = useRef<EventSource | null>(null),
    platform = useRef<Media["platform"] | null>(null),
    current = useRef(""),
    locked = !!job && !terminal(job.state);
  const update = useCallback((j: JobView) => {
    setJob(j);
    setNow(Date.now());
    if (terminal(j.state)) {
      stream.current?.close();
      if (j.state === "COMPLETED")
        remember(j, platform.current ? { platform: platform.current } : null);
    }
  }, []);
  const watch = useCallback(
    (j: JobView) => {
      current.current = j.id;
      stream.current?.close();
      update(j);
      try {
        sessionStorage.setItem("linkora.current-job", j.id);
      } catch {}
      if (terminal(j.state)) return;
      const es = new EventSource("/api/v1/jobs/" + j.id + "/progress");
      stream.current = es;
      es.onmessage = (ev) => {
        if (current.current === j.id) update(JSON.parse(ev.data) as JobView);
      };
      es.onerror = () => {
        if (current.current !== j.id) return;
        void api<JobView>("jobs/" + j.id)
          .then((v) => {
            if (current.current === v.id) update(v);
          })
          .catch((e) => {
            if (
              current.current === j.id &&
              /expired|not found/i.test(errorText(e))
            ) {
              es.close();
              update({ ...j, state: "EXPIRED" });
              setErr(errorText(e));
            }
          });
      };
    },
    [update, setErr],
  );
  useEffect(() => {
    let live = true;
    void api<Limits>("limits")
      .then((v) => {
        if (live) setLimits(v);
      })
      .catch((e) => {
        if (live) setErr(errorText(e));
      });
    try {
      const id = sessionStorage.getItem("linkora.current-job");
      if (id)
        void api<JobView>("jobs/" + id)
          .then((j) => {
            if (live) watch(j);
          })
          .catch(() => {
            if (live) sessionStorage.removeItem("linkora.current-job");
          });
    } catch {}
    return () => {
      live = false;
      current.current = "";
      ctl.current?.abort();
      stream.current?.close();
    };
  }, [watch]);
  useEffect(
    () => () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    },
    [fileUrl],
  );
  useEffect(() => {
    if (job?.state !== "COMPLETED") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job?.state]);
  function reset() {
    ctl.current?.abort();
    ctl.current = null;
    stream.current?.close();
    current.current = "";
    setJob(null);
    setMedia(null);
    setFileUrl("");
    setErr("");
    setSent(null);
    setBusy(false);
    setFormat("");
    try {
      sessionStorage.removeItem("linkora.current-job");
    } catch {}
  }
  function select(m: Media) {
    platform.current = m.platform;
    setMedia(m);
    setStart("0");
    setEnd(String(m.duration));
    setFormat("");
    const k =
      action === "thumbnail"
        ? "image"
        : action === "subtitles"
          ? "subtitle"
          : path === "/mp3" || action === "audio"
            ? "audio"
            : ["trim", "resize", "compress"].includes(action)
              ? "video"
              : m.formats.some((q) => q.kind === "video")
                ? "video"
                : m.formats[0]?.kind || "video";
    setKind(k);
  }
  async function analyze(file?: File) {
    if (locked || busy) return;
    reset();
    const control = new AbortController();
    ctl.current = control;
    setBusy(true);
    try {
      let m: Media;
      if (file) {
        if (limits && file.size > limits.maxUpload)
          throw Error("The media exceeds the server file limit.");
        m = await upload(file, setSent, control.signal);
        if (file.type.startsWith("video/") || file.type.startsWith("audio/"))
          setFileUrl(URL.createObjectURL(file));
      } else {
        m = await api<Media>(
          "media/analyze",
          "POST",
          { url: url.trim() },
          control.signal,
        );
        if (m.page) setUrl(m.page);
      }
      if (!control.signal.aborted) select(m);
    } catch (e) {
      if (!control.signal.aborted) setErr(errorText(e));
    } finally {
      if (ctl.current === control) {
        setBusy(false);
        setSent(null);
      }
    }
  }
  const visible = (media?.formats || []).filter(
    (q) =>
      q.kind === kind &&
      (action === "convert" || (q.ext !== "mov" && q.ext !== "webm")),
  );
  const chosen =
    visible.find((q) => q.id === format) ||
    visible.find((q) =>
      kind === "video"
        ? q.id === "mp4-" + prefs.quality
        : q.id === prefs.audio + "-" + prefs.bitrate || q.id === prefs.audio,
    ) ||
    visible[0];
  async function submit() {
    if (!media || !chosen || busy || locked) return;
    setErr("");
    setBusy(true);
    try {
      const edit = {
        mode: action,
        start: ["audio", "trim", "thumbnail"].includes(action)
          ? Number(start)
          : 0,
        ...(["trim", "audio"].includes(action) ? { end: Number(end) } : {}),
        aspect,
        fit,
        volume: Number(volume),
        fadeIn: Number(fadeIn),
        fadeOut: Number(fadeOut),
        compression,
      };
      watch(
        await api<JobView>(
          "media/" + (mode === "file" ? "process" : "export"),
          "POST",
          { mediaId: media.id, format: chosen.id, edit },
        ),
      );
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const allowKinds = (media?.formats || []).map((f) => f.kind);
  const selectedState =
    job?.state === "COMPLETED" && job.expires && now >= job.expires
      ? "EXPIRED"
      : job?.state;
  const modeChange = (v: string) => {
    if (locked || mode === v) return;
    reset();
    setMode(v);
  };
  const Icon = tool?.icon || Link2;
  return (
    <section className="workspace glass" aria-labelledby="workspace-title">
      <div className="title-row">
        <div className="head-copy">
          <span className="symbol">
            <Icon />
          </span>
          <div>
            <h2 id="workspace-title">
              {t(
                tool?.name ||
                  (path === "/tiktok" ? "TikTok" : "Media workspace"),
              )}
            </h2>
            <p>
              {t(
                tool?.desc ||
                  "Preview a link and choose how to export your media.",
              )}
            </p>
          </div>
        </div>
        <Segments
          disabled={locked || busy}
          label={t("Media source")}
          items={[
            ["link", t("Link"), <Link2 key="link" />],
            ["file", t("File"), <File key="file" />],
          ]}
          value={mode}
          onChange={modeChange}
        />
      </div>
      {mode === "link" ? (
        <>
          <form
            className="link-form"
            onSubmit={(e) => {
              e.preventDefault();
              void analyze();
            }}
          >
            <div className="field">
              <Link2 size={20} />
              <input
                required
                ref={input}
                id="media-url"
                aria-label={t("Media link")}
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                value={url}
                disabled={busy || locked}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("Paste your media link here…")}
              />
              {url && (
                <button
                  disabled={busy || locked}
                  type="button"
                  aria-label={t("Clear")}
                  onClick={() => {
                    reset();
                    setUrl("");
                    input.current?.focus();
                  }}
                >
                  <X size={16} />
                </button>
              )}
              <button
                type="button"
                className="subtle"
                disabled={busy || locked}
                onClick={async () => {
                  try {
                    setUrl(await navigator.clipboard.readText());
                    input.current?.focus();
                  } catch {
                    setErr(
                      "Paste your link into the field using your keyboard or touch menu.",
                    );
                    input.current?.focus();
                  }
                }}
              >
                <Clipboard size={15} />
                {t("Paste")}
              </button>
            </div>
            <GlassButton variant="primary" disabled={busy || locked}>
              <WandSparkles size={17} />
              {t("Analyze link")}
            </GlassButton>
          </form>
          <div className="platforms">
            <span className="meta">{t("Media sources")}</span>
            <span>
              <SquarePlay />
              YouTube
            </span>
            <span>
              <Music2 />
              TikTok
            </span>
            <span>
              <Link2 />
              {t("Direct links")}
            </span>
          </div>
        </>
      ) : (
        <div
          className="file-area"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f && !busy && !locked) void analyze(f);
          }}
        >
          <input
            ref={picker}
            type="file"
            hidden
            accept={
              action === "subtitles" ? ".srt,.vtt,video/*" : "video/*,audio/*"
            }
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void analyze(f);
            }}
          />
          <GlassButton
            disabled={busy || locked || limits?.uploads === false}
            onClick={() => picker.current?.click()}
          >
            <FolderOpen size={17} />
            {t("Choose file")}
          </GlassButton>
          <p className="note">
            {t("Drop media here")}
            {limits ? " · " + bytes(limits.maxUpload) : ""}
          </p>
        </div>
      )}
      {busy && !job && (
        <div className="preview" role="status">
          <div className="loading" />
          <p className="note">
            {t(sent !== null ? "Uploading file" : "Reading media")}
            {sent !== null ? " · " + Math.round(sent * 100) + "%" : ""}
          </p>
        </div>
      )}
      {err && (
        <p className="feedback" role="alert">
          {t(err)}
        </p>
      )}
      {media && (
        <motion.div
          className="preview"
          initial={prefs.motion || motionReduced ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", duration: 0.24 }}
        >
          <div className="preview-grid">
            {fileUrl && media.height ? (
              <video
                controls
                preload="metadata"
                src={fileUrl}
                aria-label={t("Media preview")}
              />
            ) : media.thumb ? (
              <img src={media.thumb} alt={t("Media thumbnail")} />
            ) : (
              <span className="symbol">
                {media.height ? <Video /> : <AudioLines />}
              </span>
            )}
            <div>
              <h3>{media.title}</h3>
              <p>
                {[
                  t(media.platform),
                  media.creator,
                  media.duration ? time(media.duration) : "",
                  media.height ? media.width + " × " + media.height : "",
                  media.size ? bytes(media.size) : "",
                  media.container?.split(",")[0],
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {media.page && (
                <a
                  href={media.page}
                  target="_blank"
                  rel="noreferrer"
                  className="view-all"
                >
                  {t("Open source")}
                </a>
              )}
            </div>
          </div>
          {media.reason ? (
            <p className="feedback" role="status">
              {t(media.reason)}
            </p>
          ) : (
            <>
              {action === "export" || action === "convert" ? (
                <Segments
                  disabled={locked || busy}
                  label={t("Export type")}
                  value={kind}
                  onChange={(v) => {
                    if (!locked) {
                      setKind(v);
                      setFormat("");
                    }
                  }}
                  items={(["video", "audio"] as const)
                    .filter((k) => allowKinds.includes(k))
                    .map((k) => [
                      k,
                      t(k === "video" ? "Video" : "Audio"),
                      k === "video" ? <Video key={k} /> : <Music2 key={k} />,
                    ])}
                />
              ) : null}
              {chosen ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <div className="editor-controls">
                    <label>
                      {t("Format")}
                      <select
                        value={chosen.id}
                        disabled={locked || busy}
                        onChange={(e) => setFormat(e.target.value)}
                      >
                        {visible.map((q) => (
                          <option value={q.id} key={q.id}>
                            {t(q.label)}
                            {q.kind === "video"
                              ? " · " + q.ext.toUpperCase()
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {["trim", "audio", "thumbnail"].includes(action) && (
                      <label>
                        {t("Start (seconds)")}
                        <input
                          type="number"
                          min="0"
                          max={media.duration}
                          step="any"
                          required
                          value={start}
                          onChange={(e) => setStart(e.target.value)}
                        />
                      </label>
                    )}
                    {["trim", "audio"].includes(action) && (
                      <label>
                        {t("End (seconds)")}
                        <input
                          type="number"
                          min={Number(start)}
                          max={media.duration}
                          step="any"
                          required
                          value={end}
                          onChange={(e) => setEnd(e.target.value)}
                        />
                      </label>
                    )}
                    {action === "audio" &&
                      [
                        [t("Volume"), volume, setVolume, 2],
                        [t("Fade in"), fadeIn, setFadeIn, 60],
                        [t("Fade out"), fadeOut, setFadeOut, 60],
                      ].map(([l, v, fn, max]) => (
                        <label key={String(l)}>
                          {String(l)}
                          <input
                            type="number"
                            min="0"
                            max={Number(max)}
                            step=".1"
                            value={String(v)}
                            onChange={(e) =>
                              (fn as (v: string) => void)(e.target.value)
                            }
                          />
                        </label>
                      ))}
                    {action === "resize" && (
                      <>
                        <label>
                          {t("Aspect ratio")}
                          <select
                            value={aspect}
                            onChange={(e) => setAspect(e.target.value)}
                          >
                            {["source", "16:9", "9:16", "1:1", "4:5"].map(
                              (v) => (
                                <option key={v}>{v}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          {t("Resize mode")}
                          <select
                            value={fit}
                            onChange={(e) => setFit(e.target.value)}
                          >
                            <option value="fit">{t("Fit")}</option>
                            <option value="crop">{t("Crop")}</option>
                          </select>
                        </label>
                      </>
                    )}
                    {action === "compress" && (
                      <label>
                        {t("Compression")}
                        <select
                          value={compression}
                          onChange={(e) => setCompression(e.target.value)}
                        >
                          {["light", "balanced", "small"].map((v) => (
                            <option key={v} value={v}>
                              {t(v)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <GlassButton variant="primary" disabled={busy || locked}>
                      <Download size={17} />
                      {t("Export")}
                    </GlassButton>
                  </div>
                  <p className="note">
                    {qualityDetails(chosen, media, t, action)}
                    {["trim", "audio"].includes(action)
                      ? " · " + time(Math.max(0, Number(end) - Number(start)))
                      : ""}
                  </p>
                </form>
              ) : (
                <p className="note">
                  {t("No compatible tracks are available for this tool.")}
                </p>
              )}
            </>
          )}
        </motion.div>
      )}
      {job && selectedState && (
        <div className="job">
          <strong role="status">
            {selectedState === "COMPLETED" && <Check size={15} />}{" "}
            {t(stages[selectedState])}
          </strong>
          {!terminal(selectedState) && (
            <>
              <progress
                className="progress"
                max="1"
                value={Number.isFinite(job.ratio) ? job.ratio : undefined}
                aria-label={t("Processing progress")}
              />
              <p className="note">
                {[
                  job.state === "QUEUED" ? "#" + job.position : "",
                  job.ratio !== undefined
                    ? Math.round(job.ratio * 100) + "%"
                    : "",
                  job.bytes !== undefined
                    ? bytes(job.bytes) +
                      (job.total ? " / " + bytes(job.total) : "")
                    : "",
                  job.speed ? bytes(job.speed) + "/s" : "",
                  job.eta ? time(job.eta) + " " + t("remaining") : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <GlassButton
                onClick={() =>
                  api("jobs/" + job.id, "DELETE").catch((e) =>
                    setErr(errorText(e)),
                  )
                }
              >
                {t("Cancel")}
              </GlassButton>
            </>
          )}
          {selectedState === "COMPLETED" && (
            <>
              <p>{job.filename}</p>
              <p className="note">
                {bytes(job.size || 0)} · {job.quality} ·{" "}
                {time(((job.ended || 0) - (job.started || 0)) / 1000)} ·{" "}
                {time(Math.max(0, (job.expires! - now) / 1000))}{" "}
                {t("remaining")}
                {action === "compress" && media?.size
                  ? " · " +
                    Math.round(100 * (1 - (job.size || 0) / media.size)) +
                    "% " +
                    t("size reduction")
                  : ""}
              </p>
              <div className="inline">
                <GlassButton variant="primary" asChild>
                  <a href={"/api/v1/jobs/" + job.id + "/download"} download>
                    <Download size={16} />
                    {t("Download file")}
                  </a>
                </GlassButton>
                <GlassButton
                  onClick={() => {
                    reset();
                    setUrl("");
                    input.current?.focus();
                  }}
                >
                  {t("Process another link")}
                </GlassButton>
              </div>
            </>
          )}
          {["FAILED", "CANCELLED"].includes(selectedState) && (
            <>
              <p className="note">{t(job.message || "")}</p>
              <GlassButton
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    watch(
                      await api<JobView>("jobs/" + job.id + "/retry", "POST"),
                    );
                  } catch (e) {
                    setErr(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("Retry")}
              </GlassButton>
            </>
          )}
        </div>
      )}
    </section>
  );
}
function qualityDetails(
  q: Quality,
  m: Media,
  t: (s: string) => string,
  action: string,
) {
  const copying = q.copy && !["compress", "trim", "resize"].includes(action);
  return [
    q.estimate && (q.kind !== "video" || copying)
      ? t("Estimated file size") + " " + bytes(q.estimate)
      : "",
    q.kind === "video" ? t(m.audio ? "Includes audio" : "Video only") : "",
    q.height ? q.height + "p" : "",
    q.kind === "video" ? t(copying ? "Remux" : "Encode") : "",
    q.ext === "mp3"
      ? t("Higher bitrates cannot restore detail missing from the source.")
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
