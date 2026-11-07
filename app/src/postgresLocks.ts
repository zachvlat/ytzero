import { SQL } from "bun";
import { log } from "./logger";

// PostgreSQL session advisory locks belong to one connection, so each lock uses
// its own single-connection client instead of the shared pool.
const BOOT_LOCK_KEY = 7_265_001;
const WORKER_LOCK_KEY = 7_265_002;

/** Runs first-boot schema work while holding a cluster-wide lock, so replicas booting together don't race. */
export async function withPostgresBootLock<T>(url: string, work: () => Promise<T>): Promise<T> {
  const sql = new SQL(url, { max: 1 });
  try {
    await sql`SELECT pg_advisory_lock(${BOOT_LOCK_KEY})`;
    return await work();
  } finally {
    await sql.close(); // closing the session releases the lock
  }
}

/**
 * Resolves once this replica holds the background-worker lock. The connection
 * stays open for the life of the process; if the replica dies, PostgreSQL
 * releases the lock and a waiting replica takes over.
 * shortcut: a dropped connection loses the lock without stopping this worker, so two workers can briefly overlap; add a lease heartbeat if that matters.
 */
export async function waitForPostgresWorkerLock(url: string, retryMs = 30_000): Promise<void> {
  const sql = new SQL(url, { max: 1 });
  for (;;) {
    try {
      const [row] = await sql`SELECT pg_try_advisory_lock(${WORKER_LOCK_KEY}) AS locked` as { locked: boolean }[];
      if (row?.locked) return;
    } catch (error) {
      log.warn("worker.lock_check_failed", { error: error instanceof Error ? error.message : String(error) });
    }
    await Bun.sleep(retryMs);
  }
}
