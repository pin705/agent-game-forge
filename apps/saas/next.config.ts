import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app lives inside an npm-workspaces monorepo. Pin the tracing root to
  // this package so Next does not walk up and mis-detect the workspace root
  // (which would emit a multi-lockfile warning / wrong output file tracing).
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
