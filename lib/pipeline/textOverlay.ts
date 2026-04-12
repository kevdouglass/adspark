/**
 * Text Overlay — Composites campaign message onto generated images.
 *
 * Uses @napi-rs/canvas for high-quality text rendering on a semi-transparent
 * band in the bottom 25% of each image.
 *
 * See docs/architecture/image-processing.md for layout strategy and font details.
 */

import type { ImageDimensions } from "./types";

// Placeholder — implementation in Checkpoint 1
// This will use @napi-rs/canvas to draw text on the image

export async function overlayText(
  _imageBuffer: Buffer,
  _message: string,
  _dimensions: ImageDimensions
): Promise<Buffer> {
  // TODO: Implement @napi-rs/canvas text compositing
  throw new Error("Not implemented — Checkpoint 1");
}
