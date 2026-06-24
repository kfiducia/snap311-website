-- snap311 status history (Cloudflare D1 / SQLite).
-- Apply with:  npx wrangler d1 execute snap311-status --remote --file=schema.sql

-- Raw per-minute samples. Pruned to ~30 days by the Worker; recent detail +
-- the 24h uptime number come from here.
CREATE TABLE IF NOT EXISTS samples (
  ts      INTEGER NOT NULL,   -- epoch ms of the check
  service TEXT    NOT NULL,
  up      INTEGER NOT NULL,   -- 1 = reachable (<500), 0 = down/timeout
  ms      INTEGER,            -- response time when up
  code    INTEGER             -- HTTP status (0 = timeout/connection error)
);
CREATE INDEX IF NOT EXISTS idx_samples_service_ts ON samples (service, ts);

-- Daily rollups (UTC) so 7d/90d uptime % stays cheap as raw samples are pruned.
CREATE TABLE IF NOT EXISTS daily (
  day     TEXT    NOT NULL,   -- YYYY-MM-DD (UTC)
  service TEXT    NOT NULL,
  ups     INTEGER NOT NULL DEFAULT 0,
  total   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, service)
);

-- Outage log: one row opened when a service goes down, closed on recovery.
CREATE TABLE IF NOT EXISTS incidents (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  service   TEXT    NOT NULL,
  started   INTEGER NOT NULL,   -- epoch ms
  ended     INTEGER,            -- epoch ms; NULL = ongoing
  last_code INTEGER
);
CREATE INDEX IF NOT EXISTS idx_incidents_open ON incidents (service) WHERE ended IS NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents (started);
