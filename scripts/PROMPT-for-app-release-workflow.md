# Prompt to hand to the Snap311 **app repo** agent

Paste everything below the line into a Claude Code session running in the
Snap311 app repo (`git@github.com:kfiducia/snap311.git`,
`/Users/kfiducia/GitHub/snap311`). It asks that agent to add a release step that
syncs and publishes the marketing website's changelog whenever you cut a
release.

---

I want to automate publishing our changelog to the marketing website as part of
cutting a release in this (the Snap311 app) repo.

## Context / the contract the website already provides

- This repo's `CHANGELOG.md` (root, Keep a Changelog format) is the **single
  source of truth** for release notes.
- The marketing website is a **separate repo**:
  `git@github.com:kfiducia/snap311-website.git`, cloned locally at
  `/Users/kfiducia/snap311-website`.
- That website repo has a sync script already built for this:

  ```
  cd /Users/kfiducia/snap311-website
  npm run sync:changelog -- <absolute-path-to-this-repo's-CHANGELOG.md>
  # equivalently: node scripts/sync-changelog.mjs <path>
  ```

  It parses the CHANGELOG.md, writes `src/data/changelog.json`, and
  **intentionally skips the `[Unreleased]` section** (only shipped versions go
  on the site). It exits non-zero on failure (e.g. no released version found).
- The website **auto-deploys on push to `main`** via Cloudflare Pages (~30–40s).
  No build token needed — pushing is what publishes.
- `src/data/changelog.json` in the website repo is generated — never hand-edit
  it; re-run the sync instead.

## What I want you to build

A release step / workflow in **this** repo that, when I cut a release (i.e.
after `CHANGELOG.md` has the new `## [x.y.z] - YYYY-MM-DD` section finalized and
moved out of `[Unreleased]`):

1. Runs the website's `sync:changelog` script against this repo's `CHANGELOG.md`.
2. In the website repo, stages `src/data/changelog.json`, and **only if it
   changed**, commits it (message like
   `Changelog: sync v<version> from app`) and pushes to `main` (which triggers
   the Cloudflare deploy).
3. Is idempotent and safe to re-run: a no-op (no commit, no push) when the
   website is already in sync.
4. Fails loudly if the website repo isn't present at the expected path or the
   sync script errors — don't silently skip publishing.

## Decisions I'd like you to make (and explain your choice)

- **Where this lives.** Options: a local release shell script
  (`scripts/release.sh` or similar) that I run as part of cutting a release —
  simplest, matches the website's "edit → push" ops model; OR a GitHub Actions
  workflow in this repo that checks out the website repo and pushes to it
  (needs a deploy key / PAT with write access to `snap311-website`, since this
  repo is private and they're separate). Recommend one; I lean toward the local
  script unless you see a strong reason for CI.
- Make the website repo path configurable (env var or arg, default
  `/Users/kfiducia/snap311-website`) rather than hard-coded.

## Constraints

- Don't change the website's data format or its sync script — treat
  `npm run sync:changelog -- <path>` as a stable interface.
- The website only shows released versions; don't try to publish
  `[Unreleased]`.
- Keep my existing release process intact — add the website-sync step to it,
  don't replace it.

Show me the plan before writing anything.
