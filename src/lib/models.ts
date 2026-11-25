export type Platform =
  "YouTube" | "TikTok" | "Direct link" | "Local file" | "Vimeo" | "SoundCloud";
export type Quality = {
  id: string;
  kind: "video" | "audio" | "image" | "subtitle";
  ext: string;
  label: string;
  height?: number;
  rate?: number;
  estimate?: number;
  copy?: boolean;
  language?: string;
  track?: number;
};
export type Media = {
  id: string;
  title: string;
  creator: string;
  platform: Platform;
  page?: string;
  thumb?: string;
  duration: number;
  width: number;
  height: number;
  audio: boolean;
  size?: number;
  container?: string;
  formats: Quality[];
  reason?: string;
  code?: string;
};
export type Stage =
  | "QUEUED"
  | "ANALYZING"
  | "DOWNLOADING"
  | "PROCESSING"
  | "MERGING"
  | "CONVERTING"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";
export type JobView = {
  id: string;
  state: Stage;
  created: number;
  started?: number;
  ended?: number;
  expires?: number;
  ratio?: number;
  bytes?: number;
  total?: number;
  speed?: number;
  eta?: number;
  position?: number;
  message?: string;
  code?: string;
  filename?: string;
  size?: number;
  quality: string;
};
export type Limits = {
  maxFile: number;
  maxUpload: number;
  duration: number;
  height: number;
  ttl: number;
  batch: boolean;
  batchSize: number;
  uploads: boolean;
  heavy: boolean;
  direct: boolean;
  directHosts: string[];
};
export const terminal = (s: Stage) =>
  ["COMPLETED", "CANCELLED", "FAILED", "EXPIRED"].includes(s);
