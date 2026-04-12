import { describe, it, expect } from "vitest";
import { overlayText, resizeToTarget, wrapText } from "@/lib/pipeline/textOverlay";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";
import type { ImageDimensions } from "@/lib/pipeline/types";

// --- Test fixtures ---

/** Generate a solid-color test image at DALL-E dimensions via Sharp */
async function createTestImage(
  width: number,
  height: number,
  color: string = "#2A9D8F"
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

const SQUARE_DIMENSIONS: ImageDimensions = {
  width: 1080,
  height: 1080,
  dalleSize: "1024x1024",
};

const VERTICAL_DIMENSIONS: ImageDimensions = {
  width: 1080,
  height: 1920,
  dalleSize: "1024x1792",
};

const HORIZONTAL_DIMENSIONS: ImageDimensions = {
  width: 1200,
  height: 675,
  dalleSize: "1792x1024",
};

const CAMPAIGN_MESSAGE = "Stay Protected All Summer — Now 20% Off";

// --- Tests ---

describe("resizeToTarget", () => {
  it("resizes 1024x1024 DALL-E output to 1080x1080 target", async () => {
    const dalleImage = await createTestImage(1024, 1024);
    const resizedBuffer = await resizeToTarget(dalleImage, SQUARE_DIMENSIONS);
    const metadata = await sharp(resizedBuffer).metadata();

    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1080);
    expect(metadata.format).toBe("png");
  });

  it("resizes 1024x1792 to 1080x1920 (9:16 vertical)", async () => {
    const dalleImage = await createTestImage(1024, 1792);
    const resizedBuffer = await resizeToTarget(dalleImage, VERTICAL_DIMENSIONS);
    const metadata = await sharp(resizedBuffer).metadata();

    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1920);
  });

  it("resizes 1792x1024 to 1200x675 (16:9 horizontal)", async () => {
    const dalleImage = await createTestImage(1792, 1024);
    const resizedBuffer = await resizeToTarget(
      dalleImage,
      HORIZONTAL_DIMENSIONS
    );
    const metadata = await sharp(resizedBuffer).metadata();

    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(675);
  });
});

describe("overlayText", () => {
  it("returns a PNG buffer with correct dimensions for 1:1", async () => {
    const dalleImage = await createTestImage(1024, 1024);
    const resultBuffer = await overlayText(
      dalleImage,
      CAMPAIGN_MESSAGE,
      SQUARE_DIMENSIONS
    );

    expect(resultBuffer).toBeInstanceOf(Buffer);
    expect(resultBuffer.length).toBeGreaterThan(0);

    // Verify PNG magic bytes
    expect(resultBuffer[0]).toBe(0x89);
    expect(resultBuffer[1]).toBe(0x50);
  });

  it("returns correct dimensions for all 3 aspect ratios", async () => {
    const testCases = [
      { dalleWidth: 1024, dalleHeight: 1024, dimensions: SQUARE_DIMENSIONS },
      { dalleWidth: 1024, dalleHeight: 1792, dimensions: VERTICAL_DIMENSIONS },
      {
        dalleWidth: 1792,
        dalleHeight: 1024,
        dimensions: HORIZONTAL_DIMENSIONS,
      },
    ];

    for (const aspectRatioScenario of testCases) {
      const dalleImage = await createTestImage(
        aspectRatioScenario.dalleWidth,
        aspectRatioScenario.dalleHeight
      );
      const resultBuffer = await overlayText(
        dalleImage,
        CAMPAIGN_MESSAGE,
        aspectRatioScenario.dimensions
      );
      const metadata = await sharp(resultBuffer).metadata();

      expect(metadata.width).toBe(aspectRatioScenario.dimensions.width);
      expect(metadata.height).toBe(aspectRatioScenario.dimensions.height);
    }
  });

  it("handles a very short message (single word)", async () => {
    const dalleImage = await createTestImage(1024, 1024);
    const resultBuffer = await overlayText(
      dalleImage,
      "Sale",
      SQUARE_DIMENSIONS
    );

    expect(resultBuffer).toBeInstanceOf(Buffer);
    expect(resultBuffer.length).toBeGreaterThan(0);
  });

  it("handles maximum length message (140 characters)", async () => {
    const longMessage =
      "Experience the ultimate sun protection with our reef-safe mineral formula for outdoor enthusiasts who demand the very best in skin care now";
    expect(longMessage.length).toBeLessThanOrEqual(140);

    const dalleImage = await createTestImage(1024, 1024);
    const resultBuffer = await overlayText(
      dalleImage,
      longMessage,
      SQUARE_DIMENSIONS
    );

    expect(resultBuffer).toBeInstanceOf(Buffer);
    expect(resultBuffer.length).toBeGreaterThan(0);
  });

  it("skips band rendering for whitespace-only message (no blank band)", async () => {
    const dalleImage = await createTestImage(1024, 1024);
    const whitespaceResult = await overlayText(
      dalleImage,
      "   \t\n  ",
      SQUARE_DIMENSIONS
    );
    const emptyResult = await overlayText(
      dalleImage,
      "",
      SQUARE_DIMENSIONS
    );

    // Both should produce the same output — resized image with no band/text
    // Sizes should be equal (same content) or within 1% (PNG compression variance)
    const sizeDifference = Math.abs(whitespaceResult.length - emptyResult.length);
    const percentDifference = sizeDifference / emptyResult.length;
    expect(percentDifference).toBeLessThan(0.01);
  });

  it("handles Unicode characters in message", async () => {
    const unicodeMessage = "Protección Solar Premium — ¡Ahora 20% Descuento!";
    const dalleImage = await createTestImage(1024, 1024);
    const resultBuffer = await overlayText(
      dalleImage,
      unicodeMessage,
      SQUARE_DIMENSIONS
    );

    expect(resultBuffer).toBeInstanceOf(Buffer);
    expect(resultBuffer.length).toBeGreaterThan(0);
  });

  it("produces a non-empty PNG buffer distinct from the resized-only image", async () => {
    const dalleImage = await createTestImage(1024, 1024);
    const resizedOnly = await resizeToTarget(dalleImage, SQUARE_DIMENSIONS);
    const withOverlay = await overlayText(
      dalleImage,
      CAMPAIGN_MESSAGE,
      SQUARE_DIMENSIONS
    );

    // The overlay buffer should differ from resize-only (band + text added)
    // We compare content, not size — PNG compression is non-deterministic
    expect(withOverlay.equals(resizedOnly)).toBe(false);
  });
});

describe("wrapText (direct unit tests)", () => {
  // Create a canvas context for measureText — same setup the real code uses
  function createTestContext(width: number = 1080): SKRSContext2D {
    const canvas = createCanvas(width, width);
    const context = canvas.getContext("2d");
    const fontSize = Math.round(width / 20); // matches FONT_SIZE_DIVISOR
    context.font = `bold ${fontSize}px sans-serif`;
    return context;
  }

  it("returns a single line for short text", () => {
    const context = createTestContext();
    const maxWidth = 1080 * 0.9; // 90% of width (5% padding each side)
    const lines = wrapText(context, "Short message", maxWidth);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Short message");
  });

  it("wraps long text across multiple lines", () => {
    const context = createTestContext();
    const maxWidth = 1080 * 0.9;
    const longMessage =
      "This is a very long campaign message that should definitely wrap across multiple lines in the overlay";
    const lines = wrapText(context, longMessage, maxWidth);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("truncates with ellipsis when text exceeds 3 lines", () => {
    const context = createTestContext();
    const maxWidth = 1080 * 0.9;
    const veryLongMessage =
      "This is an extremely long campaign message that goes on and on and keeps going with more words that will certainly exceed three lines of text when rendered at this font size on a 1080 pixel wide canvas with padding applied on both sides";
    const lines = wrapText(context, veryLongMessage, maxWidth);

    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("...");
  });

  it("handles a single word that is wider than maxWidth", () => {
    const context = createTestContext();
    const narrowWidth = 100; // very narrow — most words will overflow
    const lines = wrapText(context, "Supercalifragilisticexpialidocious", narrowWidth);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("...");
    // Verify it actually fits
    expect(context.measureText(lines[0]).width).toBeLessThanOrEqual(narrowWidth);
  });

  it("handles empty string", () => {
    const context = createTestContext();
    const lines = wrapText(context, "", 1080 * 0.9);

    expect(lines).toHaveLength(0);
  });

  // --- Security: defensive input normalization (ADS-034) ---

  it("returns [] for whitespace-only input (single space)", () => {
    const context = createTestContext();
    const lines = wrapText(context, " ", 1080 * 0.9);

    expect(lines).toHaveLength(0);
  });

  it("returns [] for whitespace-only input (multiple spaces)", () => {
    const context = createTestContext();
    const lines = wrapText(context, "     ", 1080 * 0.9);

    expect(lines).toHaveLength(0);
  });

  it("returns [] for tab and newline whitespace", () => {
    const context = createTestContext();
    const lines = wrapText(context, "\t\n\r\t", 1080 * 0.9);

    expect(lines).toHaveLength(0);
  });

  it("collapses multiple spaces between words", () => {
    const context = createTestContext();
    const lines = wrapText(context, "Hello    World", 1080 * 0.9);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Hello World");
  });

  it("normalizes tabs and newlines to spaces", () => {
    const context = createTestContext();
    const lines = wrapText(context, "Hello\tWorld\nToday", 1080 * 0.9);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Hello World Today");
  });

  it("trims leading and trailing whitespace", () => {
    const context = createTestContext();
    const lines = wrapText(context, "   Hello World   ", 1080 * 0.9);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Hello World");
  });

  it("handles mixed whitespace with real content", () => {
    const context = createTestContext();
    const lines = wrapText(context, "\n\tSummer Sale\r\n", 1080 * 0.9);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Summer Sale");
  });

  it("wraps long text via overlayText integration without crashing", async () => {
    const wrappingMessage =
      "This is a very long campaign message that should wrap across multiple lines in the overlay band";
    const dalleImage = await createTestImage(1024, 1024);
    const resultBuffer = await overlayText(
      dalleImage,
      wrappingMessage,
      SQUARE_DIMENSIONS
    );

    expect(resultBuffer).toBeInstanceOf(Buffer);
  });
});
