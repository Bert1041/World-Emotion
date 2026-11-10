/**
 * Purge constants, in a file with no Workers types so tools/simulate (plain Node) can import it.
 */

/** Extra time a vote is kept past its window, so a slow aggregator run never misses one. */
export const PURGE_BUFFER_SECONDS = 10 * 60;

/** ?1 = the cut-off: `now - window - PURGE_BUFFER_SECONDS`. */
export const PURGE_SQL = "DELETE FROM votes WHERE created_at <= ?1";
