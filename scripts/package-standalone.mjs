import { cp, mkdir } from "node:fs/promises";
const root = ".next/standalone";
await mkdir(root + "/scripts", { recursive: true });
await Promise.all([
  cp("public", root + "/public", { recursive: true }),
  cp(".next/static", root + "/.next/static", { recursive: true }),
  cp("scripts/extractor.py", root + "/scripts/extractor.py"),
]);
