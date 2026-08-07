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
    // The Knowledge page reads the same directory — `skillStatus()` is what
    // draws the "house knowledge base: N files, loaded" line, and the loud red
    // panel when it is not. Listed separately rather than relied upon: the
    // traced files land in the standalone output at one shared path, so in
    // practice either entry alone puts them there, and a page that silently
    // depends on another route's trace is one refactor from reporting that the
    // knowledge base is missing on a build where it is present.
    "/crm/knowledge/**": ["./src/lib/crm/knowledge/**/*.md"],
  },
};

export default nextConfig;
