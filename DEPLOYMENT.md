# Deploying & Operating snap311.app

Everything you need to build, deploy, point the domain, and manage DNS — without help.

- **Repo:** https://github.com/kfiducia/snap311-website
- **Host:** Cloudflare Pages — project `snap311-website`
- **Live (Cloudflare subdomain):** https://snap311-website.pages.dev
- **Custom domain:** https://snap311.app — **live** (apex attached + validated, auto SSL)
- **Registrar:** Namecheap · **DNS:** Cloudflare (nameservers delegated)

### Current state

- ✅ Site is live at https://snap311.app and https://snap311-website.pages.dev
- ✅ Apex `snap311.app` resolves via a proxied `CNAME → snap311-website.pages.dev`
- ✅ **Git auto-deploy is live** — push to `main` → Cloudflare builds & deploys (~30–40s)
- ✅ iOS **TestFlight** beta live; **Buy Me a Coffee** live
- ⬜ iOS **App Store** — pending Apple approval (gated by `APP_STORE_LIVE`, §6)
- ⬜ **Android** beta — "coming soon" (needs a public open-testing URL; gated by `ANDROID_LIVE`, §6)
- ⬜ `www.snap311.app` — not set up (optional; see §3 "www")
- ⬜ "Open source" claim + GitHub links — removed until the app repo is public (see §7)

> **TL;DR for the next person:** edit files → `npm run build` → `git push`
> (auto-deploys). Store/beta buttons are controlled by flags in
> `src/data/links.ts` (see §6). No deploy token needed.

---

## 1. Local development

```sh
npm install      # once
npm run dev      # http://localhost:4321  (hot reload)
npm run build    # static output -> ./dist
npm run preview  # serve ./dist locally, exactly as it deploys
```

Edit content in `src/components/*.astro`; edit all outbound links in
`src/data/links.ts`.

---

## 2. Deploying

There are two ways. Pick one. **Git integration is recommended** because it
auto-deploys on every push and needs no local token.

### Option A — Git integration (recommended, set up once)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Authorize GitHub, pick **`kfiducia/snap311-website`**.
3. **Build configuration** (exact values):

   | Field | Value |
   |-------|-------|
   | Production branch | `main` |
   | Framework preset | **Astro** |
   | Build command | `npm run build` |
   | Build output directory | `dist` (the field already shows a leading `/`, so just type `dist`) |
   | Root directory (advanced) | *leave blank* |

   Choosing the **Astro** preset usually auto-fills the build command and
   output directory — just confirm they match the table.
4. **Save and Deploy.** From now on, `git push` to `main` redeploys
   automatically. Pull requests get preview URLs.

> ⚠️ The project was first created via Wrangler (Option B), and the
> `snap311.app` custom domain is attached to **that** project. If Git
> integration attaches to the **same** `snap311-website` project, the domain
> stays put — done. If Cloudflare forces a **new** project, either:
> - delete the old Wrangler-made `snap311-website` project first and name the
>   Git project `snap311-website`, **or**
> - let the Git project use a new name, then **move the custom domain**:
>   remove `snap311.app` from the old project (Custom domains → Remove) and
>   add it to the new one (Custom domains → Set up a custom domain).

### Option B — Manual deploy with Wrangler (from your machine)

```sh
npm run build
npx wrangler pages deploy dist --project-name=snap311-website --branch=main
```

First time only, Wrangler opens a browser to log in (or use a token — see
§5). To create the project from scratch:

```sh
npx wrangler pages project create snap311-website --production-branch=main
```

---

## 3. Custom domain: pointing snap311.app at Pages

The domain is registered at **Namecheap**. You do **not** need to transfer
it. You just move **DNS hosting** to Cloudflare (free), then attach the
domain to Pages.

> A registrar transfer is also blocked by ICANN for the first 60 days after
> registration anyway. Moving nameservers is separate and allowed immediately.

### Step 1 — Add the site to Cloudflare

1. Cloudflare dashboard → **Add a site** → enter `snap311.app` → **Free** plan.
2. Cloudflare scans existing records and shows you **two nameservers**, e.g.
   `xandra.ns.cloudflare.com` and `walt.ns.cloudflare.com`.

### Step 2 — Switch nameservers at Namecheap

1. Namecheap → **Domain List** → `snap311.app` → **Manage**.
2. **Nameservers** → change **"Namecheap BasicDNS"** to **"Custom DNS"**.
3. Paste Cloudflare's two nameservers. **Save** (the green checkmark).
4. Wait for Cloudflare to mark the zone **Active** (minutes, up to a few hours).
   You'll get an email.

### Step 3 — Attach the domain to Pages  ✅ done

1. Cloudflare → **Workers & Pages** → `snap311-website` → **Custom domains**.
2. **Set up a custom domain** → enter `snap311.app` → **Activate**.
3. Cloudflare validates the domain and issues SSL automatically (the `.app`
   TLD *requires* HTTPS — Cloudflare handles the certificate).
4. **The apex record:** Pages needs a `CNAME snap311.app → snap311-website.pages.dev`
   (Proxied). It usually auto-creates this when there's no conflicting record.
   If validation is stuck on *"CNAME record not set,"* add it by hand in
   **DNS → Records → Add record**:
   - Type `CNAME` · Name `@` · Target `snap311-website.pages.dev` · **Proxied** (orange cloud)

   > If you see HTTP **522**, a stale/parking record is still at the apex —
   > delete it (see §4) so the Pages CNAME can take over. HTTP **530/1016**
   > means *no* apex record exists yet — add the CNAME above.

Done. https://snap311.app serves the site within ~1–2 minutes.

### www (optional) — not currently set up

To also serve `www.snap311.app`, add one DNS record:

- **DNS → Records → Add record** · Type `CNAME` · Name `www` · Target
  `snap311-website.pages.dev` · **Proxied**.
- Then add `www.snap311.app` under the Pages project's **Custom domains** too.
- (Optional) To redirect `www` → apex, add a **Redirect Rule** (Rules →
  Redirect Rules) from `www.snap311.app/*` to `https://snap311.app/$1`.

---

## 4. Cleaning up DNS records

When you "Add a site," Cloudflare imports whatever records Namecheap had —
usually **parking/placeholder** records you don't want:

- An `A` record for `@` pointing at a Namecheap parking IP
  (e.g. `162.255.119.x`, `198.54.x.x`).
- A `CNAME` for `www` → `parkingpage.namecheap.com` (or similar).
- Sometimes a `URL Redirect` / `TXT` for parking.

**Delete those** so they don't conflict with the Pages records.

### In the dashboard

Cloudflare → `snap311.app` → **DNS** → **Records**. Delete any record that
points to Namecheap parking (`parkingpage`, `registrar-servers.com`, parking
IPs). **Keep**:

- The `CNAME`/`A` that Pages created for `snap311.app` (points to
  `snap311-website.pages.dev` or a Pages IP — added in §3 step 3).
- Any email records (`MX`, SPF/DKIM `TXT`) **only if** you actually use email
  on this domain. (You don't right now — there's no MX needed for the site.)

### Via API / Wrangler (optional)

With a token that has **Zone · DNS · Edit** on `snap311.app` (see §5):

```sh
ZONE=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=snap311.app" \
  -H "Authorization: Bearer $CF_TOKEN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"][0]["id"])')

# list records
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" \
  | python3 -c 'import sys,json;[print(r["id"],r["type"],r["name"],"->",r["content"]) for r in json.load(sys.stdin)["result"]]'

# delete one by id
curl -s -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/<RECORD_ID>" \
  -H "Authorization: Bearer $CF_TOKEN"
```

---

## 5. API tokens (for command-line / automation)

Create at **Cloudflare dashboard → My Profile → API Tokens → Create Token →
Create Custom Token**. Use the **least** permission for the job, set a short
**expiration**, and **delete the token** when finished.

| Task | Permission | Resource |
|------|-----------|----------|
| Deploy the site (Wrangler) | **Account · Cloudflare Pages · Edit** | Account: `kfiducia` |
| List/edit DNS records | **Zone · DNS · Edit** | Zone Resources → Include → `snap311.app` |
| (find the zone by name) | **Zone · Zone · Read** (usually auto-included with DNS·Edit) | same zone |

> ⚠️ Common mistake: **"Account DNS Settings"** is **not** the record-editing
> permission. To add/delete DNS records you need the **Zone**-level **DNS**
> permission, scoped via **Zone Resources** to `snap311.app` (or "All zones
> from an account"). If `GET /zones` returns 0 results, your token is missing
> Zone Resources — or the zone isn't added to the account yet.

Use the token on the CLI like:

```sh
export CLOUDFLARE_API_TOKEN="cfat_..."        # for wrangler
export CLOUDFLARE_ACCOUNT_ID="343e4e0041d450f9a17e3856dc007129"
export CF_TOKEN="$CLOUDFLARE_API_TOKEN"        # for raw curl examples above
```

Account ID is also visible in the dashboard URL: `dash.cloudflare.com/<account-id>`.

---

## 6. Updating content later

| Change | File |
|--------|------|
| All outbound links + store/beta feature flags | `src/data/links.ts` |
| Hero text / buttons | `src/components/Hero.astro` |
| "Why" narrative | `src/components/Why.astro` |
| Steps / features / FAQ copy | `src/components/Steps.astro`, `Features.astro`, `Faq.astro` |
| Support / bug-report channel | App Store reviews — see `Faq.astro` ("What if I find a bug?") |
| Colors / fonts | `src/styles/global.css` (`@theme` block) |
| OpenGraph share image | `public/img/og.png` (1200×630; meta tags in `Layout.astro`) |
| Favicon | `public/favicon.ico` + `public/img/favicon.png` |
| Screenshots | replace files in `public/img/screenshots/` (keep the size suffixes) |

After editing: `npm run build`, then either `git push` (Option A auto-deploy)
or `npx wrangler pages deploy dist --project-name=snap311-website` (Option B).

### Feature flags (in `src/data/links.ts`)

The store/beta buttons are gated so we never link to a download that isn't
publicly available yet. Each "off" flag renders a muted "… — coming soon"
pill; flipping it on turns that into a real button. **After any change:
`npm run build` then `git push`.**

| Constant | Current | What it controls | How to turn on |
|----------|---------|------------------|----------------|
| `APP_STORE_LIVE` | `false` | iOS App Store button + the "Write an App Store review" link in the FAQ | Set to `true` once Apple approves the listing (the URL `APP_STORE_URL` 404s until then) |
| `TESTFLIGHT_URL` | set (live) | iOS TestFlight button | Already live; set to `null` to hide it |
| `ANDROID_LIVE` | `false` | Android beta button | Set to `true` **and** set `ANDROID_URL` to a PUBLIC Play **open testing** URL |
| `ANDROID_URL` | internal-test link (not public) | the Android button's target | Replace with the open-testing opt-in URL before setting `ANDROID_LIVE = true` |

> ⚠️ Don't set `ANDROID_LIVE = true` while `ANDROID_URL` still points at the
> *internal testing* link — that link is invite-only (testers added by email,
> max 100) and the public gets "not available." It must be an **open testing**
> URL. For newer personal Play accounts, open testing/production is gated
> behind a closed test (~12 testers, 14 days).

---

## 7. When the app repo goes public

The app source repo (`github.com/kfiducia/snap311`) is **private** pending a
security review, so the site currently has **no GitHub links at all**. It does
not advertise "open source," and bug reports go through **App Store reviews**
(see `Faq.astro`), not GitHub issues. The footer "Support" link points to the
on-page FAQ (`/#faq`).

Once you've reviewed it and flipped the repo to public, optionally re-add two
things (both reference `GITHUB_REPO`, already defined in `src/data/links.ts`):

1. **`src/components/Features.astro`** — add back the "Open source" line below
   the feature list:
   ```astro
   <p class="mt-8 text-lg text-ink">
     Open source:{" "}
     <a href={GITHUB_REPO} target="_blank" rel="noopener"
        class="font-semibold text-brand underline underline-offset-2 hover:text-navy">
       github.com/kfiducia/snap311
     </a>
   </p>
   ```
   (and re-add `import { GITHUB_REPO } from "../data/links";` at the top)
2. **`src/components/SiteFooter.astro`** — add a `GitHub` link back into the
   footer nav, pointing at `GITHUB_REPO` (and re-add it to the import).

Then `npm run build` and deploy.

---

## 8. Launch checklist / known follow-ups

Open:
- [ ] **iOS App Store:** when Apple approves, set `APP_STORE_LIVE = true` (§6) → lights up the App Store button + the FAQ review link.
- [ ] **Android:** finish the Play closed test (~12 testers, 14 days), set up **open testing**, then put that public URL in `ANDROID_URL` and set `ANDROID_LIVE = true` (§6).
- [ ] **App repo public:** after the security review, optionally re-add the open-source links (§7).
- [ ] (Optional) Add `www.snap311.app` (§3 "www").
- [ ] (Optional) Set up email forwarding for `@snap311.app` via Cloudflare Email Routing (dashboard → Email → Email Routing; catch-all → your address).

Done:
- [x] Site built (Astro + Tailwind), live at https://snap311.app with auto SSL.
- [x] Custom domain attached; DNS on Cloudflare; parking records cleaned up.
- [x] **Git auto-deploy is live** — every push to `main` builds & deploys (§2 Option A).
- [x] OpenGraph card, favicon, privacy link, TestFlight (iOS) + Buy-Me-a-Coffee live.
- [x] Bug reports via App Store reviews; no GitHub links on the public site.
