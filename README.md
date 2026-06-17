# Snap311 — Marketing Website

The marketing site for **Snap311**, an independent, unofficial iOS app for
filing DC 311 service requests. Lives at **[snap311.app](https://snap311.app)**.

It's a single static page: hero, the "why", how it works, screenshots,
features, a tip section, FAQ, and footer. No backend, no analytics, no
tracking — matching the app's privacy-conscious stance.

## Tech stack

- [Astro](https://astro.build) (static output)
- [Tailwind CSS v4](https://tailwindcss.com) (via the `@tailwindcss/vite` plugin)
- Plain Astro components — no JS framework, no CMS
- Responsive WebP images with PNG fallbacks

## Develop

```sh
npm install        # install dependencies
npm run dev        # dev server at http://localhost:4321
```

## Build

```sh
npm run build      # outputs static site to ./dist/
npm run preview    # serve the production build locally
```

## Project structure

```text
public/img/            app icon, DC skyline, App Store badge, screenshots
src/
  data/links.ts        all outbound URLs (App Store, TestFlight, BMC, GitHub…)
  layouts/Layout.astro  <head>, meta/OG tags, global styles
  components/           Hero, Why, Steps, Screenshots, Features, Support, Faq, SiteFooter
  pages/index.astro    assembles the single page
  styles/global.css    Tailwind import + brand theme tokens
```

### Updating links

Edit `src/data/links.ts`. Notable:

- `APP_STORE_URL` — the App Store listing (404s until Apple approves review).
- `TESTFLIGHT_URL` — public TestFlight link; set to `null` to show a
  "coming soon" pill instead of a button.

## Deploy (Cloudflare Pages)

This site is hosted on **Cloudflare Pages**.

**Via Git integration (recommended):** connect this repo in the Cloudflare
dashboard with:

- **Framework preset:** Astro
- **Build command:** `npm run build`
- **Build output directory:** `dist`

Every push to `main` triggers a deploy.

**Via Wrangler (manual):**

```sh
npm run build
npx wrangler pages deploy dist --project-name=snap311-website
```

### Custom domain

`snap311.app` is added under **Pages → the project → Custom domains**. The
domain is registered at Namecheap; DNS is delegated to Cloudflare
(Namecheap → nameservers → Cloudflare's), which lets Pages manage the apex
record and SSL automatically. The `.app` TLD requires HTTPS — Cloudflare
provisions the certificate automatically.

## License

[MIT](./LICENSE)
