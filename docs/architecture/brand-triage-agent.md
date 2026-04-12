# Brand Triage Agent — Architecture Spec

> Multi-tenant brand context injection for hyper-specific campaign generation.
> This is the pattern that turns AdSpark from a generic image pipeline into
> a platform that understands each customer's brand identity.

---

## The Problem

Right now, AdSpark's prompt builder uses generic modifiers:

```
"A premium sun protection product: SPF 50 Mineral Sunscreen..."
"The mood is vibrant, trustworthy, active lifestyle..."
```

This produces decent images, but they're **not brand-specific.** A Coca-Cola sunscreen campaign should feel different from a Neutrogena sunscreen campaign — different color palettes, different photography styles, different emotional registers, different competitive positioning.

Enterprise clients pay premium for this differentiation. The business-context.html says: *"Brand consistency enforced by the pipeline, not by manual review."* The Brand Triage Agent is how that happens.

## The Solution

A **Brand Triage Agent** that sits between the campaign brief and the pipeline. It:

1. **Identifies** which company is using the platform
2. **Loads** that company's brand profile (colors, typography, voice, visual style, competitors, prohibited terms)
3. **Enriches** the pipeline context so every downstream component — prompt builder, text overlay, compliance checks — is brand-aware
4. **Routes** brand-specific rules to the right pipeline stages

```
                    ┌─────────────────────────┐
                    │  Brand Triage Agent      │
Campaign Brief ────▶│                         │
                    │  1. Identify company     │
                    │  2. Load brand profile   │
                    │  3. Enrich brief context │
                    │  4. Route brand rules    │
                    └────────┬────────────────┘
                             │
                   ┌─────────▼─────────┐
                   │ Enriched Pipeline  │
                   │ Context            │
                   └─────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        Prompt Builder  Text Overlay  Compliance
        (brand style    (brand fonts  (prohibited
         tokens)         + colors)     terms)
```

## Brand Profile Schema

Each company that integrates with AdSpark provides (or we extract) a brand profile:

```typescript
interface BrandProfile {
  // Identity
  companyId: string;
  companyName: string;
  industry: string;
  subIndustry?: string;

  // Visual Identity
  visual: {
    primaryColors: string[];        // Hex codes: ["#DA1A32", "#000000"]
    secondaryColors: string[];      // Accent palette
    colorMood: string;              // "bold and energetic" | "calm and premium" | ...
    photographyStyle: string;       // "lifestyle action shots" | "clean product studio" | ...
    lightingPreference: string;     // "warm natural" | "cool studio" | "dramatic contrast"
    compositionNotes: string;       // "always show product in use, not isolated"
    avoidVisuals: string[];         // ["competitor products", "generic stock photo feel"]
  };

  // Typography & Text
  typography: {
    headlineFont: string;           // "Futura Bold" | system font name
    bodyFont: string;
    fontUrl?: string;               // URL to load custom font file
    textTransform: "uppercase" | "capitalize" | "none";
    overlayStyle: "band" | "gradient" | "knockout" | "minimal";
  };

  // Voice & Tone
  voice: {
    brandPersonality: string;       // "playful and irreverent" | "premium and aspirational"
    toneModifiers: string[];        // ["confident", "inclusive", "expert"]
    avoidLanguage: string[];        // ["cheap", "discount", "basic"]
    tagline?: string;               // "Just Do It" | "Because You're Worth It"
  };

  // Compliance Rules
  compliance: {
    prohibitedTerms: string[];      // Legal/trademark restrictions
    requiredDisclaimer?: string;    // "SPF claims not evaluated by FDA"
    competitorNames: string[];      // Never reference in generated content
    regulatoryRegions: string[];    // Regions with specific ad rules
  };

  // Platform-Specific Overrides
  platformOverrides?: {
    instagram?: { tone?: string; visualStyle?: string };
    tiktok?: { tone?: string; visualStyle?: string };
    facebook?: { tone?: string; visualStyle?: string };
    linkedin?: { tone?: string; visualStyle?: string };
  };
}
```

## How It Enriches Each Pipeline Stage

### 1. Prompt Builder Enrichment

**Current** prompt Layer 4 (Style):
```
"Photorealistic commercial product photography. High-end advertising quality."
```

**With Brand Triage**, Layer 4 becomes brand-specific:
```
"${brand.visual.photographyStyle}. Lighting: ${brand.visual.lightingPreference}.
 Color palette anchored to ${brand.visual.primaryColors.join(', ')}.
 Mood: ${brand.visual.colorMood}. ${brand.voice.brandPersonality}.
 Avoid: ${brand.visual.avoidVisuals.join(', ')}."
```

This is the core value — same pipeline architecture, but the prompts produce **on-brand** imagery because the style layer is parameterized by the brand profile.

### 2. Text Overlay Enrichment

**Current:** System sans-serif, white text, black band.

**With Brand Triage:**
```typescript
const overlayConfig = {
  font: brand.typography.headlineFont,
  fontUrl: brand.typography.fontUrl,       // registerFont() with brand's TTF
  textTransform: brand.typography.textTransform,
  overlayStyle: brand.typography.overlayStyle,
  primaryColor: brand.visual.primaryColors[0],
  backgroundColor: brand.visual.primaryColors[1] ?? 'rgba(0,0,0,0.6)',
};
```

### 3. Compliance Check Enrichment

**Current:** Not implemented (ADS-021 is a basic prohibited word filter).

**With Brand Triage:**
```typescript
function checkCompliance(message: string, brand: BrandProfile): ComplianceResult {
  const violations: string[] = [];

  // Check brand-specific prohibited terms
  for (const term of brand.compliance.prohibitedTerms) {
    if (message.toLowerCase().includes(term.toLowerCase())) {
      violations.push(`Prohibited term: "${term}"`);
    }
  }

  // Check competitor names
  for (const competitor of brand.compliance.competitorNames) {
    if (message.toLowerCase().includes(competitor.toLowerCase())) {
      violations.push(`Competitor reference: "${competitor}"`);
    }
  }

  // Check avoid-language from voice guidelines
  for (const avoid of brand.voice.avoidLanguage) {
    if (message.toLowerCase().includes(avoid.toLowerCase())) {
      violations.push(`Brand voice violation: avoid "${avoid}"`);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    disclaimer: brand.compliance.requiredDisclaimer,
  };
}
```

## Brand Profile Sources

How does the Brand Triage Agent learn about a company?

### Source 1: Manual Upload (POC)
Company provides a JSON brand profile as part of onboarding. This is the simplest path and what the assessment would demonstrate.

```json
{
  "companyId": "neutrogena",
  "companyName": "Neutrogena",
  "industry": "Consumer Health",
  "visual": {
    "primaryColors": ["#003DA5", "#FFFFFF"],
    "photographyStyle": "clinical clean product photography with real skin textures",
    "lightingPreference": "bright, even, clinical lighting",
    ...
  }
}
```

### Source 2: Brand Guidelines PDF Extraction (V2)
Use an LLM to extract brand profile fields from uploaded brand guidelines PDFs. Most enterprises have 50-100 page brand books — the agent reads them and produces a structured `BrandProfile`.

```
Brand Guidelines PDF → LLM extraction → BrandProfile JSON → Human approval → Saved
```

### Source 3: Website/Social Scraping (V3)
For companies without formal brand guidelines, the agent analyzes their existing digital presence:
- **Website:** Extract primary/secondary colors from CSS, fonts from `@font-face`, voice from copy
- **Social media:** Analyze existing ad creatives for photography style, color temperature, composition
- **Competitors:** Compare against competitor visual identity to ensure differentiation

This is where MCP tools become powerful — an MCP that can browse a company's website and social accounts feeds structured brand data back to the triage agent.

## Architecture: Where It Fits

```
CampaignBrief
  + BrandProfile (from brand triage)
  = EnrichedBrief
      │
      ├── briefParser.ts         (validates brief + brand profile)
      ├── promptBuilder.ts       (injects brand visual/voice tokens into all 5 layers)
      ├── textOverlay.ts         (uses brand fonts, colors, overlay style)
      ├── complianceChecker.ts   (validates against brand rules)
      └── outputOrganizer.ts     (includes brand metadata in manifest)
```

### Type Extension

The existing `CampaignBrief` type gains an optional `brand` field:

```typescript
export interface CampaignBrief {
  campaign: Campaign;
  products: Product[];
  aspectRatios: AspectRatio[];
  outputFormats: OutputFormats;
  brand?: BrandProfile;           // Optional — pipeline works without it (generic mode)
}
```

When `brand` is present, every pipeline component uses it. When absent, the pipeline falls back to the generic style (current behavior). This is backwards-compatible — no existing functionality breaks.

## MCP Integration Points

The Brand Triage Agent can leverage MCP servers for external data:

| MCP Server | Purpose | Data Provided |
|------------|---------|---------------|
| **Web Browser** | Scrape company website for colors, fonts, copy style | CSS vars, font-face, hero imagery analysis |
| **Social Media** | Analyze existing ad creatives | Photography style, color temperature, composition patterns |
| **Brand Asset Manager** | Connect to Adobe DAM / Bynder / Brandfolder | Logo files, approved imagery, brand guidelines PDF |
| **Compliance DB** | Industry-specific ad regulations per region | Prohibited claims, required disclaimers, competitor restrictions |

## Example: Neutrogena vs Coca-Cola

Same product category (sunscreen), same pipeline, radically different output:

| Dimension | Neutrogena | Coca-Cola |
|-----------|-----------|-----------|
| Photography | Clinical, clean, real skin | Lifestyle, beach party, action |
| Colors | Blue + white (#003DA5) | Red + white (#DA1A32) |
| Lighting | Bright, even, clinical | Warm, golden hour, vibrant |
| Mood | Trustworthy, scientific, gentle | Fun, energetic, social |
| Voice | "Dermatologist recommended" | "Open happiness" |
| Avoid | "cheap", "harsh chemicals" | "diet", "sugar", "unhealthy" |
| Overlay | Clean white band, sans-serif | Bold red gradient, custom font |

The same `buildPrompt()` function produces completely different DALL-E prompts because the brand profile parameterizes every style decision.

## Implementation Plan for AdSpark

### POC Scope (ADS-024)
For the assessment, a lightweight version:

1. Add `brand` field to `CampaignBrief` type (optional)
2. Create `examples/brand-profiles/` with 2 sample profiles (Neutrogena-style, Coca-Cola-style)
3. If `brand` is present, inject `brand.visual.*` into prompt Layer 4 (Style)
4. If `brand.compliance.prohibitedTerms` exists, run compliance check before generation
5. Show in demo: same campaign brief, two different brand profiles → visually distinct creatives

**Time estimate:** 45-60 minutes on top of a working pipeline.

### Production Scope
1. Brand Profile CRUD API (admin dashboard)
2. PDF extraction agent (LLM-powered brand guideline parser)
3. Website scraping MCP for auto-discovery
4. Brand approval workflow (human reviews extracted profile before activation)
5. A/B testing: compare brand-enriched vs generic prompts for conversion lift
6. Brand consistency scoring: compare generated creative against brand profile rules

## Why This Matters for the Interview

Quinn Frampton said: *"Interested in HOW he got the AI to do it."*

The Brand Triage Agent is the answer to "how do you make this work for different clients?" — the exact question an FDE gets asked on every engagement. It shows:

1. **Multi-tenant thinking** — not a one-off demo, but a platform pattern
2. **MCP awareness** — the agent can connect to external brand data sources
3. **Enterprise sensitivity** — brand compliance and competitive awareness
4. **Prompt engineering depth** — parameterized prompt templates, not hardcoded strings
5. **Scalability** — onboard a new client by adding a brand profile, not rewriting code
