import type { TakeoutBundle } from "./takeout";

// A parsed Takeout upload waiting for the user to pick what to import. Held in
// memory only: re-uploading after a server restart is acceptable for a
// self-hosted app, and it keeps multi-megabyte history manifests off the wire.
const SESSION_TTL_MS = 30 * 60_000;
const MAX_SESSIONS = 50;
const SWEEP_INTERVAL_MS = 60_000;

interface ImportSession {
  userId: number;
  bundle: TakeoutBundle;
  createdAt: number;
}

const sessions = new Map<string, ImportSession>();

function sweep() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

// A parsed ZIP can be hundreds of megabytes, so an abandoned upload must not
// wait for another upload before it is released.
setInterval(sweep, SWEEP_INTERVAL_MS).unref();

export function createImportSession(userId: number, bundle: TakeoutBundle): string {
  sweep();
  if (sessions.size >= MAX_SESSIONS) {
    // Map iterates in insertion order, which is creation order here.
    sessions.delete(sessions.keys().next().value!);
  }
  const id = crypto.randomUUID();
  sessions.set(id, { userId, bundle, createdAt: Date.now() });
  return id;
}

/** The session is bound to the profile that uploaded it. */
export function getImportSession(id: string, userId: number): TakeoutBundle | null {
  sweep();
  const session = sessions.get(id);
  if (!session || session.userId !== userId) return null;
  return session.bundle;
}

export function deleteImportSession(id: string) {
  sessions.delete(id);
}
