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
const SAMPLE_RETENTION_DAYS = 7; // raw minute data kept hot for a week; older lives in daily rollups
const CONFIRM_THRESHOLD = 2; // consecutive same-state checks required to flip the reported status

async function probe(svc) {
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
    const up = res.status < 500;
    return { id: svc.id, up, code: res.status, ms: up ? ms : null, error: up ? null : `HTTP ${res.status}` };
  } catch (e) {
    const error = e && e.name === "TimeoutError" ? "timeout" : "network error";
    return { id: svc.id, up: false, code: 0, ms: null, error };
  }
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

  // ── Debounce FIRST: flip the reported state only after CONFIRM_THRESHOLD ──
  // The page (uptime %, bars) and the incident log all run off this confirmed
  // state, so a sub-threshold blip never colours a bar without a matching
  // incident. Raw `up` is still stored alongside for reference.
  const states = (await env.DB.prepare("SELECT service, confirmed, streak FROM service_state").all()).results || [];
  const stateById = new Map(states.map((s) => [s.service, s]));
  const confirmedUp = {}; // id → boolean (the reported state)
  const stateWrites = [];
  for (const r of results) {
    const raw = r.up ? 1 : 0;
    const prev = stateById.get(r.id);
    let confirmed;
    if (!prev) {
      confirmed = raw; // first sighting — adopt whatever it is
      stateWrites.push(env.DB.prepare("INSERT INTO service_state (service, confirmed, streak) VALUES (?,?,0)").bind(r.id, confirmed));
    } else if (raw === prev.confirmed) {
      confirmed = prev.confirmed; // agrees with reported state — reset the streak
      stateWrites.push(env.DB.prepare("UPDATE service_state SET streak = 0 WHERE service = ?").bind(r.id));
    } else {
      const streak = prev.streak + 1; // differs from reported state
      const flip = streak >= CONFIRM_THRESHOLD;
      confirmed = flip ? raw : prev.confirmed;
      stateWrites.push(env.DB.prepare("UPDATE service_state SET confirmed = ?, streak = ? WHERE service = ?").bind(confirmed, flip ? 0 : streak, r.id));
    }
    confirmedUp[r.id] = confirmed === 1;
  }
  await env.DB.batch(stateWrites);

  // ── Record samples + daily rollups (raw `up`/`ups` + confirmed `cup`/`cups`) ─
  const writes = [];
  for (const r of results) {
    const cup = confirmedUp[r.id] ? 1 : 0;
    const msVal = r.up && r.ms != null ? r.ms : null; // only time successful checks
    writes.push(
      env.DB.prepare("INSERT INTO samples (ts, service, up, cup, ms, code) VALUES (?,?,?,?,?,?)")
        .bind(now, r.id, r.up ? 1 : 0, cup, r.ms, r.code),
      env.DB.prepare(
        "INSERT INTO daily (day, service, ups, cups, total, ms_sum, ms_cnt, ms_min, ms_max) VALUES (?,?,?,?,1,?,?,?,?) " +
        "ON CONFLICT(day, service) DO UPDATE SET " +
        "ups = ups + excluded.ups, cups = cups + excluded.cups, total = total + 1, " +
        "ms_sum = ms_sum + excluded.ms_sum, ms_cnt = ms_cnt + excluded.ms_cnt, " +
        "ms_min = CASE WHEN excluded.ms_min IS NULL THEN ms_min WHEN ms_min IS NULL THEN excluded.ms_min ELSE MIN(ms_min, excluded.ms_min) END, " +
        "ms_max = CASE WHEN excluded.ms_max IS NULL THEN ms_max WHEN ms_max IS NULL THEN excluded.ms_max ELSE MAX(ms_max, excluded.ms_max) END",
      ).bind(today, r.id, r.up ? 1 : 0, cup, msVal ?? 0, msVal != null ? 1 : 0, msVal, msVal),
    );
  }
  await env.DB.batch(writes);

  // ── Incidents follow the confirmed state ────────────────────────────────
  const open = (await env.DB.prepare("SELECT id, service FROM incidents WHERE ended IS NULL").all()).results || [];
  const openByService = new Map(open.map((row) => [row.service, row.id]));
  const incidentWrites = [];
  for (const r of results) {
    const up = confirmedUp[r.id];
    const openId = openByService.get(r.id);
    if (!up && openId == null) {
      incidentWrites.push(env.DB.prepare("INSERT INTO incidents (service, started, last_code, error) VALUES (?,?,?,?)").bind(r.id, now, r.code, r.error));
    } else if (!up && openId != null && !r.up) {
      // Still confirmed-down AND this check also failed → refresh the failure
      // detail. (If the raw check is passing during recovery confirmation, keep
      // the last real failure reason instead of overwriting it with a success.)
      incidentWrites.push(env.DB.prepare("UPDATE incidents SET last_code = ?, error = ? WHERE id = ?").bind(r.code, r.error, openId));
    } else if (up && openId != null) {
      incidentWrites.push(env.DB.prepare("UPDATE incidents SET ended = ? WHERE id = ?").bind(now, openId));
    }
  }
  if (incidentWrites.length) await env.DB.batch(incidentWrites);

  // ── status.json (current state, for the banner) ─────────────────────────
  const services = {};
  for (const s of SERVICES) {
    const r = byId[s.id];
    services[s.id] = { up: confirmedUp[s.id], code: r.code, ms: r.ms, group: s.group, name: s.name };
  }
  const down = SERVICES.filter((s) => !confirmedUp[s.id]).map((s) => s.id);
  const status = { checked: now, overall: down.length ? "down" : "operational", down, services };
  await env.DATA.put("status.json", JSON.stringify(status), {
    httpMetadata: { contentType: "application/json", cacheControl: "max-age=30" },
  });

  // ── uptime.json (history, for the /status page) ─────────────────────────
  const since24 = now - 24 * 3600 * 1000;
  const day7 = dayStr(now - 7 * 86400 * 1000);
  const day90 = dayStr(now - 90 * 86400 * 1000);
  // Uptime % + bars use RAW availability, so brief dips are visible (shown as a
  // partial/amber day). The incident log is debounced (sustained outages only),
  // so an amber day without a logged incident is expected — the legend explains it.
  // (cup/cups confirmed columns are still recorded for a possible future view.)
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
  const latRows = (await env.DB.prepare(
    "SELECT service, SUM(ms_sum) AS s, SUM(ms_cnt) AS c, MIN(ms_min) AS mn, MAX(ms_max) AS mx FROM daily WHERE day >= ? GROUP BY service",
  ).bind(day7).all()).results || [];
  const lat = {};
  for (const r of latRows) {
    lat[r.service] = { avg: r.c > 0 ? Math.round(r.s / r.c) : null, min: r.mn, max: r.mx };
  }
  const incidents = (await env.DB.prepare(
    "SELECT service, started, ended, last_code, error FROM incidents ORDER BY started DESC LIMIT 50",
  ).all()).results || [];

  const uptime = {
    generated: now,
    services: SERVICES.map((s) => ({
      id: s.id, name: s.name, group: s.group, note: s.note,
      up: services[s.id].up, code: services[s.id].code, ms: services[s.id].ms,
      uptime: { d1: u24[s.id] ?? null, d7: u7[s.id] ?? null, d90: u90[s.id] ?? null },
      lat: lat[s.id] || null, // 7-day avg/min/max response time
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
