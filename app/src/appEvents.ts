import { database, databaseConfig } from "./database";
import { log } from "./logger";

export type AppEventTopic = "channel-sync" | "child-status" | "child-watching" | "child-requests" | "downloads" | "live" | "notifications" | "social";
export type AppEvent = { topic: AppEventTopic; data?: Record<string, unknown>; userId?: number };

export function appEventVisibleToUser(event: AppEvent, userId: number): boolean {
  return event.userId === undefined || event.userId === userId;
}

export function createAppEventBus() {
  const listeners = new Set<(event: AppEvent) => void>();
  return {
    publish(event: AppEvent) {
      for (const listener of listeners) {
        try { listener(event); } catch {}
      }
    },
    subscribe(listener: (event: AppEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const appEventBus = createAppEventBus();
const relayInstanceId = crypto.randomUUID();
let relayStarted = false;
let relayCursor = 0;
let relayPolling = false;

function publish(event: AppEvent): void {
  appEventBus.publish(event);
  if (!relayStarted || databaseConfig.engine !== "postgres") return;
  void database.prepare("INSERT INTO app_events (origin, topic, user_id, data) VALUES (?, ?, ?, ?)")
    .run(relayInstanceId, event.topic, event.userId ?? null, event.data ? JSON.stringify(event.data) : null)
    .catch((error) => log.warn("cluster.event_publish_failed", { error: error instanceof Error ? error.message : String(error) }));
}

export const publishAppEvent = (topic: AppEventTopic, data?: Record<string, unknown>) => publish({ topic, data });
export const publishAppEventForUser = (topic: AppEventTopic, userId: number, data?: Record<string, unknown>) => publish({ topic, data, userId });
export const subscribeToAppEvents = appEventBus.subscribe;

const APP_EVENT_TOPICS = new Set<AppEventTopic>(["channel-sync", "child-status", "child-watching", "child-requests", "downloads", "live", "notifications", "social"]);

function relayPollIntervalMs(): number {
  const parsed = Number(process.env.APP_EVENT_POLL_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 30_000 ? parsed : 750;
}

async function pollAppEvents(): Promise<void> {
  if (relayPolling) return;
  relayPolling = true;
  try {
    while (true) {
      const rows = await database.prepare(`
        SELECT id, origin, topic, user_id, data
        FROM app_events WHERE id > ? ORDER BY id LIMIT 250
      `).all(relayCursor) as Array<{ id: number; origin: string; topic: string; user_id: number | null; data: string | null }>;
      if (rows.length === 0) break;
      for (const row of rows) {
        relayCursor = Math.max(relayCursor, Number(row.id));
        if (row.origin === relayInstanceId || !APP_EVENT_TOPICS.has(row.topic as AppEventTopic)) continue;
        let data: Record<string, unknown> | undefined;
        try { data = row.data ? JSON.parse(row.data) : undefined; } catch { data = undefined; }
        appEventBus.publish({ topic: row.topic as AppEventTopic, data, ...(row.user_id == null ? {} : { userId: Number(row.user_id) }) });
      }
      if (rows.length < 250) break;
    }
  } catch (error) {
    log.warn("cluster.event_poll_failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    relayPolling = false;
  }
}

/** Start the PostgreSQL-backed relay that fans mutations out to SSE clients on every replica. */
export async function startAppEventRelay(): Promise<void> {
  if (relayStarted || databaseConfig.engine !== "postgres") return;
  const latest = await database.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM app_events").get<{ id: number }>();
  relayCursor = Number(latest?.id ?? 0);
  relayStarted = true;
  const timer = setInterval(() => void pollAppEvents(), relayPollIntervalMs());
  timer.unref?.();
  log.info("cluster.event_relay_started", { pollIntervalMs: relayPollIntervalMs() });
}

let cleanupStarted = false;
/** Prune old relay events on the single replica that owns background tasks. */
export function startEventCleanup(): void {
  if (cleanupStarted || databaseConfig.engine !== "postgres") return;
  cleanupStarted = true;
  const cleanup = () => database.prepare("DELETE FROM app_events WHERE created_at < datetime('now', '-1 day')").run()
    .catch((error) => log.warn("cluster.event_cleanup_failed", { error: error instanceof Error ? error.message : String(error) }));
  void cleanup();
  const cleanupTimer = setInterval(() => void cleanup(), 60 * 60_000);
  cleanupTimer.unref?.();
}

const pending = new Map<AppEventTopic, ReturnType<typeof setTimeout>>();
export function publishAppEventSoon(topic: AppEventTopic, delayMs: number, data?: Record<string, unknown>) {
  const existing = pending.get(topic);
  if (existing) clearTimeout(existing);
  pending.set(topic, setTimeout(() => {
    pending.delete(topic);
    publishAppEvent(topic, data);
  }, delayMs));
}
