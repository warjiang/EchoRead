import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function sqlitePath() {
  const url = process.env.DATABASE_URL || "file:./data/echoread.db";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: sqlitePath(),
  },
});
