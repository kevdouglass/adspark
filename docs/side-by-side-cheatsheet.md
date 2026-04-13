# Side-by-side cheat sheet — local dev + Docker container

**Goal:** run your `npm run dev` instance and the Docker container at the same time, monitor both, and fire a test generate at each to verify the code path matches byte-for-byte.

Every command below was verified end-to-end in the session where this file was written. If a command prints something different for you, check the notes under its block.

```
┌────────────────────────┐         ┌────────────────────────┐
│  Your dev server       │         │  Docker container      │
│  npm run dev           │         │  docker compose up     │
│  http://localhost:3000 │         │  http://localhost:3001 │
│  Writes to ./output/   │         │  Named volume          │
│  Reads .env.local      │         │  Reads .env.docker     │
└──────────┬─────────────┘         └──────────┬─────────────┘
           │                                  │
           ▼                                  ▼
   ┌────────────────────────────────────────────────┐
   │  Poll /api/healthz + tail logs + test generate │
   └────────────────────────────────────────────────┘
```

---

## 0. Preflight — 5 seconds of sanity

```bash
# Docker daemon alive?
docker ps                                     # empty table = daemon OK, no containers

# Compose v2?
docker compose version                        # should say v2.x or v5.x (Docker Desktop >= 4)

# Which ports are already held?
netstat -ano | grep LISTENING | grep ":300"
#   TCP 0.0.0.0:3000 ... LISTENING 26288    ← your npm run dev
#   (3001 should be empty — Docker will claim it)
```

If `docker ps` errors with *"failed to connect to the docker API"*, Docker Desktop isn't running — start the Docker Desktop app and wait for the whale icon to stop animating.

If port 3001 is occupied, find and kill whatever is on it:
```bash
netstat -ano | grep ":3001 " | grep LISTENING      # grab the PID
taskkill //PID <PID> //F                           # Git Bash on Windows
# or on macOS/Linux: kill -9 <PID>
```

---

## 1. One-time setup — `.env.docker`

`docker compose` reads environment variables from `.env.docker`, which is gitignored. Copy the template and fill in your OpenAI key:

```bash
cp .env.docker.example .env.docker
# edit .env.docker → OPENAI_API_KEY=sk-proj-...
```

If you already have `.env.local` working, you can cheat and reuse the same key — `.env.docker` only needs `OPENAI_API_KEY` and `STORAGE_MODE=local`. See [`.env.docker.example`](../.env.docker.example) for the full list of optional vars.

---

## 2. Build the container image

```bash
docker compose build
```

**First build:** ~2-3 minutes (pulls `node:22-bookworm-slim`, runs `npm ci`, `next build`, copies standalone output into the runner stage).
**Subsequent builds:** seconds (BuildKit cache mounts keep npm + webpack caches warm).

Expected final lines:
```
 => [runner 8/8] COPY --from=builder ...              0.Xs
 => exporting to image                                0.Xs
 => naming to docker.io/library/adspark:latest        0.0s
```

---

## 3. Start the container side-by-side with dev

The compose file reads `HOST_PORT` so you can pick a non-conflicting port without editing yaml:

```bash
HOST_PORT=3001 docker compose up -d
```

`-d` runs detached so your shell stays free for monitoring. Verify both instances are alive:

```bash
docker compose ps
#   NAME      IMAGE              STATUS           PORTS
#   adspark   adspark:latest     Up (healthy)     0.0.0.0:3001->3000/tcp
```

The container takes up to ~30 seconds to go from `Up (starting)` → `Up (healthy)` because of the `start_period: 30s` grace window in the compose healthcheck.

---

## 4. Side-by-side health probes

Hit `/api/healthz` on both at once:

```bash
echo "=== DEV  :3000 ===" && curl -s http://localhost:3000/api/healthz | jq . && \
echo "=== DKR  :3001 ===" && curl -s http://localhost:3001/api/healthz | jq .
```

Both should return the same payload shape:

```json
{
  "ok": true,
  "version": "dev",
  "storageMode": "local",
  "pipelineBudgetMs": 120000,
  "clientTimeoutMs": 135000,
  "recommendedProxyTimeoutMs": 140000,
  "shuttingDown": false
}
```

**Continuous poll every 2 seconds** (useful as a background monitor while you work):

```bash
while true; do
  clear
  echo "=== $(date +%H:%M:%S) ==="
  printf "DEV  :3000  "; curl -sf http://localhost:3000/api/healthz | jq -c '{ok, storageMode, shuttingDown}' 2>&1 || echo "DOWN"
  printf "DKR  :3001  "; curl -sf http://localhost:3001/api/healthz | jq -c '{ok, storageMode, shuttingDown}' 2>&1 || echo "DOWN"
  sleep 2
done
```

Ctrl+C to stop. If one instance goes down, the corresponding line flips to `DOWN` immediately — handy for watching graceful-shutdown behavior when you `docker compose stop`.

---

## 5. Tail logs from both

### Dev server
Your `npm run dev` terminal already streams its own structured JSON logs to stdout. If you started it with `npm run dev 2>&1 | tee dev.log`, you can tail that file:
```bash
tail -f dev.log
```

### Docker container
```bash
docker compose logs -f adspark
# or with pretty-printing:
docker compose logs -f adspark | jq -R 'fromjson? // .'
```

The `jq -R 'fromjson? // .'` recipe parses each line as JSON when possible and falls through to raw text otherwise — Next.js startup banners are not JSON, so you want the fall-through.

### Filter to one requestId across both logs
Once you fire a generate (step 6), grab the `requestId` from the response and filter both streams to it:

```bash
# Dev
tail -f dev.log | grep <requestId>

# Docker
docker compose logs -f adspark | grep <requestId>
```

---

## 6. Fire test generates — side-by-side comparison

Send the minimal 1-image brief to each instance and print a timing summary:

```bash
START=$(date +%s)
echo "--- DEV :3000 ---"
curl -s -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d @examples/minimal-brief.json \
  -w "HTTP %{http_code}  time=%{time_total}s\n" -o /tmp/dev-response.json

echo "--- DKR :3001 ---"
curl -s -X POST http://localhost:3001/api/generate \
  -H "Content-Type: application/json" \
  -d @examples/minimal-brief.json \
  -w "HTTP %{http_code}  time=%{time_total}s\n" -o /tmp/dkr-response.json

echo "--- diff ---"
jq '.requestId, .totalTimeMs, (.creatives | length)' /tmp/dev-response.json
jq '.requestId, .totalTimeMs, (.creatives | length)' /tmp/dkr-response.json
```

On a warm Tier 1 DALL-E account you should see both complete in ~25-30s with identical shape (1 creative, 0 errors). The only differences should be `requestId` (distinct UUIDs) and `totalTimeMs` (a few hundred ms apart).

### Parallel generate (both at once)

```bash
# fires both in parallel, prints each timing as it returns
( curl -s -X POST http://localhost:3000/api/generate \
    -H "Content-Type: application/json" \
    -d @examples/minimal-brief.json \
    -w "DEV  HTTP %{http_code}  time=%{time_total}s\n" -o /dev/null ) &
( curl -s -X POST http://localhost:3001/api/generate \
    -H "Content-Type: application/json" \
    -d @examples/minimal-brief.json \
    -w "DKR  HTTP %{http_code}  time=%{time_total}s\n" -o /dev/null ) &
wait
```

Note: two parallel DALL-E calls against a Tier 1 key share the same 5-req/min bucket. You may see one retry where a sequential run wouldn't.

---

## 7. Inspect what landed on disk

### Dev server — `./output/`
```bash
ls -la output/diagnostic-test/
cat output/diagnostic-test/manifest.json | jq .
```

### Docker container — named volume
The container's `/app/output` is a Docker-managed volume, not a bind mount. You can browse it either by exec-ing into the container or by copying files out:

```bash
# Exec in and look around
docker compose exec adspark ls -la /app/output/diagnostic-test/
docker compose exec adspark cat /app/output/diagnostic-test/manifest.json

# Copy the whole directory out to the host for inspection
docker cp adspark:/app/output ./output-from-container
```

---

## 8. Graceful shutdown test — watch the drain

This demonstrates the `stop_grace_period: 150s` + `/api/healthz → 503` behavior. Fire a long-running generate at the container and IMMEDIATELY send it SIGTERM via `docker compose stop`:

```bash
# Terminal A — fire a 6-image brief against :3001
curl -s -X POST http://localhost:3001/api/generate \
  -H "Content-Type: application/json" \
  -d @examples/campaigns/winter-streetwear-drop/brief.json \
  -w "\nHTTP %{http_code}  time=%{time_total}s\n" &

# Terminal B — 2 seconds later, start the shutdown
sleep 2 && docker compose stop adspark

# Terminal C — watch healthz flip to 503
while true; do
  curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/api/healthz
  sleep 1
done
```

Expected sequence:
1. `docker compose stop` sends SIGTERM to PID 1 (tini), which forwards to Node
2. `instrumentation.ts` flips the shutdown flag
3. `/api/healthz` starts returning **503** (the watching loop in Terminal C shows it)
4. The in-flight generate in Terminal A keeps running — Next.js does NOT close the HTTP listener yet
5. Within `PIPELINE_BUDGET_MS` (120s) OR when the generate finishes naturally, the response flushes
6. `stop_grace_period: 150s` gives Node enough room to flush the response and exit cleanly
7. Only after that does Docker send SIGKILL

If you want the container back up:
```bash
docker compose start adspark
```

---

## 9. Teardown

```bash
docker compose down                    # stop + remove container, keep volume
docker compose down -v                 # also remove the named volume (wipes container output)
docker image rm adspark:latest         # delete the built image (~300MB)
```

---

## Appendix — one-screen dashboard using `watch`

If you have `watch` installed (it's on macOS/Linux by default; on Windows, install it from Chocolatey or use Git Bash's `watch.sh`), you can get a full live dashboard in one terminal:

```bash
watch -n 2 '
echo "=== dev :3000 ==="
curl -sf http://localhost:3000/api/healthz | jq -c "{ok, shuttingDown, v: .version}"
echo "=== dkr :3001 ==="
curl -sf http://localhost:3001/api/healthz | jq -c "{ok, shuttingDown, v: .version}"
echo
echo "=== compose ps ==="
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
'
```

This gives you a live 5-line summary of both instances plus the container state, refreshing every 2 seconds.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `docker ps` errors with daemon not running | Docker Desktop isn't started | Launch Docker Desktop; wait for whale icon to stop animating |
| Port 3001 is already in use | Leftover process holding it | `netstat -ano \| grep ":3001 "` → `taskkill //PID <PID> //F` |
| Build fails at `COPY --from=builder /app/public ./public` with *"not found"* | Project has no `public/` directory but Dockerfile expects one | Create `public/.gitkeep` (already fixed in this repo). The file is committed so the directory always exists for the COPY step. |
| Container stays `unhealthy` forever but external `curl :3001/api/healthz` returns 200 | Next.js standalone binds to one specific interface (eth0's container IP), NOT loopback. The compose `HEALTHCHECK` probes `http://localhost:3000` from inside the container and fails because nothing listens on 127.0.0.1. | Set `ENV HOSTNAME=0.0.0.0` in the `runner` stage of the Dockerfile (already fixed). Verify with `docker compose exec adspark node -e "fetch('http://localhost:3000/api/healthz').then(r=>console.log(r.status))"` — should print `200`. |
| `docker compose exec adspark ls /app/...` fails with *"C:/Program Files/Dev/Git/Git/app/... not found"* | Git Bash on Windows auto-translates paths that look like Unix paths | Prefix the command with `MSYS_NO_PATHCONV=1` OR use double-slash: `ls //app/output/...` |
| `jq: command not found` in Git Bash | jq isn't installed | Install via Chocolatey (`choco install jq`) or skip — raw JSON output is single-line and readable without it |
| Container `Up` but healthcheck says `starting` | In the 30s grace window | Wait; if it doesn't flip to `healthy` within 60s, `docker logs adspark` |
| Container `unhealthy` immediately | `OPENAI_API_KEY` missing/wrong in `.env.docker` | Re-check the env file; `docker compose logs adspark \| grep MISSING_CONFIGURATION` |
| Dev server logs look blank while Docker logs stream | Your `npm run dev` terminal is where dev-server logs go | Look at the terminal where you ran `npm run dev`, or start it with `npm run dev 2>&1 \| tee dev.log` and tail `dev.log` |
| Generate on :3001 fails with 500 | Container can't reach OpenAI | `docker compose exec adspark wget -qO- https://api.openai.com/v1/models` — should return 401 (auth error) proving network is fine |
| First build is super slow (>5 min) | No BuildKit cache / slow npm registry | Normal on first build. Second build should be <30s if you didn't change `package-lock.json` |

---

## Commands you'll use most often (the TL;DR)

```bash
# Setup once
cp .env.docker.example .env.docker && vi .env.docker
docker compose build

# Start both side-by-side
npm run dev &                          # dev on :3000 (or use a separate terminal)
HOST_PORT=3001 docker compose up -d    # container on :3001

# Verify both healthy
curl -s localhost:3000/api/healthz | jq .
curl -s localhost:3001/api/healthz | jq .

# Test generate against each
curl -X POST localhost:3000/api/generate -H "Content-Type: application/json" -d @examples/minimal-brief.json
curl -X POST localhost:3001/api/generate -H "Content-Type: application/json" -d @examples/minimal-brief.json

# Monitor logs
docker compose logs -f adspark         # container events
# (dev server logs are in the terminal where you ran npm run dev)

# Teardown
docker compose down                    # stop container, keep volume
```
