import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@aws-sdk/client-ses"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
