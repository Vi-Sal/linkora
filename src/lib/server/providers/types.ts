export interface PlatformProvider {
  name: "YouTube" | "TikTok";
  authorization: (url: string) => string | undefined;
  acceptsRendition: (id: string) => boolean;
  downloadRestriction?: (
    url: string,
    signal: AbortSignal,
  ) => Promise<string | undefined>;
}
