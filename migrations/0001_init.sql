-- World Emotion: votes, one row per device (README §6, docs/design/phase-5-api.md §3).
-- Rollback: rollback/0001_init.sql (D1 has no down migrations; wrangler only reads top-level
-- files here, so rollbacks live in a subfolder). Run by apps/api/scripts/migrations.ts.
CREATE TABLE votes (
  voter_hash      TEXT PRIMARY KEY,                           -- HMAC of the device key; raw key never stored
  country         TEXT CHECK (country IS NULL OR (length(country) = 2 AND country = upper(country))),
                                                              -- NULL: counts for the world only (README §5.6)
  mood            INTEGER NOT NULL CHECK (mood BETWEEN 0 AND 5),
  created_at      INTEGER NOT NULL,                           -- unix seconds, server clock
  last_checkin_id TEXT NOT NULL                               -- idempotency key (README G7)
) WITHOUT ROWID;

-- Column order measured (docs/design/phase-5-api.md §3): (country, mood, created_at) lets the
-- aggregation GROUP BY read the index in order, ~1 row read per stored vote. (created_at, ...)
-- needs a temp B-tree, which D1 bills: 2 rows read per vote.
CREATE INDEX idx_votes_window ON votes (country, mood, created_at);
