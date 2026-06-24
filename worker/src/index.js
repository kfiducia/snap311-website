// snap311 status heartbeat — Cloudflare Worker.
//
// Cron (every minute): probe every service in services.json, record history in
// D1, and publish two files to R2 for the website:
//   status.json  — current state (drives the site-wide "something's down" banner)
//   uptime.json  — per-service uptime % (24h/7d/90d), 90-day daily bars, and the
//                  recent incident log (drives the /status page)
//
// "Up" = the host returned an HTTP response < 500 within the timeout. A 5xx, a
// timeout, or a connection error = down. We deliberately don't require 2xx: an
// auth endpoint answering 401/302 is still reachable. Each probe retries once so
// a single dropped packet doesn't open a spurious incident.

import SERVICES from "../services.json";

const UA = "snap311-statuscheck/1 (+https://snap311.app)";
const TIMEOUT_MS = 15000;
const SAMPLE_RETENTION_DAYS = 30;

async function probe(svc) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(svc.url, {
        method: svc.method || "GET",
        headers: { "User-Agent": UA },
        redirect: "manual", // a 3xx is a valid "reachable" answer, don't follow it
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ms = Date.now() - t0;
      // Drain the body so the connection is released (HEAD has none).
      if ((svc.method || "GET") !== "HEAD") {
        try { await res.arrayBuffer(); } catch { /* ignore */ }
      }
      if (res.status < 500) return { id: svc.id, up: true, code: res.status, ms };
      if (attempt === 1) return { id: svc.id, up: false, code: res.status, ms: null };
    } catch {
      if (attempt === 1) return { id: svc.id, up: false, code: 0, ms: null };
    }
  }
  return { id: svc.id, up: false, code: 0, ms: null };
}

const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

function ratioIndex(rows, key) {
  const out = {};
  for (const r of rows || []) {
    out[r.service] = r.total > 0 ? r[key] / r.total : null;
  }
  return out;
}

async function runCheck(env) {
  const now = Date.now();
  const today = dayStr(now);
  const results = await Promise.all(SERVICES.map(probe));
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));

  // ── Record samples + daily rollups ──────────────────────────────────────
  const writes = [];
  for (const r of results) {
    writes.push(
      env.DB.prepare("INSERT INTO samples (ts, service, up, ms, code) VALUES (?,?,?,?,?)")
        .bind(now, r.id, r.up ? 1 : 0, r.ms, r.code),
      env.DB.prepare(
        "INSERT INTO daily (day, service, ups, total) VALUES (?,?,?,1) " +
        "ON CONFLICT(day, service) DO UPDATE SET ups = ups + ?, total = total + 1",
      ).bind(today, r.id, r.up ? 1 : 0, r.up ? 1 : 0),
    );
  }
  await env.DB.batch(writes);

  // ── Open/close incidents on state transitions ───────────────────────────
  const open = (await env.DB.prepare("SELECT id, service FROM incidents WHERE ended IS NULL").all()).results || [];
  const openByService = new Map(open.map((row) => [row.service, row.id]));
  const incidentWrites = [];
  for (const r of results) {
    const openId = openByService.get(r.id);
    if (!r.up && openId == null) {
      incidentWrites.push(
        env.DB.prepare("INSERT INTO incidents (service, started, last_code) VALUES (?,?,?)").bind(r.id, now, r.code),
      );
    } else if (!r.up && openId != null) {
      incidentWrites.push(env.DB.prepare("UPDATE incidents SET last_code = ? WHERE id = ?").bind(r.code, openId));
    } else if (r.up && openId != null) {
      incidentWrites.push(env.DB.prepare("UPDATE incidents SET ended = ? WHERE id = ?").bind(now, openId));
    }
  }
  if (incidentWrites.length) await env.DB.batch(incidentWrites);

  // ── status.json (current state, for the banner) ─────────────────────────
  const services = {};
  for (const s of SERVICES) {
    const r = byId[s.id];
    services[s.id] = { up: r.up, code: r.code, ms: r.ms, group: s.group, name: s.name };
  }
  const down = results.filter((r) => !r.up).map((r) => r.id);
  const status = { checked: now, overall: down.length ? "down" : "operational", down, services };
  await env.DATA.put("status.json", JSON.stringify(status), {
    httpMetadata: { contentType: "application/json", cacheControl: "max-age=30" },
  });

  // ── uptime.json (history, for the /status page) ─────────────────────────
  const since24 = now - 24 * 3600 * 1000;
  const day7 = dayStr(now - 7 * 86400 * 1000);
  const day90 = dayStr(now - 90 * 86400 * 1000);
  const u24rows = (await env.DB.prepare(
    "SELECT service, AVG(up) AS up, COUNT(*) AS total FROM samples WHERE ts >= ? GROUP BY service",
  ).bind(since24).all()).results || [];
  const u24 = {};
  for (const r of u24rows) u24[r.service] = r.up; // AVG(up) is already a ratio
  const u7 = ratioIndex((await env.DB.prepare(
    "SELECT service, SUM(ups) AS ups, SUM(total) AS total FROM daily WHERE day >= ? GROUP BY service",
  ).bind(day7).all()).results, "ups");
  const u90 = ratioIndex((await env.DB.prepare(
    "SELECT service, SUM(ups) AS ups, SUM(total) AS total FROM daily WHERE day >= ? GROUP BY service",
  ).bind(day90).all()).results, "ups");
  const daily = (await env.DB.prepare(
    "SELECT day, service, ups, total FROM daily WHERE day >= ? ORDER BY day",
  ).bind(day90).all()).results || [];
  const incidents = (await env.DB.prepare(
    "SELECT service, started, ended, last_code FROM incidents ORDER BY started DESC LIMIT 50",
  ).all()).results || [];

  const uptime = {
    generated: now,
    services: SERVICES.map((s) => ({
      id: s.id, name: s.name, group: s.group, note: s.note,
      up: services[s.id].up, code: services[s.id].code, ms: services[s.id].ms,
      uptime: { d1: u24[s.id] ?? null, d7: u7[s.id] ?? null, d90: u90[s.id] ?? null },
    })),
    daily,
    incidents,
  };
  await env.DATA.put("uptime.json", JSON.stringify(uptime), {
    httpMetadata: { contentType: "application/json", cacheControl: "max-age=60" },
  });

  // ── Prune raw samples hourly ────────────────────────────────────────────
  if (new Date(now).getUTCMinutes() === 0) {
    await env.DB.prepare("DELETE FROM samples WHERE ts < ?")
      .bind(now - SAMPLE_RETENTION_DAYS * 86400 * 1000).run();
  }

  return status;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env));
  },
  // Debug/seed: GET ?run forces a check now; otherwise serve the last status.json.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.has("run")) {
      return Response.json(await runCheck(env));
    }
    const obj = await env.DATA.get("status.json");
    return obj
      ? new Response(obj.body, { headers: { "content-type": "application/json" } })
      : new Response("no status yet — hit ?run once", { status: 404 });
  },
};
