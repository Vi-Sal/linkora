"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { History as Clock, LayoutGrid } from "lucide-react";
import { Workspace } from "./Workspace";
import { useUI } from "./Shell";
import { GlassButton, GlassDialog, Segments } from "./Glass";
import { tools, infoPages } from "@/lib/tools";
import { historyList, bytes, api, type RecordItem } from "@/lib/client";
import { terminal, type Limits, type JobView, type Media } from "@/lib/models";
function Cards({ all = false, limits }: { all?: boolean; limits: Limits }) {
  const { t } = useUI();
  return (
    <div className="tool-grid">
      {(all ? tools : tools.slice(0, 4)).map(
        ({ path, name, desc, icon: I }) => {
          const off =
            (path.endsWith("/batch") && !limits.batch) ||
            (["/tools/resize", "/tools/compress"].includes(path) &&
              !limits.heavy);
          const inside = (
            <>
              <span className="tool-top">
                <span className="symbol">
                  <I size={21} />
                </span>
                {off && <span className="tool-status">{t("Unavailable")}</span>}
              </span>
              <h3>{t(name)}</h3>
              <p>{t(desc)}</p>
            </>
          );
          return off ? (
            <button key={path} className="tool-card glass" disabled>
              {inside}
            </button>
          ) : (
            <Link key={path} className="tool-card glass" href={path}>
              {inside}
            </Link>
          );
        },
      )}
    </div>
  );
}
function HistoryPage() {
  const { t } = useUI();
  const [list, set] = useState<RecordItem[]>([]),
    [query, search] = useState(""),
    [platform, pf] = useState(""),
    [format, fmt] = useState(""),
    [order, sort] = useState("new"),
    [confirm, ask] = useState(false);
  useEffect(() => {
    queueMicrotask(() => set(historyList()));
  }, []);
  const save = (v: RecordItem[]) => {
    localStorage.setItem("linkora.history", JSON.stringify(v));
    set(v);
  };
  const matches = list
    .filter(
      (h) =>
        h.name.toLowerCase().includes(query.toLowerCase()) &&
        (!platform || h.platform === platform) &&
        (!format || h.ext === format),
    )
    .sort((a, b) => (order === "new" ? b.when - a.when : a.when - b.when));
  return (
    <>
      <h1>{t("History")}</h1>
      <p className="subheading">
        {t(
          "History keeps export details on this device. Expired files require a new export.",
        )}
      </p>
      {list.length ? (
        <section className="group glass">
          <div className="editor-controls">
            <label>
              {t("Search")}
              <input
                type="search"
                value={query}
                onChange={(e) => search(e.target.value)}
              />
            </label>
            {[
              [t("Media source"), platform, pf, list.map((h) => h.platform)],
              [t("Format"), format, fmt, list.map((h) => h.ext)],
            ].map(([l, v, fn, values]) => (
              <label key={String(l)}>
                {String(l)}
                <select
                  value={String(v)}
                  onChange={(e) => (fn as typeof pf)(e.target.value)}
                >
                  <option value="">{t("All")}</option>
                  {[...new Set(values as string[])].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              {t("Sort")}
              <select value={order} onChange={(e) => sort(e.target.value)}>
                <option value="new">{t("Newest first")}</option>
                <option value="old">{t("Oldest first")}</option>
              </select>
            </label>
            <GlassButton onClick={() => ask(true)}>
              {t("Clear history")}
            </GlassButton>
          </div>
          {matches.map((h) => (
            <div className="row" key={h.id}>
              <div className="history-name">
                {h.name}
                <small>
                  {h.platform} · {h.quality} ·{" "}
                  {new Date(h.when).toLocaleString()}
                </small>
              </div>
              <div className="inline">
                <span className="chip">{bytes(h.size)}</span>
                <GlassButton
                  onClick={() => save(list.filter((x) => x.id !== h.id))}
                >
                  {t("Remove")}
                </GlassButton>
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="group glass empty">
          <span className="symbol">
            <Clock />
          </span>
          <h2>{t("No exports yet")}</h2>
          <p>{t("Your completed exports will appear here.")}</p>
          <GlassButton asChild>
            <Link href="/">{t("Open workspace")}</Link>
          </GlassButton>
        </section>
      )}
      {confirm && <Clear close={() => ask(false)} clear={() => save([])} />}
    </>
  );
}
function Clear({ close, clear }: { close: () => void; clear: () => void }) {
  const { t } = useUI();
  return (
    <GlassDialog title={t("Clear local history?")} close={close}>
      <p className="dialog-text">
        {t(
          "This removes the export list from this browser. Your downloaded files stay on your device.",
        )}
      </p>
      <div className="inline">
        <GlassButton onClick={close}>{t("Cancel")}</GlassButton>
        <GlassButton
          variant="primary"
          onClick={() => {
            clear();
            close();
          }}
        >
          {t("Clear history")}
        </GlassButton>
      </div>
    </GlassDialog>
  );
}
function SettingsPage() {
  const { prefs, change, t } = useUI(),
    [confirm, ask] = useState(false);
  const select = (
    key: "language" | "quality" | "bitrate" | "audio",
    label: string,
    values: string[],
    labels: string[] = values,
  ) => (
    <label className="row">
      {t(label)}
      <select
        value={prefs[key]}
        onChange={(e) => change({ [key]: e.target.value })}
      >
        {values.map((v, i) => (
          <option key={v} value={v}>
            {labels[i]}
          </option>
        ))}
      </select>
    </label>
  );
  const toggle = (key: "motion" | "opaque" | "history", label: string) => (
    <label className="row">
      {t(label)}
      <input
        className="switch"
        type="checkbox"
        role="switch"
        checked={prefs[key]}
        onChange={(e) => change({ [key]: e.target.checked })}
      />
    </label>
  );
  return (
    <>
      <h1>{t("Settings")}</h1>
      <p className="subheading">{t("Make Linkora feel at home.")}</p>
      <section className="group glass">
        <h2>{t("Appearance")}</h2>
        <div className="row">
          {t("Theme")}
          <Segments
            label={t("Theme")}
            value={prefs.theme}
            items={["system", "light", "dark"].map((k) => [
              k,
              t(k[0].toUpperCase() + k.slice(1)),
            ])}
            onChange={(theme) => change({ theme })}
          />
        </div>
        {toggle("motion", "Reduce motion")}
        {toggle("opaque", "Reduce transparency")}
        {select("language", "Language", ["en", "km"], ["English", "ខ្មែរ"])}
      </section>
      <section className="group glass">
        <h2>{t("Export defaults")}</h2>
        {select(
          "quality",
          "Video quality",
          ["best", "1080", "720", "480", "360"],
          [t("Best available"), "1080p", "720p", "480p", "360p"],
        )}
        {select(
          "audio",
          "Audio format",
          ["mp3", "m4a", "wav", "aac"],
          ["MP3", "M4A", "WAV", "AAC"],
        )}
        {select(
          "bitrate",
          "Audio bitrate",
          ["128", "192", "256", "320"],
          ["128 kbps", "192 kbps", "256 kbps", "320 kbps"],
        )}
      </section>
      <section className="group glass">
        <h2>{t("Privacy & history")}</h2>
        {toggle("history", "Save export history")}
        <div className="row">
          {t("Local history")}
          <GlassButton onClick={() => ask(true)}>
            {t("Clear history")}
          </GlassButton>
        </div>
        <p className="note">{t(infoPages.privacy.sections[0][1])}</p>
      </section>
      <section className="group glass">
        <h2>{t("About Linkora")}</h2>
        <div className="row">
          <span className="inline">
            <img src="/assets/logo.svg" alt="" width="25" />
            Linkora
          </span>
          <span className="chip">1.1.0</span>
        </div>
        {["FAQ", "Privacy", "Terms of use"].map((v, i) => (
          <Link
            key={v}
            className="row"
            href={["/faq", "/privacy", "/terms"][i]}
          >
            {t(v)}
          </Link>
        ))}
      </section>
      {confirm && (
        <Clear
          close={() => ask(false)}
          clear={() => localStorage.removeItem("linkora.history")}
        />
      )}
    </>
  );
}
function Batch({ limits }: { limits: Limits }) {
  const { t } = useUI(),
    [links, set] = useState(""),
    [results, items] = useState<JobView[]>([]),
    [err, error] = useState(""),
    [busy, working] = useState(false);
  async function batch() {
    const urls = links
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!urls.length || urls.length > limits.batchSize) {
      error("The batch exceeds the configured limit.");
      return;
    }
    items([]);
    error("");
    working(true);
    try {
      for (const url of urls) {
        const m = await api<Media>("media/analyze", "POST", { url });
        const f =
          m.formats.find((v) => v.id === "mp4-best") ||
          m.formats.find((v) => v.id === "mp3-192");
        if (!f) throw Error(m.reason || "Format unavailable.");
        const j = await api<JobView>("media/export", "POST", {
          mediaId: m.id,
          format: f.id,
        });
        await new Promise<void>((ok, fail) => {
          const es = new EventSource("/api/v1/jobs/" + j.id + "/progress");
          es.onmessage = (e) => {
            const v = JSON.parse(e.data) as JobView;
            items((old) => [...old.filter((r) => r.id !== v.id), v]);
            if (terminal(v.state)) {
              es.close();
              if (v.state === "COMPLETED") ok();
              else fail(Error(v.message));
            }
          };
          es.onerror = () => {
            void api<JobView>("jobs/" + j.id).catch((e) => {
              es.close();
              fail(e);
            });
          };
        });
      }
    } catch (e) {
      error(e instanceof Error ? e.message : "Request failed.");
    } finally {
      working(false);
    }
  }
  return (
    <section className="group glass">
      <h1>{t("Batch export")}</h1>
      {limits.batch ? (
        <>
          <label>
            {t("One media URL per line")}
            <textarea
              className="batch-links"
              value={links}
              onChange={(e) => set(e.target.value)}
            />
          </label>
          <GlassButton disabled={busy} onClick={() => void batch()}>
            {t("Export")}
          </GlassButton>
          {results.map((j) => (
            <div className="row" key={j.id}>
              {j.filename || t(j.state)}
              {j.ratio !== undefined && Math.round(j.ratio * 100) + "%"}
              {j.state === "COMPLETED" && (
                <a download href={"/api/v1/jobs/" + j.id + "/download"}>
                  {t("Download file")}
                </a>
              )}
            </div>
          ))}
          {err && <p role="alert">{t(err)}</p>}
        </>
      ) : (
        <p className="note">{t("Batch export is disabled on this server.")}</p>
      )}
    </section>
  );
}
export function Pages({ path, limits }: { path: string; limits: Limits }) {
  const { t } = useUI();
  const info = infoPages[path.slice(1)],
    home = path === "/";
  return (
    <div className={(home ? "" : "page ") + "shell"}>
      {home ? (
        <>
          <section className="hero">
            <div className="hero-copy">
              <div className="hero-ticks" aria-hidden="true" />
              <h1>
                {t("Media, beautifully")}
                <span>{t("simplified.")}</span>
              </h1>
              <p>{t("One link. Endless possibilities.")}</p>
            </div>
          </section>
          <Workspace />
          <section>
            <div className="section-head">
              <h2>{t("Media tools")}</h2>
              <Link className="view-all" href="/tools">
                {t("View all tools")}
                <LayoutGrid size={15} />
              </Link>
            </div>
            <Cards limits={limits} />
          </section>
          <div className="help">
            <details>
              <summary>{t("How does an export work?")}</summary>
              <p>{t(infoPages.faq.sections[1][1])}</p>
            </details>
            <details>
              <summary>{t("Temporary processing")}</summary>
              <p>{t(infoPages.privacy.sections[0][1])}</p>
            </details>
          </div>
        </>
      ) : path === "/tools" ? (
        <>
          <h1>{t("Media tools")}</h1>
          <p className="subheading">
            {t("Choose a tool to work with your media.")}
          </p>
          <Cards all limits={limits} />
        </>
      ) : path === "/settings" ? (
        <SettingsPage />
      ) : path === "/history" ? (
        <HistoryPage />
      ) : info ? (
        <>
          <h1>{t(info.title)}</h1>
          {info.sections.map(([h, b]) => (
            <section key={h} className="group glass">
              <h2>{t(h)}</h2>
              <p>{t(b)}</p>
            </section>
          ))}
        </>
      ) : path === "/tools/batch" ? (
        <Batch limits={limits} />
      ) : (
        <>
          <h1>{t(tools.find((v) => v.path === path)?.name || "TikTok")}</h1>
          <Workspace key={path} path={path} />
        </>
      )}
    </div>
  );
}
