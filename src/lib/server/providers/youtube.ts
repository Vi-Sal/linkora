import type { PlatformProvider } from "./types";

export const youtube: PlatformProvider = {
  name: "YouTube",
  acceptsRendition: () => true,
};
