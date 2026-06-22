#!/usr/bin/env python3
"""Build the static `active.json` snapshot for the snap311 exploration map.

The exploration map needs to answer "is this already reported?" without a
database server: the browser/app downloads ONE small file and filters it
client-side. This script produces that file.

Two sources:

  # For DEV testing with the stale local scrape:
  python build_active.py --jsonl ../data/dc311_2026.jsonl --out ../../assets/dev-active.json

  # For the hourly cron — pull the live "Last 90 Days" ArcGIS layer:
  python build_active.py --arcgis --out site/data/active.json

"Active" = currently Open / In-Progress, OR closed within `--closed-days`
(default 7). The output is intentionally compact (~0.3 MB gzipped for all of DC)
so it can be served from static hosting (Cloudflare Pages) and filtered in the
browser with a plain bbox scan — no spatial index, no DB.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

ARCGIS_LAYER = (
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/"
    "DCGIS_DATA/ServiceRequests/MapServer/13"  # "All Service Requests - Last 90 Days"
)
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
PAGE = 1000  # layer maxRecordCount

OPEN_STATUSES = {"Open", "Open (Duplicate)", "In-Progress", "In Progress"}
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


def from_arcgis(closed_days: int):
    now_ms = int(time.time() * 1000)
    cutoff_ts = time.strftime(
        "%Y-%m-%d %H:%M:%S", time.gmtime((now_ms - closed_days * DAY_MS) / 1000)
    )
    where = (
        "(SERVICEORDERSTATUS IN ('Open','Open (Duplicate)','In-Progress','In Progress') "
        f"OR RESOLUTIONDATE >= TIMESTAMP '{cutoff_ts}')"
    )
    rows = []
    offset = 0
    while True:
        params = {
            "f": "json",
            "where": where,
            "outFields": "SERVICEREQUESTID,SERVICEORDERSTATUS,SERVICECODEDESCRIPTION,ADDDATE,RESOLUTIONDATE,SERVICEDUEDATE,LATITUDE,LONGITUDE",
            "returnGeometry": "false",
            "resultOffset": str(offset),
            "resultRecordCount": str(PAGE),
            "orderByFields": "OBJECTID",
        }
        url = f"{ARCGIS_LAYER}/query?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        if data.get("error"):
            raise SystemExit(f"ArcGIS error: {data['error']}")
        feats = data.get("features", [])
        rows.extend(f["attributes"] for f in feats)
        print(f"  fetched {len(rows)} …", file=sys.stderr)
        if not data.get("exceededTransferLimit") and len(feats) < PAGE:
            break
        offset += PAGE
    return rows, now_ms


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--jsonl", help="build from a local scrape file (dev/stale)")
    src.add_argument("--arcgis", action="store_true", help="build from live ArcGIS (cron)")
    ap.add_argument("--out", required=True, help="output path for active.json")
    ap.add_argument("--closed-days", type=int, default=7)
    args = ap.parse_args()

    if args.jsonl:
        rows, now_ms = from_jsonl(args.jsonl)
        source = "jsonl"
    else:
        rows, now_ms = from_arcgis(args.closed_days)
        source = "arcgis"

    cats, pts = build(rows, now_ms, args.closed_days)
    out = {
        "generated": now_ms,
        "source": source,
        "closedDays": args.closed_days,
        "cats": cats,
        "pts": pts,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(
        f"wrote {args.out}: {len(pts)} points, {len(cats)} categories "
        f"(source={source}, now={time.strftime('%Y-%m-%d', time.gmtime(now_ms/1000))})",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
