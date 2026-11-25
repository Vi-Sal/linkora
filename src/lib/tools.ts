import {
  Video,
  Music2,
  Scissors,
  Image,
  Minimize2,
  RefreshCw,
  Captions,
  Scaling,
  AudioLines,
  Layers,
  Home,
  LayoutGrid,
  History,
  Settings,
} from "lucide-react";
export const tools = [
  {
    path: "/youtube",
    name: "Video export",
    desc: "Save video in your preferred format.",
    icon: Video,
  },
  {
    path: "/mp3",
    name: "Audio converter",
    desc: "Extract and convert audio tracks.",
    icon: Music2,
  },
  {
    path: "/tools/trim",
    name: "Video trimmer",
    desc: "Keep just the moments you need.",
    icon: Scissors,
  },
  {
    path: "/tools/thumbnail",
    name: "Thumbnail exporter",
    desc: "Capture a frame from your video.",
    icon: Image,
  },
  {
    path: "/tools/compress",
    name: "Video compressor",
    desc: "Reduce video size and bitrate.",
    icon: Minimize2,
  },
  {
    path: "/tools/convert",
    name: "Media converter",
    desc: "Change your audio or video format.",
    icon: RefreshCw,
  },
  {
    path: "/tools/subtitles",
    name: "Subtitle exporter",
    desc: "Export available caption tracks.",
    icon: Captions,
  },
  {
    path: "/tools/resize",
    name: "Video resizer",
    desc: "Scale video to a smaller resolution.",
    icon: Scaling,
  },
  {
    path: "/tools/audio",
    name: "Audio editor",
    desc: "Trim an audio track to a selection.",
    icon: AudioLines,
  },
  {
    path: "/tools/batch",
    name: "Batch export",
    desc: "Queue a group of approved links.",
    icon: Layers,
  },
];
export const nav = [
  { path: "/", name: "Home", icon: Home },
  { path: "/tools", name: "Tools", icon: LayoutGrid },
  { path: "/history", name: "History", icon: History },
  { path: "/settings", name: "Settings", icon: Settings },
];
export const infoPages: Record<
  string,
  { title: string; sections: [string, string][] }
> = {
  faq: {
    title: "FAQ",
    sections: [
      [
        "Which links can I export?",
        "Linkora supports public HTTPS media files, publisher-enabled TikTok downloads, and accessible YouTube videos. Availability depends on the source and the server network.",
      ],
      [
        "How does an export work?",
        "Analyze a link or choose a file, select an available format, then export. Progress comes from the media engine.",
      ],
      [
        "How long is my file available?",
        "Completed files expire after 15 minutes by default. History keeps a record of your export on this device.",
      ],
    ],
  },
  privacy: {
    title: "Privacy",
    sections: [
      [
        "Temporary processing",
        "The server receives submitted links and uploaded files. Processing uses temporary storage. Completed files expire automatically.",
      ],
      [
        "On this device",
        "Preferences and optional export history use browser storage. A short-lived anonymous cookie protects your jobs and downloads.",
      ],
      [
        "Hosting",
        "The hosting provider may retain operational logs. External providers receive requests for media metadata and content.",
      ],
    ],
  },
  terms: {
    title: "Terms of use",
    sections: [
      [
        "Permission to export",
        "Submit only media you own or have permission to process. Respect the platform’s download settings and content rights.",
      ],
      [
        "Availability",
        "Private, protected, restricted, or unavailable media may be limited to a preview. Export limits depend on server capacity.",
      ],
    ],
  },
};
