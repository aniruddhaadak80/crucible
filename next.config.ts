import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM build plus node fs access. It must stay outside the
  // server bundle so the local zero-config adapter can reach its data directory.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;