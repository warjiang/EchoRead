import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["playwright", "better-sqlite3"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
