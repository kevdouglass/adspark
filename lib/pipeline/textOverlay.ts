/**
 * Text Overlay — Composites campaign message onto generated images.
 *
 * Uses Sharp for resize/crop and @napi-rs/canvas for text rendering.
 * Layout: semi-transparent black band in the bottom 25% of the image,
 * white centered text, word-wrapped to max 3 lines.
 *
 * WHY two libraries:
 * - Sharp (libvips): fastest Node.js image library for pixel transforms
 *   (resize, crop, format conversion) but has NO text rendering API.
 * - @napi-rs/canvas (Skia): Canvas 2D API with high-quality font rendering,
 *   measureText, and compositing. The Node.js equivalent of Python's Pillow ImageDraw.
 *
 * The flow: DALL-E buffer → Sharp resize → Canvas overlay text → PNG buffer
 *
 * See docs/architecture/image-processing.md for the full spec.
 */

import sharp from "sharp";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { ImageDimensions } from "./types";

// ---------------------------------------------------------------------------
// Constants — text overlay layout configuration
// ---------------------------------------------------------------------------

/**
 * Band occupies the bottom 28% of the image.
 *
 * Bumped from 25% → 28% so multi-line overlays on 16:9 (the narrowest
 * vertical footprint at 675px total height) have adequate breathing
 * room between the text and the bottom edge. At 25% the band was 169px
 * tall on 16:9, and a single line of 60px-font text ate 78px of that
 * with only ~45px of margin top/bottom — visually cramped. 28% gives
 * ~189px of band height on 16:9, comfortable for a single line with
 * real padding, and still leaves 72% of the image for the hero visual.
 */
const BAND_HEIGHT_RATIO = 0.28;

/**
 * White text for maximum contrast on the dark gradient band below.
 *
 * Paired with canvas shadow properties (see TEXT_SHADOW_* below) so the
 * text maintains crisp edges even when the gradient fades to
 * semi-transparent at its top edge.
 */
const TEXT_COLOR = "#FFFFFF";

/**
 * Bottom-edge opacity of the gradient band.
 *
 * Previously the band was a flat `rgba(0, 0, 0, 0.6)` rectangle — fine
 * for simple backgrounds but insufficient on busy DALL-E outputs where
 * product detail, people, and environmental color bleed through and
 * fight the white text. 0.85 at the bottom guarantees readable contrast
 * against any underlying hue.
 *
 * The TOP of the band is fully transparent (`rgba(0, 0, 0, 0)`) and the
 * gradient interpolates between them — see the `createLinearGradient`
 * call in `overlayText`. This kills the hard horizontal edge the old
 * `fillRect` approach produced, which read as "slapped on" rather than
 * "integrated with the composition".
 */
const BAND_OPACITY_BOTTOM = 0.85;

/**
 * Mid-point opacity for the gradient.
 *
 * A linear two-stop gradient from 0 → 0.85 makes the band look washed-
 * out in the top third. Adding a third stop at ~30% of the band height
 * with opacity around half of the bottom value gives the transition a
 * smoother, more photographic curve — the top 30% of the band fades
 * gently while the bottom 70% darkens firmly.
 */
const BAND_OPACITY_MID = 0.42;

/**
 * Canvas text-shadow configuration.
 *
 * `shadowBlur` with `shadowColor = "rgba(0, 0, 0, 0.9)"` gives white text
 * a 1px halo of darkness that crisps the glyph edges on any background.
 * `shadowOffsetY` adds a subtle drop-shadow effect — purely aesthetic,
 * matches modern ad typography (Instagram Stories, TikTok overlays).
 *
 * WHY NOT use `strokeText` with `strokeStyle`: stroke renders INSIDE the
 * glyph outline, thickening the letterforms and making them look "puffy"
 * at the font sizes we use (54px-70px). Shadow renders OUTSIDE the
 * outline, preserving the letterforms at their native weight.
 *
 * Enabled on the Skia canvas via `context.shadowColor`, `context.shadowBlur`,
 * `context.shadowOffsetX`, `context.shadowOffsetY` immediately before the
 * `fillText` calls.
 */
const TEXT_SHADOW_COLOR = "rgba(0, 0, 0, 0.9)";
const TEXT_SHADOW_BLUR = 10;
const TEXT_SHADOW_OFFSET_X = 0;
const TEXT_SHADOW_OFFSET_Y = 3;

/** Font size scales with image width for responsive text across aspect ratios */
const FONT_SIZE_DIVISOR = 20;

/** Horizontal padding as a fraction of image width (5% on each side) */
const PADDING_RATIO = 0.05;

/** Maximum lines of text — prevents overflow outside the band */
const MAX_LINES = 3;

/** Line height multiplier relative to font size */
const LINE_HEIGHT_MULTIPLIER = 1.3;

// ---------------------------------------------------------------------------
// ADS-002a: Word wrapping utility
// ---------------------------------------------------------------------------

/**
 * Wrap text to fit within a maximum width using Canvas measureText.
 *
 * WHY manual word wrap: The Canvas 2D API has no built-in word wrapping.
 * fillText() renders a single line — if the text is wider than the canvas,
 * it overflows invisibly. We must measure each word, accumulate into lines,
 * and break when the line exceeds maxWidth.
 *
 * The algorithm respects MAX_LINES: if the text would need more than 3 lines,
 * the last line is truncated with "..." to signal overflow.
 *
 * SECURITY: Defensive input normalization — AI-enabled tools face prompt
 * injection and input manipulation risks. Even though this is an internal
 * function, the campaign message originates from user input. We normalize:
 * - Collapse all whitespace runs (tabs, newlines, multiple spaces) to single spaces
 * - Trim leading/trailing whitespace
 * - Return [] for empty or whitespace-only input (no blank band rendering)
 */
export function wrapText(
  context: SKRSContext2D,
  message: string,
  maxWidth: number
): string[] {
  // Normalize whitespace: collapse tabs, newlines, and multi-space runs
  // into single spaces, then trim. This prevents malformed output from
  // unexpected control characters in user input.
  const normalized = message.replace(/\s+/g, " ").trim();

  // Empty or whitespace-only input → no text to render
  if (normalized.length === 0) {
    return [];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    // Handle oversized single word (no spaces, wider than maxWidth)
    // Truncate character-by-character to prevent overflow
    const wordWidth = context.measureText(word).width;
    const safeWord = wordWidth > maxWidth
      ? truncateWordToFit(context, word, maxWidth)
      : word;

    const testLine = currentLine ? `${currentLine} ${safeWord}` : safeWord;
    const metrics = context.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      // Current line is full — push it and start a new one
      if (lines.length >= MAX_LINES - 1) {
        // Last allowed line — truncate with ellipsis
        lines.push(truncateWithEllipsis(context, currentLine, safeWord, maxWidth));
        return lines;
      }
      lines.push(currentLine);
      currentLine = safeWord;
    } else {
      currentLine = testLine;
    }
  }

  // Push the final line
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, MAX_LINES);
}

/**
 * Truncate a single word that is wider than maxWidth.
 * Removes characters from the end until it fits with "...".
 */
function truncateWordToFit(
  context: SKRSContext2D,
  word: string,
  maxWidth: number
): string {
  for (let charIndex = word.length - 1; charIndex > 0; charIndex--) {
    const truncated = word.slice(0, charIndex) + "...";
    if (context.measureText(truncated).width <= maxWidth) {
      return truncated;
    }
  }
  return "...";
}

/**
 * Truncate the last line with "..." if remaining words don't fit.
 */
function truncateWithEllipsis(
  context: SKRSContext2D,
  currentLine: string,
  nextWord: string,
  maxWidth: number
): string {
  const candidate = `${currentLine} ${nextWord}...`;
  if (context.measureText(candidate).width <= maxWidth) {
    return candidate;
  }
  return `${currentLine}...`;
}

// ---------------------------------------------------------------------------
// ADS-002c: Sharp resize from DALL-E dimensions to platform target
// ---------------------------------------------------------------------------

/**
 * Resize a DALL-E output image to the target platform dimensions.
 *
 * DALL-E 3 outputs at fixed sizes (1024x1024, 1024x1792, 1792x1024)
 * that don't match platform targets (1080x1080, 1080x1920, 1200x675).
 *
 * Uses cover fit + center crop:
 * - cover: fills the entire target area, cropping excess (no letterboxing)
 * - center: AI-generated images typically center their subject
 *
 * See docs/architecture/image-processing.md for the dimension mapping table.
 */
export async function resizeToTarget(
  imageBuffer: Buffer,
  dimensions: ImageDimensions
): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize(dimensions.width, dimensions.height, {
      fit: "cover",
      position: "center",
    })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// ADS-002b: Main text overlay function
// ---------------------------------------------------------------------------

/**
 * Overlay a campaign message onto an image.
 *
 * Layout (see docs/architecture/image-processing.md):
 * ┌──────────────────────────────┐
 * │                              │
 * │     (creative image)         │
 * │                              │
 * │  ┌────────────────────────┐  │
 * │  │  CAMPAIGN MESSAGE      │  │  ← Bottom 25%
 * │  │  Multi-line, centered  │  │  ← Semi-transparent band
 * │  └────────────────────────┘  │
 * └──────────────────────────────┘
 *
 * Steps:
 * 1. Resize DALL-E output to target dimensions via Sharp (cover + center)
 * 2. Create canvas at target dimensions
 * 3. Draw resized image as background
 * 4. Draw semi-transparent band
 * 5. Word-wrap message, render centered white text
 * 6. Export as PNG buffer
 */
export async function overlayText(
  imageBuffer: Buffer,
  message: string,
  dimensions: ImageDimensions
): Promise<Buffer> {
  const { width, height } = dimensions;

  // Step 1: Resize DALL-E output to target platform dimensions
  let resizedBuffer: Buffer;
  try {
    resizedBuffer = await resizeToTarget(imageBuffer, dimensions);
  } catch (e) {
    throw new ImageProcessingError(
      `Failed to resize image to ${width}x${height}: ${e instanceof Error ? e.message : "unknown error"}`,
      { cause: e }
    );
  }

  // Step 2: Create canvas at target dimensions
  //
  // MEMORY NOTE: @napi-rs/canvas allocates ~4 bytes × width × height in Skia's
  // heap (1080×1920 ≈ 8MB per canvas). Combined with Sharp's decoded buffer,
  // peak memory per image is ~16MB. For 6 concurrent images this reaches
  // ~100MB — well within Vercel's 1024MB function limit, but at higher scale
  // (50+ concurrent images), process sequentially and let GC collect between
  // invocations. Canvas and image are function-scoped, so GC collects them
  // after toBuffer() — no explicit .destroy() call needed.
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  // Step 3: Draw the resized image as background
  let image;
  try {
    image = await loadImage(resizedBuffer);
  } catch (e) {
    throw new ImageProcessingError(
      `Failed to load resized image into canvas: ${e instanceof Error ? e.message : "unknown error"}`,
      { cause: e }
    );
  }
  context.drawImage(image, 0, 0, width, height);

  // Step 4: Word-wrap message first — skip band entirely if no text
  // This prevents rendering a blank band for whitespace-only input.
  const fontSizeForMeasure = Math.round(width / FONT_SIZE_DIVISOR);
  context.font = `bold ${fontSizeForMeasure}px sans-serif`;
  const paddingForMeasure = Math.round(width * PADDING_RATIO);
  const maxTextWidthForMeasure = width - paddingForMeasure * 2;
  const lines = wrapText(context, message, maxTextWidthForMeasure);

  if (lines.length === 0) {
    // No text to render — return the resized image without band or overlay
    const canvasBuffer = canvas.toBuffer("image/png");
    return sharp(canvasBuffer).png({ compressionLevel: 6 }).toBuffer();
  }

  // Step 5: Draw the gradient band in the bottom portion of the image.
  //
  // Uses `createLinearGradient` (top of band → bottom of band) with three
  // stops so the band fades from fully transparent at its top edge to
  // fully opaque (BAND_OPACITY_BOTTOM) at the image's bottom edge. This
  // eliminates the hard horizontal line the old `fillRect` approach
  // produced, which made the band read as "pasted on" rather than
  // integrated with the underlying image.
  //
  // The three-stop curve (0 at top → BAND_OPACITY_MID at ~30% → BAND_OPACITY_BOTTOM
  // at bottom) is not strictly linear — the lower two thirds darken
  // faster than the top third. This matches photographic burn-in
  // techniques used in real ad posters: the text sits on the densest
  // part of the fade, while the top third softens the transition into
  // the hero image.
  const bandHeight = Math.round(height * BAND_HEIGHT_RATIO);
  const bandY = height - bandHeight;
  const gradient = context.createLinearGradient(0, bandY, 0, height);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(0.3, `rgba(0, 0, 0, ${BAND_OPACITY_MID})`);
  gradient.addColorStop(1, `rgba(0, 0, 0, ${BAND_OPACITY_BOTTOM})`);
  context.fillStyle = gradient;
  context.fillRect(0, bandY, width, bandHeight);

  // Step 6: Configure text rendering styles with a subtle drop shadow.
  //
  // The shadow gives white text crisp edges regardless of what the
  // gradient fades toward at the top of the band. Without it, white
  // glyphs blur visually into semi-transparent parts of the band and
  // multi-line messages look washed out on busy backgrounds.
  //
  // Font: system sans-serif for POC. Production: register brand fonts via
  // GlobalFonts.registerFromPath() — see brand-triage-agent.md (ADS-024).
  // Note: on headless CI/serverless, Skia falls back to a bundled default.
  const lineHeight = Math.round(fontSizeForMeasure * LINE_HEIGHT_MULTIPLIER);
  context.fillStyle = TEXT_COLOR;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = TEXT_SHADOW_COLOR;
  context.shadowBlur = TEXT_SHADOW_BLUR;
  context.shadowOffsetX = TEXT_SHADOW_OFFSET_X;
  context.shadowOffsetY = TEXT_SHADOW_OFFSET_Y;

  // Step 7: Render the (already-wrapped) text lines
  // textBaseline = "middle" centers each glyph at its Y coordinate — the
  // + lineHeight/2 offset positions each line at its own vertical center.
  const totalTextHeight = lines.length * lineHeight;
  const textStartY = bandY + (bandHeight - totalTextHeight) / 2;

  for (const [lineIndex, line] of lines.entries()) {
    const lineY = textStartY + lineIndex * lineHeight + lineHeight / 2;
    context.fillText(line, width / 2, lineY);
  }

  // Step 8: Final Sharp optimization pass (compressionLevel: 6 per spec)
  // Canvas toBuffer produces unoptimized PNG — Sharp recompresses for
  // smaller file size without quality loss.
  const canvasBuffer = canvas.toBuffer("image/png");
  return sharp(canvasBuffer).png({ compressionLevel: 6 }).toBuffer();
}

/**
 * Typed error for image processing failures (resize, canvas, overlay).
 * Distinguishes processing errors from generation errors (ImageGenerationError).
 */
export class ImageProcessingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ImageProcessingError";
  }
}
