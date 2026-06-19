// Typed access to the site's changelog data.
//
// The DATA in changelog.json is GENERATED — do not hand-edit it. It's produced
// by `npm run sync:changelog` from the Snap311 app's CHANGELOG.md (the single
// source of truth). Edit the app's CHANGELOG.md and re-run the sync instead.
//
// Entries are a flat, newest-first timeline. Each entry is either a native
// store BUILD (`kind: "build"`, changes grouped by type) or an over-the-air
// OTA update batch (`kind: "ota"`, untyped changes shipped to an existing
// version). The app changelog's "[Unreleased]" section is excluded by the sync.

import data from "./changelog.json";

export type ChangeType =
  | "Added"
  | "Changed"
  | "Fixed"
  | "Removed"
  | "Deprecated"
  | "Security";

export interface Change {
  type?: ChangeType; // present on build entries; absent on OTA entries
  text: string;
}

// Per-platform native build number, e.g. { label: "iOS", number: "42" }.
export interface BuildRef {
  label: string;
  number: string;
}

export interface Entry {
  kind: "build" | "ota";
  version: string; // the build's version, or the version an OTA targets
  date: string; // ISO 8601, e.g. "2026-06-17"
  builds?: BuildRef[]; // native build numbers; OTA inherits its target version's
  bundle?: string; // OTA only: EAS Update short id, shown as "Bundle:" in the app
  changes: Change[];
}

// "iOS 42 · Android 17"
export function formatBuilds(builds?: BuildRef[]): string {
  if (!builds || !builds.length) return "";
  return builds.map((b) => `${b.label} ${b.number}`).join(" · ");
}

// Newest first (OTA batches sort ahead of the build they target).
export const entries: Entry[] = data as Entry[];

export const latestEntry: Entry | undefined = entries[0];

// "June 17, 2026" — parsed as UTC so the day doesn't shift by timezone.
export function formatReleaseDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// First sentence of a change, for compact homepage teasers. Falls back to the
// full text when there's no clear sentence break.
export function teaser(text: string): string {
  const m = text.match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : text;
}
