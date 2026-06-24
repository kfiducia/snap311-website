#!/usr/bin/env python3
"""Local/manual tester for the status probes.

The PRODUCTION runner is the Cloudflare Worker (worker/src/index.js, cron 1/min)
— this script mirrors its probe logic against the SAME service catalog
(worker/services.json) so you can sanity-check targets and see current status
without deploying. It does not touch D1 or R2.

  python healthcheck.py            # probe all, print a table
  python healthcheck.py --json     # emit the status.json shape

"Up" = the host returned an HTTP response with status < 500 within the timeout.
A 5xx, a timeout, or a connection error = down. (We don't require 2xx: an auth
endpoint answering 401/302 is still 'up' — the service is reachable.)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

CATALOG = os.path.join(os.path.dirname(__file__), "..", "worker", "services.json")
UA = "snap311-statuscheck/1 (+https://snap311.app)"
TIMEOUT = 15


def probe(svc: dict) -> dict:
    t0 = time.time()
    try:
        req = urllib.request.Request(svc["url"], method=svc.get("method", "GET"), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code  # got an HTTP response, just not 2xx
    except Exception:
        code = 0  # timeout / connection error / DNS
    ms = int((time.time() - t0) * 1000)
    up = code != 0 and code < 500
    return {"id": svc["id"], "up": up, "code": code, "ms": ms if up else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="emit the status.json shape")
    args = ap.parse_args()

    with open(CATALOG) as f:
        services = json.load(f)

    results = {r["id"]: r for r in (probe(s) for s in services)}

    if args.json:
        now_ms = int(time.time() * 1000)
        print(json.dumps({"checked": now_ms, "services": results}, separators=(",", ":")))
        return

    print(f"{'SERVICE':<22} {'GROUP':<8} {'STATUS':<6} {'CODE':<5} {'MS':<6}")
    print("-" * 52)
    for s in services:
        r = results[s["id"]]
        status = "UP" if r["up"] else "DOWN"
        print(f"{s['name']:<22} {s['group']:<8} {status:<6} {r['code']:<5} {str(r['ms'] or '-'):<6}")


if __name__ == "__main__":
    main()
