import { describe, it, expect } from "vitest";
import { overlayText, resizeToTarget } from "@/lib/pipeline/textOverlay";
import { createCanvas } from "@napi-rs/canvas";
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

    for (const testCase of testCases) {
      const dalleImage = await createTestImage(
        testCase.dalleWidth,
        testCase.dalleHeight
      );
      const resultBuffer = await overlayText(
        dalleImage,
        CAMPAIGN_MESSAGE,
        testCase.dimensions
      );
      const metadata = await sharp(resultBuffer).metadata();

      expect(metadata.width).toBe(testCase.dimensions.width);
      expect(metadata.height).toBe(testCase.dimensions.height);
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

describe("wrapText (via overlayText integration)", () => {
  it("wraps long text without crashing", async () => {
    // This indirectly tests wrapText by giving overlayText a message
    // that definitely needs wrapping at 1080px width with fontSize 54
    const wrappingMessage =
      "This is a very long campaign message that should wrap across multiple lines in the overlay band at the bottom of the image";
    const dalleImage = await createTestImage(1024, 1024);
    const resultBuffer = await overlayText(
      dalleImage,
      wrappingMessage,
      SQUARE_DIMENSIONS
    );

    expect(resultBuffer).toBeInstanceOf(Buffer);
  });
});
