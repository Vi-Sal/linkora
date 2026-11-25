import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Problem, limits } from "./config";
import type { Platform } from "../models";
export function urlOf(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Problem("INVALID_URL", "Enter a complete HTTPS media URL.", 400);
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hostname.endsWith(".") ||
    value.length > 4096
  )
    throw new Problem(
      "INVALID_URL",
      "Use HTTPS without credentials or a custom port.",
      400,
    );
  return u;
}
export const networks = {
  YouTube: [
    "youtube.com",
    "youtu.be",
    "googlevideo.com",
    "ytimg.com",
    "youtube-nocookie.com",
    "googleapis.com",
  ],
  TikTok: [
    "tiktok.com",
    "tiktokcdn.com",
    "tiktokcdn-us.com",
    "tiktokv.com",
    "tiktokcdn-eu.com",
    "byteoversea.com",
    "ibytedtos.com",
    "muscdn.com",
  ],
};
export function normalize(value: string): {
  platform: Platform;
  url: string;
  short?: boolean;
} {
  const u = urlOf(value),
    h = u.hostname;
  let id: string | null;
  if (
    [
      "www.youtube.com",
      "youtube.com",
      "music.youtube.com",
      "m.youtube.com",
      "youtu.be",
    ].includes(h)
  ) {
    id =
      h === "youtu.be"
        ? u.pathname.slice(1)
        : u.pathname === "/watch"
          ? u.searchParams.get("v")
          : (u.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)\/?$/)?.[1] ??
            null);
    if (!id || !/^[-\w]{11}$/.test(id))
      throw new Problem(
        "INVALID_URL",
        "Use a single YouTube video or Shorts URL.",
        400,
      );
    return {
      platform: "YouTube",
      url: "https://www.youtube.com/watch?v=" + id,
    };
  }
  if (
    [
      "www.tiktok.com",
      "m.tiktok.com",
      "tiktok.com",
      "vm.tiktok.com",
      "vt.tiktok.com",
    ].includes(h)
  ) {
    if (
      (["vm.tiktok.com", "vt.tiktok.com"].includes(h) &&
        /^\/[a-zA-Z0-9]+\/?$/.test(u.pathname)) ||
      /^\/t\/[a-zA-Z0-9]+\/?$/.test(u.pathname)
    )
      return { platform: "TikTok", url: u.origin + u.pathname, short: true };
    if (!/^\/@[\w.-]+\/video\/\d{8,24}\/?$/.test(u.pathname))
      throw new Problem("INVALID_URL", "Use a TikTok video link.", 400);
    return {
      platform: "TikTok",
      url: "https://www.tiktok.com" + u.pathname.replace(/\/$/, ""),
    };
  }
  if (
    [
      "vimeo.com",
      "www.vimeo.com",
      "soundcloud.com",
      "www.soundcloud.com",
    ].includes(h)
  )
    return {
      platform: h.includes("vimeo") ? "Vimeo" : "SoundCloud",
      url: u.href,
    };
  if (!limits.directHosts.includes(h))
    throw new Problem(
      "UNSUPPORTED_PLATFORM",
      "This host is outside the approved media sources.",
      400,
    );
  if (!limits.direct)
    throw new Problem(
      "EXPORT_DISABLED",
      "Direct media URL processing is disabled on this server.",
    );
  return { platform: "Direct link", url: u.href };
}
export function publicIP(ip: string) {
  try {
    return ipaddr.process(ip).range() === "unicast";
  } catch {
    return false;
  }
}
export async function requestPublic(
  url: string,
  hosts: string[],
  signal: AbortSignal,
  redirects = 4,
  headers: Record<string, string> = {},
) {
  const u = urlOf(url);
  if (!hosts.includes(u.hostname))
    throw new Problem(
      "INVALID_URL",
      "The destination is outside the approved hosts.",
      400,
    );
  const ips = await lookup(u.hostname, { all: true });
  if (!ips.length || ips.some((a) => !publicIP(a.address)))
    throw new Problem(
      "INVALID_URL",
      "Only public media hosts are supported.",
      400,
    );
  const address = ips.find((a) => a.family === 4) || ips[0];
  const response = await new Promise<import("node:http").IncomingMessage>(
    (resolve, reject) => {
      const req = https.get(
        u,
        {
          signal,
          agent: false,
          family: address.family,
          lookup: (_h, _o, cb) => cb(null, address.address, address.family),
          headers: { "User-Agent": "Linkora/1.1", ...headers },
        },
        resolve,
      );
      req.on("error", reject);
    },
  );
  if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
    const next = response.headers.location;
    response.destroy();
    if (!next || !redirects)
      throw new Problem(
        "INVALID_URL",
        "The provider returned too many redirects.",
      );
    return requestPublic(
      new URL(next, u).href,
      hosts,
      signal,
      redirects - 1,
      headers,
    );
  }
  if (
    response.statusCode !== 200 &&
    !(headers.Range && response.statusCode === 206)
  ) {
    response.destroy();
    throw new Problem(
      "PLATFORM_RESTRICTED",
      "The media host returned HTTP " + response.statusCode + ".",
    );
  }
  return { response, final: u.href };
}
