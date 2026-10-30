import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  distDir:
    process.env.QA_PLAYWRIGHT_BUILD_DIR ||
    process.env.NEXT_DIST_DIR ||
    ".next",
  cacheComponents: true,
  partialPrefetching: true,
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
