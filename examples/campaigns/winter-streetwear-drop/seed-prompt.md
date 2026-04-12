# Seed prompt — Northgrid (winter streetwear drop)

Paste this text into the **AI Brief Orchestrator** input field on the dashboard,
then click **Generate Creatives**. The 4-phase orchestration will refine it into
a structured brief similar to [`brief.json`](./brief.json).

```
Drop a winter technical streetwear collection from Northgrid for urban Gen Z and millennial commuters in Northeast US cities — design-literate, into all-weather layering and premium technical fabrics. Two pieces lead the drop: a 3-layer waterproof Stormshell parka with seam-taped construction and recycled face fabric, and the Thermal Cargo Pant with Primaloft insulation, windproof front panels, and zip thigh pockets. Tone should feel moody, editorial, high-contrast, with a cold blue-grey palette — premium streetwear, not athleisure. Tagline: "Built for the city that doesn't slow down."
```

## Demo talking points

- **Two-product brief from one prompt.** The orchestrator parses both products
  out of the seed text and emits an array of two `Product` objects in the
  resulting brief — no manual schema knowledge required from the marketer.
- **Tone vs. season interplay.** The seed asks for "moody, editorial,
  high-contrast" tone — the orchestrator preserves that on `campaign.tone`
  while still setting `season: winter`, which the prompt builder later turns
  into `cool blue tones, cozy indoor or snowy outdoor setting`. Two
  independent levers, both honored.
- **Brand-color extraction.** The orchestrator picks plausible hex values for
  each product based on the descriptive language ("cold blue-grey palette") —
  point this out as evidence that the agents understand brand intent, not
  just copy literal hex codes.
- **Six images from one click.** 2 products × 3 aspect ratios = 6 DALL-E
  generations after the orchestration completes. Good moment to walk the
  pipeline timeout cascade.
