# Seed prompt — Voltcraft (summer festival energy drink)

Paste this text into the **AI Brief Orchestrator** input field on the dashboard,
then click **Generate Creatives**. The 4-phase orchestration will refine it into
a structured brief similar to [`brief.json`](./brief.json).

```
Activate Voltcraft for the summer festival circuit in North America — Gen Z and younger millennials in their late teens through twenties, EDM and indie scene, energy drink and adaptogen-curious. Two SKUs lead the activation: Surge in Tropical Storm flavor with 200mg natural caffeine, 1g L-theanine for clean focus, and an electrolyte blend; and Glow in Berry Lightning with ashwagandha, B-vitamin complex, and real berry juice for sustained six-hour energy. Both are zero sugar, zero crash. Visual direction is high-energy neon, electric, night-scene cinematic, vibrant gradients, motion-blur kinetic — think main-stage at 1am. Tagline: "All night. Every set. Zero crash."
```

## Demo talking points

- **Demo closer — most distinctive output.** Visually, this is the brief that
  produces the most striking images, so save it for last. The bold tone
  ("neon, electric, night-scene cinematic") pushes DALL-E away from the
  default product-photography aesthetic in a way that's immediately obvious
  to a reviewer.
- **Adaptogen and stimulant claims.** The seed mentions caffeine dosage,
  L-theanine, ashwagandha, and "zero crash" — all claims a Legal reviewer
  would flag in the orchestration's Review phase. Walk through how the
  Legal agent handles ingredient claims (see `lib/ai/agents.ts` —
  the Legal prompt is grounded in regulated-claim review patterns).
- **CMO reviewer angle.** "Festival activation" is a brand-tier marketing
  term — explain that the CMO agent in the Review phase ensures the brief
  doesn't drift into something a CMO wouldn't sign off on (e.g., an
  underage-targeted message, an off-brand tone).
- **Brand colors and guardrails.** The orchestrator should pick high-energy
  hex values (cyan, magenta, electric pink) — these flow through to the
  prompt builder as the literal accent palette. Auditable. Brand-safe in
  the sense that the marketer can constrain the creative axis without
  having to art-direct DALL-E directly.
