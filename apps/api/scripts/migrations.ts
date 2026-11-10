/**
 * Exit criterion 1 (docs/design/phase-5-api.md §6): migration forward AND rollback against a
 * local D1, counting objects and rows at each step. Uses a throwaway database directory, so the
 * dev database is never touched. Run: pnpm --filter @world-emotion/api check:migrations
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "we-d1-"));
const base = ["d1", "--local", "--persist-to", dir];
const wrangler = (args: string[]) =>
  execFileSync("pnpm", ["exec", "wrangler", ...args], { encoding: "utf8", stdio: "pipe" });
const sql = <T>(command: string): T[] => {
  const out = wrangler([
    "d1",
    "execute",
    "world-emotion",
    ...base.slice(1),
    "--json",
    "--command",
    command,
  ]);
  return (JSON.parse(out) as { results: T[] }[]).flatMap((r) => r.results);
};
const objects = () =>
  sql<{ type: string; name: string }>(
    "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name",
  ).map((o) => `${o.type}:${o.name}`);
const count = (table: string) => sql<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)[0]?.n;
const migrationRows = () =>
  objects().includes("table:d1_migrations") ? count("d1_migrations") : 0;

let failed = false;
const check = (what: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${what}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`,
  );
};

const N = 250;
const seed = () => {
  const rows = Array.from(
    { length: N },
    (_, i) =>
      `('h${i}', ${i % 5 === 0 ? "NULL" : `'${["CA", "FR", "BR", "NG"][i % 4]}'`}, ${i % 6}, ${1_800_000_000 + i}, 'c${i}')`,
  );
  sql(`INSERT INTO votes VALUES ${rows.join(",")}`);
};

try {
  // A pre-existing, unrelated table must survive the rollback untouched (mirror check).
  sql("CREATE TABLE keep_me (x INTEGER); INSERT INTO keep_me VALUES (1), (2), (3)");
  const before = objects();
  check("before: objects", before, ["table:keep_me"]);

  wrangler(["d1", "migrations", "apply", "world-emotion", ...base.slice(1)]);
  check("forward: objects", objects(), [
    "index:idx_votes_window",
    "table:d1_migrations",
    "table:keep_me",
    "table:votes",
  ]);
  check("forward: d1_migrations rows", migrationRows(), 1);
  check("forward: votes rows", count("votes"), 0);

  seed();
  check(`seeded: votes rows`, count("votes"), N);
  check(
    "seeded: world-only rows (country NULL)",
    sql<{ n: number }>("SELECT count(*) AS n FROM votes WHERE country IS NULL")[0]?.n,
    N / 5,
  );

  // A later migration's bookkeeping row: the rollback must remove 0001's row only.
  sql("INSERT INTO d1_migrations (name) VALUES ('0002_later.sql')");
  wrangler([
    "d1",
    "execute",
    "world-emotion",
    ...base.slice(1),
    "--file",
    "../../migrations/rollback/0001_init.sql",
  ]);
  check("rollback: objects (d1_migrations stays: wrangler owns it)", objects(), [
    "table:d1_migrations",
    "table:keep_me",
  ]);
  check(
    "rollback: d1_migrations names (only 0001's row removed)",
    sql<{ name: string }>("SELECT name FROM d1_migrations").map((r) => r.name),
    ["0002_later.sql"],
  );
  sql("DELETE FROM d1_migrations WHERE name = '0002_later.sql'");
  check("rollback: unrelated table rows", count("keep_me"), 3);

  wrangler(["d1", "migrations", "apply", "world-emotion", ...base.slice(1)]);
  check("re-apply: objects", objects(), [
    "index:idx_votes_window",
    "table:d1_migrations",
    "table:keep_me",
    "table:votes",
  ]);
  check("re-apply: d1_migrations rows", migrationRows(), 1);
  check("re-apply: votes rows", count("votes"), 0);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
