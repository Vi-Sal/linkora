import type { PlatformProvider } from "./types";
const authorizedYT = () =>
  new Set(
    (process.env.AUTHORIZED_YOUTUBE_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const youtube: PlatformProvider = {
  name: "YouTube",
  authorization: (url) =>
    authorizedYT().has(new URL(url).searchParams.get("v") || "")
      ? undefined
      : "YouTube supplies a preview. A permitted download for this video has not been verified.",
  acceptsRendition: () => true,
};
