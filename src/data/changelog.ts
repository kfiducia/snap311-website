// Typed access to the site's changelog data.
//
// The DATA in changelog.json is GENERATED — do not hand-edit it. It's produced
// by `npm run sync:changelog` from the Snap311 app's CHANGELOG.md (the single
// source of truth). Edit the app's CHANGELOG.md and re-run the sync instead.
//
// Only released versions appear here; the app changelog's "[Unreleased]"
// section is intentionally excluded by the sync script.

import data from "./changelog.json";

export type ChangeType =
  | "Added"
  | "Changed"
  | "Fixed"
  | "Removed"
  | "Deprecated"
  | "Security";

export interface Change {
  type: ChangeType;
  text: string;
}

export interface Release {
  version: string;
  date: string; // ISO 8601, e.g. "2026-06-17"
  changes: Change[];
}

// Newest first (the sync script preserves CHANGELOG.md order).
export const releases: Release[] = data as Release[];

export const latestRelease: Release | undefined = releases[0];

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
