#!/usr/bin/env node
// Sync the website's changelog data from the Snap311 app's CHANGELOG.md.
//
// The app's CHANGELOG.md (Keep a Changelog format) is the single source of
// truth. This script parses it and writes src/data/changelog.json, which the
// site renders. RELEASED versions only — the "[Unreleased]" section is skipped
// on purpose, since those changes aren't in users' hands yet.
//
// Usage:
//   node scripts/sync-changelog.mjs <path-to-CHANGELOG.md>
//   SNAP311_CHANGELOG=/abs/path/CHANGELOG.md node scripts/sync-changelog.mjs
//
// Intended to be invoked by the app repo's release workflow, which then
// commits + pushes this website repo.

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

const KNOWN_TYPES = new Set([
  "Added",
  "Changed",
  "Fixed",
  "Removed",
  "Deprecated",
  "Security",
]);

const reRelease = /^##\s+\[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/;
const reUnreleased = /^##\s+\[unreleased\]/i;
const reHeading = /^##\s+/;
const reType = /^###\s+(\w+)\s*$/;
const reBullet = /^[-*]\s+(.*)$/;

const md = await readFile(resolve(src), "utf8");
const lines = md.split("\n");

const releases = [];
let cur = null; // current release object
let type = null; // current change type heading
let buf = null; // lines of the bullet being read

function flushBullet() {
  if (cur && type && buf) {
    const text = clean(buf.join(" "));
    if (text) cur.changes.push({ type, text });
  }
  buf = null;
}
function flushRelease() {
  flushBullet();
  if (cur) releases.push(cur);
  cur = null;
  type = null;
}

for (const line of lines) {
  const mRel = line.match(reRelease);
  if (mRel) {
    flushRelease();
    cur = { version: mRel[1], date: mRel[2], changes: [] };
    continue;
  }
  // Skip the unreleased section (and any other section-level heading).
  if (reUnreleased.test(line) || reHeading.test(line)) {
    flushRelease();
    continue;
  }
  const mType = line.match(reType);
  if (mType && cur) {
    flushBullet();
    type = KNOWN_TYPES.has(mType[1]) ? mType[1] : mType[1];
    continue;
  }
  const mBul = line.match(reBullet);
  if (mBul && cur && type) {
    flushBullet();
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
    flushBullet();
    continue;
  }
}
flushRelease();

if (!releases.length) {
  console.error(
    `Error: parsed 0 released versions from ${src}. ` +
      "Expected '## [x.y.z] - YYYY-MM-DD' headings.",
  );
  process.exit(1);
}

const json = JSON.stringify(releases, null, 2) + "\n";
await writeFile(OUT, json);

const total = releases.reduce((n, r) => n + r.changes.length, 0);
console.log(
  `Wrote ${releases.length} release(s), ${total} change(s) to ` +
    `src/data/changelog.json (latest: v${releases[0].version}).`,
);
