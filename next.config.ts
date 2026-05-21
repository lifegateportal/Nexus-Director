import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@deepgram/sdk", "@react-pdf/renderer", "epub-gen-memory"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      const existing = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [
        ...existing,
        { "@react-pdf/renderer": "commonjs @react-pdf/renderer" },
        { "epub-gen-memory": "commonjs epub-gen-memory" },
      ];
    }
    return config;
  },
};

export default nextConfig;
