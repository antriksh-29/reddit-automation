import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure server-side only modules don't leak to client
  serverExternalPackages: ["@aws-sdk/client-ses"],
};

export default nextConfig;
