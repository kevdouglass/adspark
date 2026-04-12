/**
 * Asset Resolver — Checks for existing assets before generating new ones.
 *
 * This component implements the "reuse when available" requirement from the
 * assessment brief. For each product, it checks if an existing asset is
 * available (locally or in S3), and only routes to DALL-E generation if not.
 *
 * This is a cost optimization in production: DALL-E 3 costs ~$0.08 per image.
 * For a company launching hundreds of campaigns, reusing existing brand-approved
 * assets saves significant spend and ensures visual consistency.
 */

import type { Product, StorageProvider } from "./types";

export interface AssetResolution {
  product: Product;
  hasExistingAsset: boolean;
  existingAssetBuffer: Buffer | null;
  needsGeneration: boolean;
}

/**
 * Resolve assets for a list of products.
 *
 * Uses per-product error isolation: if one product's storage check fails,
 * it falls back to "needs generation" rather than failing the entire batch.
 * This matches the partial failure model in docs/architecture/orchestration.md.
 */
export async function resolveAssets(
  products: Product[],
  storage: StorageProvider
): Promise<AssetResolution[]> {
  const results = await Promise.allSettled(
    products.map(async (product) => resolveOne(product, storage))
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    // Storage error — fall back to generation rather than aborting the pipeline
    return {
      product: products[i],
      hasExistingAsset: false,
      existingAssetBuffer: null,
      needsGeneration: true,
    };
  });
}

async function resolveOne(
  product: Product,
  storage: StorageProvider
): Promise<AssetResolution> {
  if (product.existingAsset) {
    const exists = await storage.exists(product.existingAsset);
    if (exists) {
      const buffer = await storage.load(product.existingAsset);
      // Guard against TOCTOU race: file existed at check but load returned null
      if (buffer !== null) {
        return {
          product,
          hasExistingAsset: true,
          existingAssetBuffer: buffer,
          needsGeneration: false,
        };
      }
    }
  }

  return {
    product,
    hasExistingAsset: false,
    existingAssetBuffer: null,
    needsGeneration: true,
  };
}
