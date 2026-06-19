#!/usr/bin/env node
// Sync the website's changelog data from the Snap311 app's CHANGELOG.md.
//
// The app's CHANGELOG.md (Keep a Changelog format, extended for OTA updates) is
// the single source of truth. This script parses it into src/data/changelog.json
// as a flat, newest-first list of ENTRIES, where an entry is either:
//
//   - a native store BUILD:   `## [x.y.z] - YYYY-MM-DD`, with its changes
//     grouped under `### Added/Changed/Fixed/...`
//   - an OTA update batch:    `### OTA updates to <version>` then a dated
//     `#### YYYY-MM-DD` block of (untyped) bullets, shipped over-the-air to
//     installs of <version>
//
// RELEASED content only — the `[Unreleased]` section is skipped on purpose,
// since those changes aren't in users' hands yet. OTA batches are newer than
// the build they target, so entries are sorted by date, newest first.
//
// Usage:
//   node scripts/sync-changelog.mjs <path-to-CHANGELOG.md>
//   SNAP311_CHANGELOG=/abs/path/CHANGELOG.md node scripts/sync-changelog.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../src/data/changelog.json");

const src = process.argv[2] || process.env.SNAP311_CHANGELOG;
if (!src) {
  console.error(
    "Error: no CHANGELOG.md path given.\n" +
      "  Usage: node scripts/sync-changelog.mjs <path-to-CHANGELOG.md>\n" +
      "  or set SNAP311_CHANGELOG=/abs/path/CHANGELOG.md",
  );
  process.exit(1);
}

// Strip the markdown we don't render as plain text, and collapse whitespace.
function clean(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/\*(.+?)\*/g, "$1") // *italic*
    .replace(/`(.+?)`/g, "$1") // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) -> text
    .replace(/\s+/g, " ")
    .trim();
}

// Build heading, with an optional trailing `(iOS 42, Android 17)` carrying
// per-platform build numbers: group 3 is the parenthetical contents.
const reRelease = /^##\s+\[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*(?:\(([^)]*)\))?\s*$/;
const reUnreleased = /^##\s+\[unreleased\]/i;

// Pull `Platform Number` pairs out of a build parenthetical, e.g.
// "iOS 42, Android 17" or "iOS build 42 · Android build 17".
function parseBuilds(s) {
  if (!s) return undefined;
  const out = [];
  const re = /([A-Za-z][A-Za-z.]*)\s+(?:build\s+)?(\d[\w.]*)/g;
  let m;
  while ((m = re.exec(s))) out.push({ label: m[1], number: m[2] });
  return out.length ? out : undefined;
}
const reOtaSection = /^###\s+OTA updates to\s+(.+?)\s*$/i;
// OTA batch date, with an optional `(a1b2c3d4)` carrying the EAS Update bundle
// id this OTA shipped as: group 1 = date, group 2 = parenthetical (bundle id).
const reOtaDate = /^####\s+(\d{4}-\d{2}-\d{2})\s*(?:\(([^)]*)\))?\s*$/;
const reType = /^###\s+(\w+)\s*$/;
// Optional type markers inside an OTA batch — either `##### Fixed` subheadings
// or a whole-line `**Fixed**` bold marker. If OTA items aren't categorized,
// they're just a flat bullet list and stay untyped.
const reOtaType = /^(?:#####\s+|\*\*)(\w+)(?:\*\*)?\s*$/;
const reHeading = /^##\s/; // any other section-level heading
const reBullet = /^[-*]\s+(.*)$/;

const md = await readFile(resolve(src), "utf8");
const lines = md.split("\n");

const entries = [];
let cur = null; // current build entry
let curType = null; // current `### Type` within a build
let curOta = null; // current dated OTA batch entry
let otaVersion = null; // version the active OTA section targets
let mode = "none"; // "build" | "ota" | "none"
let buf = null; // lines of the bullet being read

function pushBullet() {
  if (!buf) return;
  const text = clean(buf.join(" "));
  buf = null;
  if (!text) return;
  if (mode === "build" && cur && curType) {
    cur.changes.push({ type: curType, text });
  } else if (mode === "ota" && curOta) {
    // OTA items are typed only if the changelog categorizes them.
    curOta.changes.push(curType ? { type: curType, text } : { text });
  }
}

function resetSection() {
  pushBullet();
  curType = null;
}

for (const line of lines) {
  const mRel = line.match(reRelease);
  if (mRel) {
    resetSection();
    cur = { kind: "build", version: mRel[1], date: mRel[2], changes: [] };
    const builds = parseBuilds(mRel[3]);
    if (builds) cur.builds = builds;
    curOta = null;
    otaVersion = null;
    mode = "build";
    entries.push(cur);
    continue;
  }
  // Skip the unreleased section.
  if (reUnreleased.test(line)) {
    resetSection();
    cur = null;
    curOta = null;
    mode = "none";
    continue;
  }
  const mOta = line.match(reOtaSection);
  if (mOta) {
    resetSection();
    otaVersion = mOta[1];
    curOta = null; // a `#### date` opens the actual batch
    mode = "ota";
    continue;
  }
  const mOtaDate = line.match(reOtaDate);
  if (mOtaDate && otaVersion) {
    resetSection();
    curOta = {
      kind: "ota",
      version: otaVersion,
      date: mOtaDate[1],
      changes: [],
    };
    const bundle = (mOtaDate[2] || "").trim();
    if (bundle) curOta.bundle = bundle;
    mode = "ota";
    entries.push(curOta);
    continue;
  }
  // Optional category marker inside an OTA batch (`##### Fixed` or `**Fixed**`).
  const mOtaType = line.match(reOtaType);
  if (mOtaType && mode === "ota" && curOta) {
    pushBullet();
    curType = mOtaType[1];
    continue;
  }
  const mType = line.match(reType);
  if (mType && cur && mode !== "ota") {
    pushBullet();
    curType = mType[1];
    mode = "build";
    continue;
  }
  // Any other section heading ends the current context.
  if (reHeading.test(line)) {
    resetSection();
    cur = null;
    curOta = null;
    mode = "none";
    continue;
  }
  const mBul = line.match(reBullet);
  if (mBul) {
    pushBullet();
    buf = [mBul[1]];
    continue;
  }
  // Wrapped continuation of the current bullet (indented, non-empty).
  if (buf && /^\s+\S/.test(line)) {
    buf.push(line.trim());
    continue;
  }
  // Blank line ends the current bullet.
  if (line.trim() === "") {
    pushBullet();
    continue;
  }
  // Everything else (italic notes, blockquotes, reference links) is ignored.
}
pushBullet();

// Drop empty entries (e.g. a build whose changes were all unreleased).
const kept = entries.filter((e) => e.changes.length > 0);

// An OTA ships on top of whatever native build a user has, so stamp each OTA
// with the build numbers in effect on its date: for each platform, the most
// recent build entry (same version, date <= the OTA's) that names it. This
// handles platform-only rebuilds — e.g. an Android-3 build dated after the
// original build means later OTAs correctly read "Android 3" while earlier
// ones still read "Android 2".
const buildEntries = kept.filter((e) => e.kind === "build" && e.builds);
for (const e of kept) {
  if (e.kind !== "ota" || e.builds) continue;
  const prior = buildEntries
    .filter((b) => b.version === e.version && b.date <= e.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1)); // oldest first
  if (!prior.length) continue;
  const byLabel = new Map();
  for (const b of prior) {
    for (const ref of b.builds) byLabel.set(ref.label, ref); // later date wins
  }
  if (byLabel.size) e.builds = [...byLabel.values()];
}

// Newest date first. For entries that share a date (e.g. same-day OTAs, or an
// OTA and a native rebuild on the same day), preserve the order they appear in
// CHANGELOG.md — the author writes it newest-first, and that's a more reliable
// signal than any kind-based assumption (a same-day native rebuild can ship
// after that day's OTAs, which the old "OTA always before build" rule got
// wrong). Array.sort is stable, so returning 0 keeps document order.
kept.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

if (!kept.length) {
  console.error(
    `Error: parsed 0 released entries from ${src}. ` +
      "Expected '## [x.y.z] - YYYY-MM-DD' headings.",
  );
  process.exit(1);
}

const json = JSON.stringify(kept, null, 2) + "\n";
await writeFile(OUT, json);

const builds = kept.filter((e) => e.kind === "build").length;
const otas = kept.filter((e) => e.kind === "ota").length;
const total = kept.reduce((n, e) => n + e.changes.length, 0);
const top = kept[0];
console.log(
  `Wrote ${kept.length} entr${kept.length === 1 ? "y" : "ies"} ` +
    `(${builds} build, ${otas} OTA), ${total} change(s) to ` +
    `src/data/changelog.json (latest: ${top.kind === "ota" ? "OTA → v" : "v"}${top.version}, ${top.date}).`,
);
