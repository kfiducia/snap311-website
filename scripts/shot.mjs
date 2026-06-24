// Dev-only visual check: screenshot the page (or one element) via Playwright.
//   node scripts/shot.mjs [url] [outfile] [selector]
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:4321/";
const out = process.argv[3] || "/tmp/page.png";
const selector = process.argv[4] || null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });

if (selector) {
  // Scroll the (lazy-loaded) section into view first so its IntersectionObserver fires.
  await page.locator(selector).scrollIntoViewIfNeeded();
}
// Wait for the live feed to actually populate, then a beat for map tiles.
await page
  .waitForSelector("[data-rr-feed] [data-lat]", { timeout: 9000 })
  .catch(() => {});
await page.waitForTimeout(2000);

if (selector) {
  const el = await page.$(selector);
  if (!el) throw new Error(`selector not found: ${selector}`);
  await el.screenshot({ path: out });
} else {
  await page.screenshot({ path: out, fullPage: true });
}
await browser.close();
console.log("saved", out);
