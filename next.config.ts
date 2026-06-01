import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["playwright", "@prisma/client", "prisma"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
