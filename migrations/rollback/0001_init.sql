-- Rollback of 0001_init.sql: exactly the objects it created, and its bookkeeping row.
-- (Dropping the table drops its index too; the explicit DROP INDEX documents the mirror.)
-- Rolling back the init migration deletes every vote: export first if that ever matters.
DROP INDEX IF EXISTS idx_votes_window;
DROP TABLE IF EXISTS votes;
DELETE FROM d1_migrations WHERE name = '0001_init.sql';
