import type { Database } from "bun:sqlite";
import schemaSql from "./schema.sql" with { type: "text" };
import channelPostsSchemaSql from "./channelPostsSchema.sql" with { type: "text" };
import tubeArchivistSchemaSql from "./tubeArchivistSchema.sql" with { type: "text" };

export const CANONICAL_SCHEMA_FILES = [
  "app/src/schema.sql",
  "app/src/channelPostsSchema.sql",
  "app/src/tubeArchivistSchema.sql",
] as const;

export type CanonicalSchemaFile = (typeof CANONICAL_SCHEMA_FILES)[number];

export function applyCanonicalSQLiteSchema(database: Database): void {
  database.exec(schemaSql);
  database.exec(channelPostsSchemaSql);
  database.exec(tubeArchivistSchemaSql);
}
