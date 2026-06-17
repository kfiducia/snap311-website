# Deploying & Operating snap311.app

Everything you need to build, deploy, point the domain, and manage DNS — without help.

- **Repo:** https://github.com/kfiducia/snap311-website
- **Host:** Cloudflare Pages — project `snap311-website`
- **Live (Cloudflare subdomain):** https://snap311-website.pages.dev
- **Target custom domain:** https://snap311.app
- **Registrar:** Namecheap · **DNS (planned):** Cloudflare

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
3. Build settings:
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Production branch:** `main`
4. **Save and Deploy.** From now on, `git push` to `main` redeploys
   automatically. Pull requests get preview URLs.

> Note: the project was first created via Wrangler (Option B). If you connect
> Git to the *same* project name, it takes over deploys cleanly. If
> Cloudflare insists on a new project, either delete the Wrangler-made
> `snap311-website` project first, or name the Git project something else and
> move the custom domain to it.

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

### Step 3 — Attach the domain to Pages

1. Cloudflare → **Workers & Pages** → `snap311-website` → **Custom domains**.
2. **Set up a custom domain** → enter `snap311.app` → **Activate**.
3. Because DNS is now on Cloudflare, the required record is created
   automatically. SSL is issued automatically (the `.app` TLD *requires*
   HTTPS — Cloudflare handles the certificate).
4. Optional: repeat for `www.snap311.app` and set up a redirect to the apex.

Done. https://snap311.app serves the site within a few minutes.

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
| Any link (App Store, TestFlight, Buy Me a Coffee, GitHub, privacy) | `src/data/links.ts` |
| Hero text / buttons | `src/components/Hero.astro` |
| "Why" narrative | `src/components/Why.astro` |
| Steps / features / FAQ copy | `src/components/Steps.astro`, `Features.astro`, `Faq.astro` |
| Colors / fonts | `src/styles/global.css` (`@theme` block) |
| Screenshots | replace files in `public/img/screenshots/` (keep the size suffixes) |

After editing: `npm run build`, then either `git push` (Option A auto-deploy)
or `npx wrangler pages deploy dist --project-name=snap311-website` (Option B).
