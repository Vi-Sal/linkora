export interface PlatformProvider {
  name: "YouTube" | "TikTok";
  acceptsRendition: (id: string) => boolean;
  downloadRestriction?: (
    url: string,
    signal: AbortSignal,
  ) => Promise<string | undefined>;
}
