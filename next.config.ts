import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["playwright", "@prisma/client", "prisma"],
};

export default nextConfig;
