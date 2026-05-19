import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@deepgram/sdk"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
