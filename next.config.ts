import type { NextConfig } from "next";

// Standalone output so the Docker image carries only what the server needs.
//
// There are deliberately no rewrites: the AI Business Overview platform (/app)
// and the marketing site stay on the original Ziora Capital deployment and are
// not part of this app.
const nextConfig: NextConfig = {
  output: "standalone",

  // The AI knowledge base (src/lib/crm/knowledge/*.md) is read from disk at
  // runtime by lib/crm/skill.ts, and nothing imports it, so Next's tracer has
  // no way to know it is needed — a standalone build would ship without it and
  // every AI surface would fail on first use. Traced files keep their path
  // relative to the project root, which is what `process.cwd()` resolves to
  // inside the container, so the loader's join() finds them unchanged.
  outputFileTracingIncludes: {
    "/api/crm/**": ["./src/lib/crm/knowledge/**/*.md"],
  },
};

export default nextConfig;
