// Central place for all outbound links so they're easy to update.

// App Store URL — 404s while Apple reviews the v1.0 submission (submitted
// June 17, 2026). Flip APP_STORE_LIVE to true once it's approved; until then
// the hero shows an "App Store — coming soon" state instead of a dead link.
export const APP_STORE_URL =
  "https://apps.apple.com/us/app/snap311/id6781074409";
export const APP_STORE_LIVE = false;

// TestFlight public beta link (App Store Connect → TestFlight → External
// Testing → "Public Link"). Set to null to show a "coming soon" state.
export const TESTFLIGHT_URL: string | null =
  "https://testflight.apple.com/join/d3RN7ceA";

// Android beta. IMPORTANT: the link below is a Play *internal testing* link —
// it's invite-only (testers added by email, max 100) and NOT publicly
// joinable, so the public can't use it. Replace it with the PUBLIC *open
// testing* opt-in URL and flip ANDROID_LIVE to true; until then the hero
// shows an "Android beta — coming soon" state.
export const ANDROID_URL: string | null =
  "https://play.google.com/apps/internaltest/4701447524912025594";
export const ANDROID_LIVE = false;

export const BMC_URL = "https://buymeacoffee.com/snap311";

// The app repo is PRIVATE until a security review is done, so these aren't
// linked from the site right now. Bug reports go through App Store reviews
// instead (see Faq.astro). When the repo goes public, optionally re-add the
// "Open source: …" line in Features.astro and a "GitHub" footer link.
export const GITHUB_REPO = "https://github.com/kfiducia/snap311";
export const GITHUB_ISSUES = "https://github.com/kfiducia/snap311/issues";

export const PRIVACY_URL = "https://kfiducia.github.io/snap311-policy/";
