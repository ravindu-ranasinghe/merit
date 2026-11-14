import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server only: lets a Cloudflare quick tunnel load dev assets and HMR.
  allowedDevOrigins: ["*.trycloudflare.com"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
