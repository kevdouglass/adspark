import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
