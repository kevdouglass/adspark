import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sharp is used for image processing in API routes
  // @napi-rs/canvas needs to be treated as external (native module)
  serverExternalPackages: ["@napi-rs/canvas", "sharp"],
};

export default nextConfig;
