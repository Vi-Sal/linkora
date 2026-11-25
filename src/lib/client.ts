import type { JobView, Media } from "./models";
export async function api<T>(
  route: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch("/api/v1/" + route, {
    method,
    signal,
    cache: "no-store",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const v = await res.json();
  if (!res.ok || !v.success) throw Error(v.message || "Request failed.");
  return v.data;
}
export function upload(
  file: File,
  progress: (n: number) => void,
  signal: AbortSignal,
) {
  return new Promise<Media>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/media/upload");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(e.loaded / e.total);
    };
    const abort = () => xhr.abort();
    xhr.onloadend = () => signal.removeEventListener("abort", abort);
    xhr.onerror = () => reject(Error("The server could not receive the file."));
    xhr.onabort = () => reject(Error("Cancelled"));
    xhr.onload = () =>
      xhr.response?.success
        ? resolve(xhr.response.data)
        : reject(Error(xhr.response?.message || "Upload failed."));
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
}
export function bytes(n: number) {
  return n < 1024
    ? Math.round(n) + " B"
    : n < 1048576
      ? (n / 1024).toFixed(1) + " KB"
      : (n / 1048576).toFixed(1) + " MB";
}
export function time(n: number) {
  return Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2, "0");
}
export type RecordItem = {
  id: string;
  name: string;
  platform: string;
  ext: string;
  quality: string;
  size: number;
  when: number;
};
export function historyList(): RecordItem[] {
  try {
    const list = JSON.parse(localStorage.getItem("linkora.history") || "[]");
    return Array.isArray(list)
      ? list
          .filter((v) => typeof v?.name === "string" && Number.isFinite(v.when))
          .map((v) => ({
            ...v,
            id: v.id || String(v.when) + v.name,
            ext: v.ext || v.name.split(".").pop(),
            platform: v.platform || "Local file",
          }))
      : [];
  } catch {
    return [];
  }
}
export function remember(j: JobView, m: Pick<Media, "platform"> | null) {
  if (!j.filename) return;
  try {
    if (
      JSON.parse(localStorage.getItem("linkora.preferences") || "{}")
        .history === false
    )
      return;
    const list = historyList().filter((h) => h.id !== j.id);
    list.unshift({
      id: j.id,
      name: j.filename,
      platform: m?.platform || "Media",
      quality: j.quality,
      ext: j.filename.split(".").pop() || "",
      size: j.size || 0,
      when: j.ended || Date.now(),
    });
    localStorage.setItem("linkora.history", JSON.stringify(list.slice(0, 100)));
  } catch {}
}
