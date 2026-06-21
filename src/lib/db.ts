import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import path from "path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";

function databasePath() {
  const url = process.env.DATABASE_URL || "file:./data/echoread.db";
  const filename = url.startsWith("file:") ? url.slice("file:".length) : url;
  if (filename !== ":memory:") {
    mkdirSync(path.dirname(filename), { recursive: true });
  }
  return filename;
}

const globalForDb = globalThis as unknown as {
  sqlite: Database.Database | undefined;
};

const sqlite = globalForDb.sqlite ?? new Database(databasePath());
sqlite.pragma("foreign_keys = ON");

if (process.env.NODE_ENV !== "production") {
  globalForDb.sqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };

export function createId(prefix = "id"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function touch(): Date {
  return new Date();
}

export function closeDb(): void {
  sqlite.close();
  if (process.env.NODE_ENV !== "production") {
    globalForDb.sqlite = undefined;
  }
}
