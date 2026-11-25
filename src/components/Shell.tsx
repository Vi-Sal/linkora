"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Sun, Moon, Globe, ChevronDown, Check } from "lucide-react";
import { translate } from "@/lib/i18n";
import { nav } from "@/lib/tools";
import { GlassDialog } from "./Glass";
const defaults = {
  theme: "system",
  language: "en",
  history: true,
  quality: "1080",
  bitrate: "192",
  audio: "mp3",
  motion: false,
  opaque: false,
};
type Prefs = typeof defaults;
const Context = createContext({
  prefs: defaults,
  change: (v: Partial<Prefs>) => {
    void v;
  },
  t: (s: string) => s,
});
export const useUI = () => useContext(Context);
export function Shell({ children }: { children: ReactNode }) {
  const [prefs, set] = useState(defaults),
    [menu, menuSet] = useState(""),
    [loaded, setLoaded] = useState(false);
  const route = usePathname(),
    t = (s: string) => translate(prefs.language, s);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("linkora.preferences") || "{}");
      queueMicrotask(() => {
        set({ ...defaults, ...v });
        setLoaded(true);
      });
    } catch {
      queueMicrotask(() => setLoaded(true));
    }
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const dark = matchMedia("(prefers-color-scheme:dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        prefs.theme === "dark" || (prefs.theme === "system" && dark.matches)
          ? "dark"
          : "light";
      document.documentElement.dataset.motion = prefs.motion
        ? "reduce"
        : "system";
      document.documentElement.dataset.opaque = String(prefs.opaque);
      document.documentElement.lang = prefs.language === "km" ? "km" : "en";
    };
    apply();
    dark.addEventListener("change", apply);
    return () => dark.removeEventListener("change", apply);
  }, [prefs, loaded]);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !(e.target as HTMLElement).closest("input,textarea,select,dialog")
      ) {
        const field = document.getElementById("media-url");
        if (field) {
          e.preventDefault();
          field.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  function change(v: Partial<Prefs>) {
    const p = { ...prefs, ...v };
    set(p);
    try {
      localStorage.setItem("linkora.preferences", JSON.stringify(p));
    } catch {}
  }
  const links = nav.map(({ name, path, icon: I }) => (
    <Link
      key={path}
      href={path}
      aria-current={
        route === path || (path === "/tools" && route.startsWith("/tools/"))
          ? "page"
          : undefined
      }
    >
      <I size={17} />
      <span>{t(name)}</span>
    </Link>
  ));
  return (
    <Context.Provider value={{ prefs, change, t }}>
      <a className="skip" href="#content">
        {t("Skip to content")}
      </a>
      <header className="bar shell glass">
        <Link className="brand" href="/">
          <img src="/assets/logo.svg" width="34" height="31" alt="" />
          Linkora
        </Link>
        <nav aria-label="Main">{links}</nav>
        <div className="header-actions">
          <button
            className="icon-button"
            title={t("Appearance")}
            aria-label={t("Appearance")}
            onClick={() => menuSet("Appearance")}
          >
            {prefs.theme === "dark" ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <span className="divider" />
          <button
            className="language-button"
            aria-label={t("Language")}
            onClick={() => menuSet("Language")}
          >
            <Globe size={17} />
            {prefs.language === "km" ? "ខ្មែរ" : "EN"}
            <ChevronDown size={14} />
          </button>
        </div>
      </header>
      <main id="content" tabIndex={-1}>
        {children}
      </main>
      <nav id="bottom-nav" className="glass" aria-label="Mobile navigation">
        {links}
      </nav>
      <footer className="shell">
        <span className="footer-brand">
          <img src="/assets/logo.svg" alt="" width="19" />
          Linkora
        </span>
        <div>
          {["FAQ", "Privacy", "Terms of use"].map((l, i) => (
            <Link key={l} href={["/faq", "/privacy", "/terms"][i]}>
              {t(l)}
            </Link>
          ))}
        </div>
      </footer>
      {menu && (
        <GlassDialog menu title={t(menu)} close={() => menuSet("")}>
          {(menu === "Appearance"
            ? [
                ["system", "System"],
                ["light", "Light"],
                ["dark", "Dark"],
              ]
            : [
                ["en", "English"],
                ["km", "ខ្មែរ"],
              ]
          ).map(([k, v]) => (
            <button
              className={
                "dialog-choice " +
                ([prefs.theme, prefs.language].includes(k) ? "selected" : "")
              }
              key={k}
              onClick={() => {
                change(menu === "Appearance" ? { theme: k } : { language: k });
                menuSet("");
              }}
            >
              {t(v)}
              {[prefs.theme, prefs.language].includes(k) && <Check size={16} />}
            </button>
          ))}
        </GlassDialog>
      )}
    </Context.Provider>
  );
}
