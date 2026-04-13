#!/usr/bin/env bash
#
# AdSpark — Loom demo script
# ─────────────────────────────────────────────────────────────────
# Run this file from the project root BEFORE starting your Loom
# recording so you know every step works on this exact machine.
# Then follow the "During the Loom" section below while recording.
#
# Usage:
#   bash scripts/demo.sh preflight      # verify everything is ready
#   bash scripts/demo.sh healthz        # side-by-side health probes
#   bash scripts/demo.sh generate       # fire a test brief + show timing
#   bash scripts/demo.sh tail           # stream the container log events
#   bash scripts/demo.sh teardown       # clean up after the demo
#
# Target: Docker container on http://localhost:3001 (primary demo)
# Fallback: dev server on http://localhost:3000

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Colors (only if terminal supports it)
if [[ -t 1 ]]; then
  GREEN=$'\033[0;32m'
  RED=$'\033[0;31m'
  YELLOW=$'\033[0;33m'
  BLUE=$'\033[0;34m'
  DIM=$'\033[2m'
  NC=$'\033[0m'
else
  GREEN=""; RED=""; YELLOW=""; BLUE=""; DIM=""; NC=""
fi

DEV_URL="http://localhost:3000"
DKR_URL="http://localhost:3001"
MINIMAL_BRIEF="examples/minimal-brief.json"
CAMPAIGN_BRIEF="examples/campaigns/fall-coffee-launch/brief.json"

log()   { echo "${BLUE}[demo]${NC} $1"; }
ok()    { echo "${GREEN}✓${NC} $1"; }
warn()  { echo "${YELLOW}⚠${NC} $1"; }
fail()  { echo "${RED}✗${NC} $1"; }

# ─────────────────────────────────────────────────────────────────
# PREFLIGHT — run this ~60 seconds before starting your Loom
# ─────────────────────────────────────────────────────────────────
preflight() {
  log "Preflight — verifying demo environment"
  echo

  # 1. Docker container healthy?
  log "Checking Docker container state…"
  if ! docker compose ps --format "{{.Status}}" 2>/dev/null | grep -q "healthy"; then
    fail "Docker container is not healthy"
    log "Starting it now: HOST_PORT=3001 docker compose up -d"
    HOST_PORT=3001 docker compose up -d
    log "Waiting 30s for the healthcheck grace window…"
    sleep 30
  fi
  ok "Docker container: $(docker compose ps --format '{{.Status}}' adspark 2>/dev/null || echo unknown)"

  # 2. Both endpoints responding?
  log "Probing healthz endpoints…"
  if curl -sf "$DEV_URL/api/healthz" >/dev/null 2>&1; then
    ok "DEV  $DEV_URL  healthy"
  else
    warn "DEV  $DEV_URL  NOT RESPONDING (dev server not running — OK for Docker-only demo)"
  fi

  if curl -sf "$DKR_URL/api/healthz" >/dev/null 2>&1; then
    ok "DKR  $DKR_URL  healthy"
  else
    fail "DKR  $DKR_URL  NOT RESPONDING — container is NOT serving traffic"
    exit 1
  fi

  # 3. Example briefs on disk?
  for brief in "$MINIMAL_BRIEF" "$CAMPAIGN_BRIEF"; do
    if [[ -f "$brief" ]]; then
      ok "brief found: $brief"
    else
      fail "brief missing: $brief"
      exit 1
    fi
  done

  # 4. OpenAI key set in container?
  log "Verifying OPENAI_API_KEY is configured inside the container…"
  if MSYS_NO_PATHCONV=1 docker compose exec -T adspark sh -c 'test -n "$OPENAI_API_KEY"'; then
    ok "OPENAI_API_KEY is set inside the container"
  else
    fail "OPENAI_API_KEY is NOT set — fix .env.docker before recording"
    exit 1
  fi

  echo
  log "Preflight complete. Demo target:"
  echo "    ${BLUE}Primary (container):${NC}    $DKR_URL"
  echo "    ${DIM}Backup (dev server):${NC}    $DEV_URL"
  echo
  log "You are clear to hit record."
}

# ─────────────────────────────────────────────────────────────────
# HEALTHZ — side-by-side probe you can run during the Loom
# ─────────────────────────────────────────────────────────────────
healthz() {
  log "Side-by-side health probe"
  echo
  echo "=== DEV  $DEV_URL ==="
  curl -s "$DEV_URL/api/healthz" || echo "DOWN"
  echo
  echo
  echo "=== DKR  $DKR_URL ==="
  curl -s "$DKR_URL/api/healthz" || echo "DOWN"
  echo
  echo
  ok "Both instances return the same timeout-cascade contract — same codebase, two targets."
}

# ─────────────────────────────────────────────────────────────────
# GENERATE — fire a test brief and print the full timing breakdown
# Narrate this part out loud during the Loom.
# ─────────────────────────────────────────────────────────────────
generate() {
  local brief="${1:-$MINIMAL_BRIEF}"
  local target="${2:-$DKR_URL}"

  log "Firing a generate against $target"
  log "Brief: $brief"
  echo

  local start_epoch=$(date +%s)
  curl -s -X POST "$target/api/generate" \
    -H "Content-Type: application/json" \
    -d "@$brief" \
    -w "\n  ${GREEN}HTTP %{http_code}${NC}  time=%{time_total}s\n" \
    -o .demo-resp.json 2>&1 || true
  local elapsed=$(($(date +%s) - start_epoch))
  echo

  if [[ ! -f .demo-resp.json ]]; then
    fail "No response body — check the server logs"
    return 1
  fi

  # Parse the response using Node (always available, unlike jq)
  node -e "
    const d = JSON.parse(require('fs').readFileSync('.demo-resp.json', 'utf8'));
    if (d.code) {
      console.log('  ${RED}ERROR:${NC}  ' + d.code + ' — ' + d.message);
      console.log('  requestId: ' + d.requestId);
      if (d.details) console.log('  details: ' + JSON.stringify(d.details));
      process.exit(1);
    }
    console.log('  requestId:    ' + d.requestId);
    console.log('  campaignId:   ' + d.campaignId);
    console.log('  totalTimeMs:  ' + d.totalTimeMs + 'ms');
    console.log('  creatives:    ' + d.creatives.length);
    console.log('  errors:       ' + d.errors.length);
    console.log('');
    d.creatives.forEach((c, i) => {
      console.log('  ── creative ' + (i+1) + ' ──');
      console.log('    product:      ' + c.productName);
      console.log('    ratio:        ' + c.aspectRatio + '  (' + c.dimensions + ')');
      console.log('    dalle ms:     ' + c.generationTimeMs);
      console.log('    composite ms: ' + c.compositingTimeMs);
      console.log('    path:         ' + c.creativePath);
    });
  " 2>&1 || true

  rm -f .demo-resp.json
  echo
  ok "Generate complete in ${elapsed}s wall time"
}

# ─────────────────────────────────────────────────────────────────
# TAIL — stream the container's structured JSON events
# Use this in a SECOND terminal pane during the Loom so the viewer
# can see the event stream flow in parallel with the UI.
# ─────────────────────────────────────────────────────────────────
tail_logs() {
  log "Streaming container logs (Ctrl+C to stop)"
  log "One JSON event per line, every line carries a requestId."
  echo
  docker compose logs -f adspark
}

# ─────────────────────────────────────────────────────────────────
# TEARDOWN — clean up after the Loom
# ─────────────────────────────────────────────────────────────────
teardown() {
  log "Tearing down Docker container"
  docker compose down
  ok "Container stopped. Named volume 'adspark_adspark-output' preserved."
  log "To also remove the volume: docker compose down -v"
}

# ─────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────
case "${1:-preflight}" in
  preflight) preflight ;;
  healthz)   healthz ;;
  generate)  generate "${2:-}" "${3:-}" ;;
  tail)      tail_logs ;;
  teardown)  teardown ;;
  help|--help|-h)
    echo "Usage: $0 [preflight|healthz|generate|tail|teardown]"
    echo
    echo "  preflight   Verify demo environment (run BEFORE recording)"
    echo "  healthz     Probe both dev server and container /api/healthz"
    echo "  generate    Fire a test brief, print timing breakdown"
    echo "              Optional: $0 generate <brief.json> <http://url>"
    echo "  tail        Stream structured JSON logs from the container"
    echo "  teardown    Stop the container (keeps the output volume)"
    ;;
  *)
    fail "Unknown command: $1"
    echo "Run '$0 help' for usage"
    exit 1
    ;;
esac
