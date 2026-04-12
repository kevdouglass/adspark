# Image Processing Architecture

> How AdSpark generates, processes, and delivers ad creatives across social platforms.
> Covers library roles, aspect ratios, crop strategy, text overlay, output formats, and export rules.

---

## Library Roles

Two libraries handle distinct responsibilities:

| Library | Role | Operations |
|---------|------|-----------|
| **Sharp** | Image I/O + Transformation | Resize, crop, format conversion, optimization, metadata stripping |
| **@napi-rs/canvas** | Compositing + Text Rendering | Text overlay, brand element placement, multi-line layout, font rendering |

### Why Two Libraries?

Sharp (libvips-backed) is the fastest Node.js image library for pixel transformations — it processes images in a streaming pipeline without loading the full bitmap into memory. But it has no text rendering API.

@napi-rs/canvas (Skia-backed, Rust-native) provides a Canvas 2D API with high-quality text rendering, font loading, and compositing. It's the Node.js equivalent of Python's Pillow `ImageDraw`.

**Pipeline flow:**

```
DALL-E output (URL/base64)
  → Sharp: download, decode, resize to target dimensions
  → @napi-rs/canvas: composite text overlay (campaign message)
  → Sharp: optimize, format convert, export
```

---

## Supported Aspect Ratios & Platform Sizes

Each creative is produced in 3 aspect ratios targeting major social platforms:

| Ratio | Dimensions (px) | Platform Target | DALL-E 3 Size Param |
|-------|-----------------|----------------|-------------------|
| **1:1** | 1080 × 1080 | Instagram Feed, Facebook Feed | `1024x1024` |
| **9:16** | 1080 × 1920 | Instagram Stories, TikTok, Reels | `1024x1792` |
| **16:9** | 1200 × 675 | Facebook Link Preview, Twitter/X, LinkedIn | `1792x1024` |

### DALL-E 3 Size Mapping

DALL-E 3 supports exactly three sizes: `1024x1024`, `1024x1792`, `1792x1024`. These don't match platform dimensions exactly, so post-processing is required:

| Target | DALL-E 3 Output | Post-Processing |
|--------|----------------|----------------|
| 1080 × 1080 | 1024 × 1024 | Upscale via Sharp `.resize(1080, 1080)` |
| 1080 × 1920 | 1024 × 1792 | Upscale via Sharp `.resize(1080, 1920, { fit: 'cover' })` |
| 1200 × 675 | 1792 × 1024 | Downscale + crop via Sharp `.resize(1200, 675, { fit: 'cover' })` |

---

## Crop & Fit Strategy

All resizing uses Sharp's `fit: 'cover'` with `position: 'center'`:

```typescript
await sharp(inputBuffer)
  .resize(targetWidth, targetHeight, {
    fit: 'cover',       // Fill the target dimensions, cropping excess
    position: 'center', // Crop from center (keeps subject focus)
  })
  .toBuffer();
```

### Why `cover` + `center`?

- **`cover`**: Ensures the entire target area is filled — no letterboxing, no empty space. Ad creatives must be full-bleed.
- **`center`**: AI-generated images typically center their subject. Center crop preserves the focal point. For the POC, this is the best default without subject detection.
- **Production improvement:** Use Sharp's `attention` strategy (saliency-based smart crop) or integrate a subject detection model to set the gravity point dynamically.

### Edge Case: 16:9 Crop from DALL-E's 1792x1024

DALL-E outputs at 1792 × 1024 (1.75:1). Target is 1200 × 675 (1.78:1). The aspect ratios are close but not identical:

```
Source:  1792 × 1024  →  ratio 1.750
Target:  1200 × 675   →  ratio 1.778
```

Sharp's `cover` fit handles this: it scales to fill, then crops 0.5% off the height. Visually imperceptible.

---

## Text Overlay Compositing

Campaign messages are rendered onto each creative using @napi-rs/canvas.

### Text Layout Strategy

```
┌──────────────────────────────┐
│                              │
│                              │
│                              │
│  ┌────────────────────────┐  │
│  │  CAMPAIGN MESSAGE      │  │  ← Bottom 25% of image
│  │  Multi-line, centered  │  │  ← Semi-transparent background band
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Position | Bottom 25% of image | Keeps main creative visible; standard ad layout |
| Background | Semi-transparent black band (`rgba(0,0,0,0.6)`) | Ensures text legibility regardless of image content |
| Font | System sans-serif (POC) / Brand font via `registerFont()` (production) | Zero dependency for POC; font loading for production |
| Font size | Scaled to image width: `width / 20` for headline | Responsive across all aspect ratios |
| Color | White (`#FFFFFF`) | Maximum contrast on dark band |
| Alignment | Center-aligned, word-wrapped | Standard for social ad copy |
| Max lines | 3 | Prevents text from overwhelming the creative |
| Padding | 5% of image width on each side | Breathing room within the band |

### Implementation Pattern

```typescript
import { createCanvas, loadImage } from '@napi-rs/canvas';

async function overlayText(
  imageBuffer: Buffer,
  message: string,
  width: number,
  height: number
): Promise<Buffer> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = await loadImage(imageBuffer);
  
  // Draw the base image
  ctx.drawImage(image, 0, 0, width, height);
  
  // Semi-transparent band in bottom 25%
  const bandY = height * 0.75;
  const bandHeight = height * 0.25;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, bandY, width, bandHeight);
  
  // Campaign message text
  const fontSize = Math.round(width / 20);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Word-wrap + render (simplified — full impl wraps to max 3 lines)
  const lines = wrapText(ctx, message, width * 0.9);
  const lineHeight = fontSize * 1.3;
  const textStartY = bandY + bandHeight / 2 - (lines.length * lineHeight) / 2;
  
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, textStartY + i * lineHeight + lineHeight / 2);
  });
  
  return canvas.toBuffer('image/png');
}
```

---

## Output Formats

| Format | Use Case | Quality | Notes |
|--------|---------|---------|-------|
| **PNG** | Final composited creatives | Lossless | Primary output — text clarity matters |
| **WebP** | Dashboard thumbnails | 80% quality | 30-50% smaller than PNG, used for gallery previews |
| **JPEG** | Not used | — | Lossy compression creates artifacts on text edges |

### Export Configuration

```typescript
// Final creative (PNG, full quality)
await sharp(composited).png({ quality: 100, compressionLevel: 6 }).toBuffer();

// Dashboard thumbnail (WebP, 400px wide)
await sharp(composited).resize(400).webp({ quality: 80 }).toBuffer();
```

---

## Output Organization

### Folder Structure (Local / S3)

```
output/
├── {campaign-id}/
│   ├── {product-slug}/
│   │   ├── 1x1/
│   │   │   ├── creative.png          # Full-size composited creative
│   │   │   └── thumbnail.webp        # Dashboard thumbnail
│   │   ├── 9x16/
│   │   │   ├── creative.png
│   │   │   └── thumbnail.webp
│   │   └── 16x9/
│   │       ├── creative.png
│   │       └── thumbnail.webp
│   └── {product-slug}/
│       └── ... (same structure)
├── manifest.json                      # Full manifest: paths, metadata, generation params
└── brief.json                         # Copy of input brief for reproducibility
```

### S3 Key Pattern

```
s3://{bucket}/campaigns/{campaign-id}/{product-slug}/{ratio}/creative.png
s3://{bucket}/campaigns/{campaign-id}/{product-slug}/{ratio}/thumbnail.webp
s3://{bucket}/campaigns/{campaign-id}/manifest.json
```

### Manifest File

Every generation run produces a `manifest.json` for traceability:

```json
{
  "campaignId": "summer-2026-sunscreen",
  "generatedAt": "2026-04-11T18:30:00Z",
  "products": [
    {
      "name": "SPF 50 Sunscreen",
      "slug": "spf-50-sunscreen",
      "creatives": [
        {
          "ratio": "1:1",
          "dimensions": "1080x1080",
          "path": "spf-50-sunscreen/1x1/creative.png",
          "thumbnailPath": "spf-50-sunscreen/1x1/thumbnail.webp",
          "prompt": "...(the exact prompt sent to DALL-E)...",
          "model": "dall-e-3",
          "generationTimeMs": 14200,
          "textOverlay": "Stay Protected All Summer"
        }
      ]
    }
  ],
  "totalTimeMs": 22400,
  "totalImages": 6
}
```

---

## Production Considerations

| Concern | POC | Production |
|---------|-----|------------|
| Font loading | System sans-serif | Brand font files via `registerFont()`, loaded from S3 |
| Subject-aware crop | Center gravity | Sharp `attention` strategy or ML-based saliency detection |
| Color profile | sRGB default | Preserve ICC profiles for print-ready output |
| DPI | 72 (screen) | 300 for print assets, 72 for digital |
| Watermarking | None | Content Credentials (C2PA) for AI-generated content tracking |
| Brand compliance | None | Color picker validation against brand palette, logo detection |
| Accessibility | None | Alt-text generation from campaign brief for screen readers |
