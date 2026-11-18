import { decodeHtmlEntities } from "../../shared/htmlEntities";

export { decodeHtmlEntities };

const TITLE_FIELDS = new Set(["title", "channel_title", "channelTitle"]);

/** Normalize title fields in API payloads, including records already stored in SQLite. */
export function decodeApiTitles<T>(value: T): T {
  if (Array.isArray(value)) return value.map(decodeApiTitles) as T;
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (TITLE_FIELDS.has(key) && typeof child === "string") record[key] = decodeHtmlEntities(child);
    else if (child && typeof child === "object") record[key] = decodeApiTitles(child);
  }
  return value;
}
