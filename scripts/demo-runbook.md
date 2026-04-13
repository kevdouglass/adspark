# Loom Demo Runbook — AdSpark

**Target:** 2-3 minutes. Demo against the local Docker container (not Vercel — production has a 500 I haven't debugged yet). Same code, different runtime.

**The one-line pitch:** *AdSpark turns a natural-language campaign description into 6 platform-ready social ad creatives in ~45 seconds, using a 5-stakeholder AI orchestrator for brief refinement, DALL-E 3 for generation, and a structured-logging pipeline with graceful container shutdown — all in a production-grade Docker container.*

---

## Before you hit record (30 sec prep)

1. **Verify the demo environment is ready**
   ```bash
   bash scripts/demo.sh preflight
   ```
   Expected: all green checks. If Docker container isn't running, it starts it.

2. **Open two browser tabs:**
   - Tab 1: `http://localhost:3001` (the Docker container — **this is your primary demo view**)
   - Tab 2: `https://github.com/kevdouglass/adspark` (the repo — for the "show me the code" moment at the end)

3. **Open two terminal panes (or tabs):**
   - Terminal A: blank, ready for the generate command
   - Terminal B: `bash scripts/demo.sh tail` — streams container logs as they happen. **Keep this visible on screen.**

4. **Close everything else.** Slack, email, notifications. Loom will capture it all.

---

## The Loom — timed script

### [0:00 – 0:15] Hook + context (15s)

> "Hi, I'm Kevin. This is **AdSpark** — my submission for the Adobe Forward Deployed AI Engineer Firefly role. The problem I'm solving: global consumer goods companies spend 4 to 8 weeks and up to $500,000 producing a single localized social ad campaign. AdSpark takes that to about 45 seconds per campaign and under a dollar in API calls."

**On screen:** Browser tab showing the dashboard at `http://localhost:3001`, which is the dashboard idle state with the "How it works" section and the empty AI Brief Orchestrator textarea.

---

### [0:15 – 0:45] The AI brief orchestrator — the "deep research" beat (30s)

> "The heart of this is a **5-stakeholder AI orchestrator**. When a marketer describes a campaign in plain English, I run a 4-phase multi-agent pipeline: a triage agent sets review priorities, a Campaign Manager drafts the brief, then four specialist reviewers run in parallel — Creative Director, Regional Marketing Lead, Legal/Compliance, and a CMO — and a synthesizer merges their edits into the final brief. Every agent is grounded in a real enterprise pain point, not invented for the demo."

**What to do:**
1. Click the **"✨ Load example"** button. A seed prompt appears.
2. Click **"Generate Creatives."**
3. The sidebar starts showing the agent phases flowing: *Orchestrator triaging → Campaign Manager drafting → 4 reviewers in parallel → Synthesizing.*

**What to point out:** The sidebar showing agent phases. Say:

> "Notice how the four reviewers run in parallel — that cut the orchestration phase from about 12 seconds sequentially down to 3 seconds. This is ~10 seconds of orchestration, then the DALL-E pipeline kicks in."

---

### [0:45 – 1:30] The pipeline runs + structured logs (45s)

**Glance at Terminal B** (the log tail) as events stream in.

> "While that's running, watch the terminal on the left. Every pipeline event is a structured JSON line with a requestId — you can grep a full trace for any request across the whole stack. Here's DALL-E starting, here's it finishing with the byte count, here's compositing, here's the storage write, here's the manifest being written, here's the request completing with a 200 and the total time."

**Point out specific events as they appear:**
- `request.received` — "request in"
- `pipeline.start` — "pipeline begins"
- `dalle.start` → `dalle.done` — "DALL-E call, with timing and byte count"
- `composite.image` → `composite.done` — "text overlay compositing via Canvas"
- `storage.save` — "writing to the named Docker volume"
- `manifest.write` — "audit trail written"
- `request.complete` — "200 out"

---

### [1:30 – 2:00] The creatives render + the manifest (30s)

The dashboard now shows the staggered masonry gallery with creatives.

> "And the creatives render. Here's the 1:1 Feed Post, the 9:16 Story/Reel, the 16:9 Landscape. Every image has the campaign message composited at the bottom via Canvas, because DALL-E 3 cannot reliably render legible text itself — that's documented as a known limitation in the README."

**Hover over one creative:**
> "Each creative has its DALL-E generation time, composite time, and a click-through to the prompt that produced it. Brand-safety reviewers can grep the manifest for any field."

---

### [2:00 – 2:30] The infrastructure story — the 9/10 beat (30s)

**Switch to Terminal A.** Run:
```bash
bash scripts/demo.sh healthz
```

> "This demo is running in a Docker container — same code that would deploy to ECS, Cloud Run, or Fly.io. Node 22, non-root user, standalone output. The `/api/healthz` endpoint returns the full timeout cascade contract so a reverse proxy can smoke-test its own configuration. If the proxy's idle timeout is below the recommended value, your pipeline budget fires before the proxy kills the stream — we document that as a required configuration in `docs/docker.md`."

> "Graceful SIGTERM drain is wired via `instrumentation.ts`. If Docker sends a shutdown signal mid-pipeline, `/api/healthz` flips to 503 so the load balancer drains, in-flight DALL-E calls get the full 120-second pipeline budget to complete, and the named volume preserves any output."

---

### [2:30 – 3:00] Wrap + links (30s)

**Switch to the GitHub tab.**

> "The repo is at `github.com/kevdouglass/adspark`. The README is under 400 lines, the full container reference is in `docs/docker.md` with every design decision annotated by file and line, and the multi-agent orchestrator lives in `lib/ai/agents.ts`. 250 tests passing including abort-control, healthz contract, and the 7-phase agent event stream. Clean architecture, production-grade container, honest limitations documented."

> "Thanks for watching. Looking forward to the live technical interview."

**Stop recording.**

---

## Fallback commands (if anything breaks mid-demo)

### If the container went unhealthy
```bash
docker compose ps        # check state
docker compose restart   # quick restart
bash scripts/demo.sh preflight
```

### If you need to fire a generate via curl (no UI)
```bash
bash scripts/demo.sh generate                                     # minimal 1-image brief
bash scripts/demo.sh generate examples/campaigns/fall-coffee-launch/brief.json   # 3-image coffee brief
```

### If the log tail stops scrolling mid-demo
Open a new terminal pane:
```bash
docker compose logs -f adspark | tail -50
```

### If you want to show graceful shutdown
```bash
# Terminal 1: watch healthz
while true; do curl -sf http://localhost:3001/api/healthz -o /dev/null -w "HTTP %{http_code}  %{time_total}s\n"; sleep 1; done

# Terminal 2: trigger drain
docker compose stop adspark
# healthz flips from 200 to 503 before the container finally exits
```

---

## Key talking points (memorize these)

Short sentences you can drop into the narration:

- *"Same codebase, two deploy targets: Vercel serverless functions AND a Docker container. They produce identical 20-event structured log streams byte for byte."*
- *"The pipeline budget is preemptive, not advisory. An `AbortController` fires a `setTimeout(120s)` that propagates through `runPipeline → generateImages → client.images.generate({signal}) → withRetry`. A runaway request is cancelled in the HTTP call, the retry backoff, AND the next retry attempt — all in a single event-loop tick."*
- *"The prompt builder is **template-based, not LLM-generated**. Five layers: Subject, Context, Composition, Style, Exclusions. Brand safety requires predictability — a reviewer can predict exactly what will come out for a given input."*
- *"`lib/pipeline/` has zero framework dependencies. Drop it into a Python FastAPI wrapper and it still works. Dependency inversion is enforced by import discipline, not convention."*
- *"Known limitation: DALL-E 3 can't reliably render legible text in images. That's why we composite the campaign message via Canvas AFTER generation. Documented in the README alongside three other honest limitations."*

---

## DO NOT

- Don't narrate against the broken Vercel deploy. Say "for this demo I'm running the container locally" if asked.
- Don't show terminal output below the fold — if the log tail runs off screen, scroll deliberately so viewers can read it.
- Don't say "250 tests pass" without having run them recently. If anything changes, re-run `npm run test:run` before you record.
- Don't cut off mid-sentence for the 3:00 mark. Finish the thought, then stop.
- Don't leave `.env.docker` open on screen — it has your OpenAI key.
