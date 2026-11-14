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
  // Serve API requests through the web origin so GitHub OAuth and session
  // cookies work in browsers that block third-party cookies.
  async rewrites() {
    const apiOrigin = process.env.MERIT_API_ORIGIN?.replace(/\/$/, "");
    return apiOrigin
      ? [{ source: "/api/merit/:path*", destination: `${apiOrigin}/:path*` }]
      : [];
  },
};

export default nextConfig;
