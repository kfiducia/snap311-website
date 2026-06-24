-- snap311 status history (Cloudflare D1 / SQLite).
-- Apply with:  npx wrangler d1 execute snap311-status --remote --file=schema.sql

-- Raw per-minute samples. Pruned to ~30 days by the Worker; recent detail +
-- the 24h uptime number come from here.
CREATE TABLE IF NOT EXISTS samples (
  ts      INTEGER NOT NULL,   -- epoch ms of the check
  service TEXT    NOT NULL,
  up      INTEGER NOT NULL,   -- raw: 1 = reachable (<500), 0 = down/timeout
  cup     INTEGER,            -- confirmed (debounced) state at this minute: 1 up / 0 down
  ms      INTEGER,            -- response time when up
  code    INTEGER             -- HTTP status (0 = timeout/connection error)
);
CREATE INDEX IF NOT EXISTS idx_samples_service_ts ON samples (service, ts);

-- Daily rollups (UTC). The long-term tier: uptime (ups/total) + latency stats
-- (avg = ms_sum/ms_cnt, min, max) survive after raw samples are pruned at 7d.
CREATE TABLE IF NOT EXISTS daily (
  day     TEXT    NOT NULL,   -- YYYY-MM-DD (UTC)
  service TEXT    NOT NULL,
  ups     INTEGER NOT NULL DEFAULT 0,  -- raw up-checks
  cups    INTEGER NOT NULL DEFAULT 0,  -- confirmed up-checks (drives % + bars)
  total   INTEGER NOT NULL DEFAULT 0,
  ms_sum  INTEGER NOT NULL DEFAULT 0,  -- sum of response times over up-checks
  ms_cnt  INTEGER NOT NULL DEFAULT 0,  -- count of up-checks with a timing
  ms_min  INTEGER,
  ms_max  INTEGER,
  PRIMARY KEY (day, service)
);

-- Debounced state: the *reported* up/down per service. Only flips after
-- CONFIRM_THRESHOLD consecutive checks agree, so a one-minute flap doesn't flip
-- the board. (Raw availability still lives in `samples`/`daily`.)
CREATE TABLE IF NOT EXISTS service_state (
  service   TEXT PRIMARY KEY,
  confirmed INTEGER NOT NULL,          -- 1 = up, 0 = down (what the page shows)
  streak    INTEGER NOT NULL DEFAULT 0 -- consecutive checks differing from `confirmed`
);

-- Outage log: one row opened when a service goes down, closed on recovery.
CREATE TABLE IF NOT EXISTS incidents (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  service   TEXT    NOT NULL,
  started   INTEGER NOT NULL,   -- epoch ms
  ended     INTEGER,            -- epoch ms; NULL = ongoing
  last_code INTEGER,
  error     TEXT                -- latest failure reason (e.g. "HTTP 503", "timeout")
);
CREATE INDEX IF NOT EXISTS idx_incidents_open ON incidents (service) WHERE ended IS NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents (started);
