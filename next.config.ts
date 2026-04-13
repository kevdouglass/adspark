import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone output — emits `.next/standalone/server.js` plus a
   * minimal tree-shaken `node_modules` so the Docker image can ship
   * only the files actually needed at runtime.
   *
   * Vercel builds are not affected — Vercel produces its own
   * standalone-equivalent artifact internally regardless of this flag,
   * so turning it on is a no-op there and a major savings for the
   * container (~800MB → ~300MB).
   *
   * See Dockerfile for the corresponding COPY steps and the absolute
   * `LOCAL_OUTPUT_DIR=/app/output` env that tells the files route and
   * LocalStorage where to read/write runtime data under standalone's
   * altered cwd (/app/.next/standalone).
   */
  output: "standalone",

  /**
   * Native dependencies that Webpack's file-tracer misses.
   *
   * Sharp and @napi-rs/canvas ship prebuilt `.node` addons alongside
   * their JS entry points. Webpack's runtime tracer follows JS requires
   * but does NOT follow `require()`s that resolve to `.node` files via
   * dynamic platform detection. Without these explicit include globs,
   * the standalone artifact ships the JS shim with no native binary,
   * and the container fails at first pipeline call with a cryptic
   * "cannot find module '../build/Release/sharp-linux-x64.node'".
   *
   * See: https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats
   */
  outputFileTracingIncludes: {
    "/api/generate": [
      "./node_modules/sharp/**/*",
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@img/**/*",
    ],
    "/api/orchestrate-brief": [
      "./node_modules/sharp/**/*",
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@img/**/*",
    ],
  },

  // Sharp is used for image processing in API routes
  // @napi-rs/canvas needs to be treated as external (native module)
  serverExternalPackages: ["@napi-rs/canvas", "sharp"],

  // Image optimization config.
  //
  // Even though we use `unoptimized={true}` on the <Image> component
  // in CreativeGallery.tsx (which bypasses Next.js's /_next/image
  // optimizer entirely), we still declare `remotePatterns` for the
  // S3 host as a defensive measure. This:
  //
  //   1. Eliminates dev-mode strict-mode warnings about undeclared
  //      remote image hosts.
  //   2. Future-proofs the codebase — if anyone removes `unoptimized`
  //      to enable WebP conversion later, the config is already in
  //      place and won't fail at build time.
  //   3. Makes Vercel's image proxy behavior fully deterministic
  //      across dev, preview, and production builds.
  //
  // Patterns:
  //   - The exact bucket subdomain for the production AdSpark bucket
  //   - All us-east-1 buckets (covers preview environments using
  //     different bucket names without re-deploying config)
  //   - Path-style S3 access for legacy or alternate-region cases
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "adspark-creatives-905740063772.s3.us-east-1.amazonaws.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.s3.us-east-1.amazonaws.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.s3.amazonaws.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
