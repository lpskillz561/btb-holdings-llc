import type { NextConfig } from "next";

// Standalone output so the Docker image carries only what the server needs.
//
// There are deliberately no rewrites: the AI Business Overview platform (/app)
// and the marketing site stay on the original Ziora Capital deployment and are
// not part of this app.
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
