#!/usr/bin/env python3
"""Build the static snapshots for the snap311 exploration map.

The exploration map needs to answer "is this already reported?" without a
database server: the browser/app downloads a small file (or two) and filters
it client-side. This script produces those files.

Two snapshots, two cadences — so the frequent job stays cheap and the heavy
historical sweep only runs once a day:

  active.json  — "Last 90 Days" layer (open + recently-closed). Small, churns
                 fast, rebuilt every ~20 min. This is what the shipped app
                 fetches; its shape is unchanged.
  aging.json   — every STILL-OPEN request older than the 90-day window, swept
                 from DC's per-year layers (2009..current). Large but slow to
                 change, rebuilt once a day. Purely additive depth — clients
                 union it with active.json by SERVICEREQUESTID.

Usage:

  # DEV testing with a stale local scrape:
  python build_active.py --jsonl ../data/dc311_2026.jsonl --out dev-active.json

  # Frequent cron — the live "Last 90 Days" layer:
  python build_active.py --arcgis --out active.json

  # Daily cron — the full open backlog older than 90 days:
  python build_active.py --aging --out aging.json

"Active" = currently Open / In-Progress, OR closed within `--closed-days`
(default 7). "Aging" = currently Open / In-Progress and added more than
`--older-than-days` ago (default 80 — a deliberate overlap with active's
90-day window so the two never leave a gap at the seam; clients dedupe).

The output is intentionally compact (~0.3 MB gzipped per file) so it can be
served from static hosting and filtered in the browser with a plain bbox scan
— no spatial index, no DB.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SERVICE_BASE = (
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/"
    "DCGIS_DATA/ServiceRequests/MapServer"
)
ARCGIS_LAYER = f"{SERVICE_BASE}/13"  # "All Service Requests - Last 90 Days"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
PAGE = 1000  # layer maxRecordCount

OPEN_STATUSES = {"Open", "Open (Duplicate)", "In-Progress", "In Progress"}
OPEN_WHERE = (
    "SERVICEORDERSTATUS IN "
    "('Open','Open (Duplicate)','In-Progress','In Progress')"
)
OUT_FIELDS = (
    "SERVICEREQUESTID,SERVICEORDERSTATUS,SERVICECODEDESCRIPTION,"
    "ADDDATE,RESOLUTIONDATE,SERVICEDUEDATE,LATITUDE,LONGITUDE"
)
DAY_MS = 24 * 60 * 60 * 1000


def status_code(raw: str) -> int:
    if raw in ("In-Progress", "In Progress"):
        return 1
    if raw in ("Open", "Open (Duplicate)"):
        return 0
    return 2  # closed (only kept if recently closed)


def build(records, now_ms: int, closed_days: int):
    """records: iterable of attribute dicts. Returns (cats, pts)."""
    cutoff = now_ms - closed_days * DAY_MS
    cats: list[str] = []
    cat_idx: dict[str, int] = {}

    def cat_of(desc: str) -> int:
        if desc not in cat_idx:
            cat_idx[desc] = len(cats)
            cats.append(desc)
        return cat_idx[desc]

    pts = []
    for a in records:
        lat = a.get("LATITUDE")
        lng = a.get("LONGITUDE")
        if lat is None or lng is None:
            continue
        raw = a.get("SERVICEORDERSTATUS") or ""
        res = a.get("RESOLUTIONDATE")
        is_open = raw in OPEN_STATUSES
        closed_recently = (not is_open) and res is not None and res >= cutoff
        if not (is_open or closed_recently):
            continue
        code = status_code(raw)
        pts.append(
            [
                a.get("SERVICEREQUESTID"),
                round(float(lat), 6),
                round(float(lng), 6),
                code,
                cat_of(a.get("SERVICECODEDESCRIPTION") or "Service request"),
                a.get("ADDDATE"),  # opened (epoch ms) — client derives age
                res if code == 2 else None,  # resolved (epoch ms) for closed
                a.get("SERVICEDUEDATE"),  # due (epoch ms) — for the SLA progress ring
            ]
        )
    return cats, pts


def from_jsonl(path: str):
    rows = []
    max_date = 0
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            a = json.loads(line)["attributes"]
            rows.append(a)
            for k in ("ADDDATE", "RESOLUTIONDATE"):
                if a.get(k):
                    max_date = max(max_date, a[k])
    # Use the snapshot's own latest timestamp as "now" so stale data still
    # surfaces its recently-closed requests when testing in dev.
    return rows, max_date


def _get_json(url: str, attempts: int = 5):
    """GET + parse JSON with retry/backoff. DC's ArcGIS intermittently 503s or
    times out for cloud (CI) IPs, and the daily sweep makes ~19 calls, so a
    single transient failure shouldn't sink the whole run."""
    delay = 3
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError) as e:
            # A genuine client error (4xx other than rate-limit) won't fix
            # itself — fail fast instead of burning retries.
            if isinstance(e, urllib.error.HTTPError) and 400 <= e.code < 500 and e.code != 429:
                raise
            if i == attempts - 1:
                raise
            print(f"  retry {i + 1}/{attempts - 1} after {type(e).__name__}: {e}", file=sys.stderr)
            time.sleep(delay)
            delay *= 2


def fetch_layer(layer_url: str, where: str):
    """Page through one ArcGIS layer, returning a list of attribute dicts."""
    rows = []
    offset = 0
    while True:
        params = {
            "f": "json",
            "where": where,
            "outFields": OUT_FIELDS,
            "returnGeometry": "false",
            "resultOffset": str(offset),
            "resultRecordCount": str(PAGE),
            "orderByFields": "OBJECTID",
        }
        data = _get_json(f"{layer_url}/query?{urllib.parse.urlencode(params)}")
        if data.get("error"):
            raise SystemExit(f"ArcGIS error ({layer_url}): {data['error']}")
        feats = data.get("features", [])
        rows.extend(f["attributes"] for f in feats)
        if not data.get("exceededTransferLimit") and len(feats) < PAGE:
            break
        offset += PAGE
    return rows


def from_arcgis(closed_days: int):
    now_ms = int(time.time() * 1000)
    cutoff_ts = time.strftime(
        "%Y-%m-%d %H:%M:%S", time.gmtime((now_ms - closed_days * DAY_MS) / 1000)
    )
    where = f"({OPEN_WHERE} OR RESOLUTIONDATE >= TIMESTAMP '{cutoff_ts}')"
    rows = fetch_layer(ARCGIS_LAYER, where)
    print(f"  fetched {len(rows)} (last 90 days)", file=sys.stderr)
    return rows, now_ms


def discover_year_layers():
    """Return [(layer_id, year), …] for every 'All Service Requests - YYYY'
    layer the service exposes, so new years are picked up automatically."""
    data = _get_json(f"{SERVICE_BASE}?f=json")
    found = []
    for layer in data.get("layers", []):
        m = re.match(r"All Service Requests - (\d{4})$", layer.get("name", ""))
        if m:
            found.append((layer["id"], int(m.group(1))))
    if not found:
        raise SystemExit("no per-year ServiceRequests layers found")
    return sorted(found, key=lambda t: t[1])


def from_arcgis_aging(older_than_days: int):
    """Sweep every per-year layer for STILL-OPEN requests added more than
    `older_than_days` ago. The per-year layers are partitioned by add-year but
    kept live (status/resolution update across years), so their open status is
    current — no self-maintained list needed. The same ADDDATE cutoff is
    applied to every layer: for past years it's always true, for the current
    year it trims requests already covered by active.json's 90-day window."""
    now_ms = int(time.time() * 1000)
    cutoff_ts = time.strftime(
        "%Y-%m-%d %H:%M:%S",
        time.gmtime((now_ms - older_than_days * DAY_MS) / 1000),
    )
    where = f"({OPEN_WHERE}) AND ADDDATE < TIMESTAMP '{cutoff_ts}'"
    rows = []
    for layer_id, year in discover_year_layers():
        got = fetch_layer(f"{SERVICE_BASE}/{layer_id}", where)
        rows.extend(got)
        print(f"  layer {layer_id} ({year}): {len(got)} open", file=sys.stderr)
    print(f"  fetched {len(rows)} (open, older than {older_than_days}d)", file=sys.stderr)
    return rows, now_ms


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--jsonl", help="build from a local scrape file (dev/stale)")
    src.add_argument("--arcgis", action="store_true", help="active.json: live 'Last 90 Days' layer")
    src.add_argument("--aging", action="store_true", help="aging.json: full open backlog older than 90 days")
    ap.add_argument("--out", required=True, help="output path")
    ap.add_argument("--closed-days", type=int, default=7, help="active.json: keep requests closed within N days")
    ap.add_argument("--older-than-days", type=int, default=80, help="aging.json: include open requests older than N days")
    ap.add_argument("--max-age-days", type=int, default=1095, help="aging.json: hide 'open' requests older than N days as abandoned (default 3y; 0 disables)")
    args = ap.parse_args()

    stale_hidden = 0
    stale_older_than = 0

    if args.jsonl:
        rows, now_ms = from_jsonl(args.jsonl)
        source = "jsonl"
        closed_days = args.closed_days
    elif args.aging:
        rows, now_ms = from_arcgis_aging(args.older_than_days)
        source = "arcgis-aging"
        closed_days = 0  # open-only; nothing recently-closed in this set
        # An "open" request added years ago is almost certainly abandoned —
        # never formally closed in DC's system, not live work. Drop these past a
        # max age so the map shows a believable backlog, and report how many.
        if args.max_age_days and args.max_age_days > 0:
            stale_older_than = args.max_age_days
            floor = now_ms - args.max_age_days * DAY_MS
            fresh = []
            for a in rows:
                ad = a.get("ADDDATE")
                if ad is not None and ad < floor:
                    stale_hidden += 1
                else:
                    fresh.append(a)
            rows = fresh
            print(f"  hid {stale_hidden} abandoned (>{args.max_age_days}d old)", file=sys.stderr)
    else:
        rows, now_ms = from_arcgis(args.closed_days)
        source = "arcgis"
        closed_days = args.closed_days

    cats, pts = build(rows, now_ms, closed_days)
    out = {
        "generated": now_ms,
        "source": source,
        "closedDays": closed_days,
        "cats": cats,
        "pts": pts,
    }
    if args.aging:
        out["staleOlderThanDays"] = stale_older_than
        out["staleHidden"] = stale_hidden
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(
        f"wrote {args.out}: {len(pts)} points, {len(cats)} categories "
        f"(source={source}, now={time.strftime('%Y-%m-%d', time.gmtime(now_ms/1000))})",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
