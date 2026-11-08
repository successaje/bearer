import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@bearer/sdk"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    // v2 used "cards"; v3 calls them vaults.
    return [
      { source: "/cards", destination: "/vaults", permanent: true },
      { source: "/c/:id", destination: "/v/:id", permanent: true },
    ];
  },
};

export default nextConfig;
