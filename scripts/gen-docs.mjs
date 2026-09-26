/** Writes CHANGELOG.md and ROADMAP.md from the JSON the app itself reads,
 *  so the repo and the release notes panel can never drift apart. */
import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const releases = read("../src/meta/releases.json");
const roadmap = read("../src/meta/roadmap.json");

const changelog = [
  "# Change notes",
  "",
  "_Generated from `src/meta/releases.json` — edit that file, then run `npm run docs`._",
  "",
  ...releases.flatMap((r) => [
    `## ${r.version} — ${r.title}`,
    `_${r.date}_`,
    "",
    ...r.items.map((i) => `- ${i}`),
    "",
  ]),
].join("\n");

const STATES = { next: "Next", later: "Later", considering: "Considering" };
const roadmapMd = [
  "# Roadmap",
  "",
  "_Generated from `src/meta/roadmap.json` — edit that file, then run `npm run docs`._",
  "",
  ...Object.entries(STATES).flatMap(([key, label]) => {
    const items = roadmap.filter((r) => r.state === key);
    return items.length
      ? [`## ${label}`, "", ...items.map((i) => `- **${i.title}** — ${i.detail}`), ""]
      : [];
  }),
].join("\n");

writeFileSync(new URL("../CHANGELOG.md", import.meta.url), changelog);
writeFileSync(new URL("../ROADMAP.md", import.meta.url), roadmapMd);
console.log("CHANGELOG.md and ROADMAP.md written");
