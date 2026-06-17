// Central place for all outbound links so they're easy to update.

// App Store URL — currently 404s while Apple reviews the v1.0 submission
// (submitted June 17, 2026). It goes live as soon as the app is approved.
export const APP_STORE_URL =
  "https://apps.apple.com/us/app/snap311/id6781074409";

// TestFlight public beta link (App Store Connect → TestFlight → External
// Testing → "Public Link"). Set to null to show a "coming soon" state.
export const TESTFLIGHT_URL: string | null =
  "https://testflight.apple.com/join/d3RN7ceA";

export const BMC_URL = "https://buymeacoffee.com/snap311";

// The app repo is PRIVATE until a security review is done. When it goes
// public, re-add the "Open source: …" line in Features.astro and the
// "GitHub" link in SiteFooter.astro (both used GITHUB_REPO).
export const GITHUB_REPO = "https://github.com/kfiducia/snap311";
// Issues links stay live now — they resolve once the repo is public.
export const GITHUB_ISSUES = "https://github.com/kfiducia/snap311/issues";

export const PRIVACY_URL = "https://kfiducia.github.io/snap311-policy/";
