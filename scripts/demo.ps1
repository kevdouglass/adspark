# AdSpark -- Loom demo script (native PowerShell)
# -----------------------------------------------------------------
# Usage (from project root):
#
#   .\scripts\demo.ps1 preflight     # verify environment (run BEFORE recording)
#   .\scripts\demo.ps1 healthz       # side-by-side health probes
#   .\scripts\demo.ps1 generate      # fire a test brief + show timing
#   .\scripts\demo.ps1 tail          # stream container structured logs
#   .\scripts\demo.ps1 teardown      # stop the container
#
# If you see "running scripts is disabled" from PowerShell's execution
# policy, run ONCE per PowerShell session:
#
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
#
# Target: Docker container on http://localhost:3001 (primary demo)
# Fallback: dev server on http://localhost:3000

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("preflight", "healthz", "generate", "tail", "teardown", "help")]
    [string]$Command = "preflight",

    [Parameter(Position = 1)]
    [string]$BriefPath = "examples/minimal-brief.json",

    [Parameter(Position = 2)]
    [string]$Target = "http://localhost:3001"
)

$ErrorActionPreference = "Stop"

# Resolve project root relative to this script's location
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

$DevUrl = "http://localhost:3000"
$DkrUrl = "http://localhost:3001"
$MinimalBrief = "examples/minimal-brief.json"
$CampaignBrief = "examples/campaigns/fall-coffee-launch/brief.json"

# -----------------------------------------------------------------
# Output helpers
# -----------------------------------------------------------------

function Write-Log   { Write-Host "[demo] $args" -ForegroundColor Blue }
function Write-Ok    { Write-Host "OK  " -ForegroundColor Green -NoNewline; Write-Host "$args" }
function Write-Warn  { Write-Host "WARN" -ForegroundColor Yellow -NoNewline; Write-Host " $args" }
function Write-Fail  { Write-Host "FAIL" -ForegroundColor Red -NoNewline; Write-Host " $args" }

# -----------------------------------------------------------------
# PREFLIGHT -- run ~60 seconds before starting your Loom
# -----------------------------------------------------------------

function Invoke-Preflight {
    Write-Log "Preflight - verifying demo environment"
    Write-Host ""

    # 1. Docker container healthy?
    Write-Log "Checking Docker container state..."
    $composeStatus = docker compose ps --format "{{.Status}}" 2>$null
    if (-not ($composeStatus -match "healthy")) {
        Write-Fail "Docker container is not healthy"
        Write-Log "Starting it now: HOST_PORT=3001 docker compose up -d"
        $env:HOST_PORT = "3001"
        docker compose up -d
        Write-Log "Waiting 30s for the healthcheck grace window..."
        Start-Sleep -Seconds 30
    }
    $status = docker compose ps --format "{{.Status}}" adspark 2>$null
    Write-Ok "Docker container: $status"

    # 2. Both endpoints responding?
    Write-Log "Probing healthz endpoints..."
    try {
        $null = Invoke-RestMethod -Uri "$DevUrl/api/healthz" -TimeoutSec 5 -ErrorAction Stop
        Write-Ok "DEV  $DevUrl  healthy"
    } catch {
        Write-Warn "DEV  $DevUrl  NOT RESPONDING (dev server not running - OK for Docker-only demo)"
    }

    try {
        $null = Invoke-RestMethod -Uri "$DkrUrl/api/healthz" -TimeoutSec 5 -ErrorAction Stop
        Write-Ok "DKR  $DkrUrl  healthy"
    } catch {
        Write-Fail "DKR  $DkrUrl  NOT RESPONDING - container is NOT serving traffic"
        exit 1
    }

    # 3. Example briefs on disk?
    foreach ($brief in @($MinimalBrief, $CampaignBrief)) {
        if (Test-Path $brief) {
            Write-Ok "brief found: $brief"
        } else {
            Write-Fail "brief missing: $brief"
            exit 1
        }
    }

    # 4. OpenAI key set in container?
    Write-Log "Verifying OPENAI_API_KEY is configured inside the container..."
    $keyCheck = docker compose exec -T adspark sh -c 'test -n "$OPENAI_API_KEY" && echo set || echo missing' 2>$null
    if ($keyCheck -match "set") {
        Write-Ok "OPENAI_API_KEY is set inside the container"
    } else {
        Write-Fail "OPENAI_API_KEY is NOT set - fix .env.docker before recording"
        exit 1
    }

    Write-Host ""
    Write-Log "Preflight complete. Demo target:"
    Write-Host "    Primary (container):   $DkrUrl" -ForegroundColor Cyan
    Write-Host "    Backup  (dev server):  $DevUrl" -ForegroundColor DarkGray
    Write-Host ""
    Write-Log "You are clear to hit record."
}

# -----------------------------------------------------------------
# HEALTHZ -- side-by-side probe, narrate during the Loom
# -----------------------------------------------------------------

function Invoke-Healthz {
    Write-Log "Side-by-side health probe"
    Write-Host ""

    foreach ($pair in @(
        @{ Label = "DEV"; Url = $DevUrl },
        @{ Label = "DKR"; Url = $DkrUrl }
    )) {
        Write-Host "=== $($pair.Label)  $($pair.Url) ===" -ForegroundColor Cyan
        try {
            $response = Invoke-RestMethod -Uri "$($pair.Url)/api/healthz" -TimeoutSec 5
            $response | ConvertTo-Json -Compress | Write-Host
        } catch {
            Write-Host "DOWN: $($_.Exception.Message)" -ForegroundColor Red
        }
        Write-Host ""
    }

    Write-Ok "Both instances return the same timeout-cascade contract - same codebase, two targets."
}

# -----------------------------------------------------------------
# GENERATE -- fire a test brief, print timing breakdown
# Narrate out loud during the Loom.
# -----------------------------------------------------------------

function Invoke-Generate {
    param(
        [string]$Brief = $MinimalBrief,
        [string]$TargetUrl = $DkrUrl
    )

    if (-not (Test-Path $Brief)) {
        Write-Fail "Brief not found: $Brief"
        return
    }

    Write-Log "Firing a generate against $TargetUrl"
    Write-Log "Brief: $Brief"
    Write-Host ""

    $body = Get-Content $Brief -Raw
    $start = Get-Date

    try {
        $response = Invoke-RestMethod `
            -Uri "$TargetUrl/api/generate" `
            -Method POST `
            -ContentType "application/json" `
            -Body $body `
            -TimeoutSec 180

        $elapsedMs = [math]::Round(((Get-Date) - $start).TotalMilliseconds)
        Write-Host "  HTTP 200" -ForegroundColor Green -NoNewline
        Write-Host "  time=$([math]::Round($elapsedMs / 1000, 2))s"
        Write-Host ""

        if ($response.code) {
            Write-Host "  ERROR:  $($response.code) - $($response.message)" -ForegroundColor Red
            Write-Host "  requestId: $($response.requestId)"
            return
        }

        Write-Host "  requestId:    $($response.requestId)"
        Write-Host "  campaignId:   $($response.campaignId)"
        Write-Host "  totalTimeMs:  $($response.totalTimeMs)ms"
        Write-Host "  creatives:    $($response.creatives.Count)"
        Write-Host "  errors:       $($response.errors.Count)"
        Write-Host ""

        $i = 1
        foreach ($c in $response.creatives) {
            Write-Host "  -- creative $i --" -ForegroundColor DarkGray
            Write-Host "    product:      $($c.productName)"
            Write-Host "    ratio:        $($c.aspectRatio)  ($($c.dimensions))"
            Write-Host "    dalle ms:     $($c.generationTimeMs)"
            Write-Host "    composite ms: $($c.compositingTimeMs)"
            Write-Host "    path:         $($c.creativePath)"
            $i++
        }

        Write-Host ""
        Write-Ok "Generate complete in $([math]::Round($elapsedMs / 1000))s wall time"

    } catch {
        $elapsedMs = [math]::Round(((Get-Date) - $start).TotalMilliseconds)
        Write-Host "  HTTP $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red -NoNewline
        Write-Host "  time=$([math]::Round($elapsedMs / 1000, 2))s"
        Write-Host ""

        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $errBody = $reader.ReadToEnd()
            $reader.Close()
            Write-Host "  Error body:" -ForegroundColor Red
            Write-Host "    $errBody" -ForegroundColor DarkRed
        } catch {
            Write-Host "  (no error body available)" -ForegroundColor DarkGray
        }
    }
}

# -----------------------------------------------------------------
# TAIL -- stream structured JSON events from the container
# Run in a SECOND terminal pane during the Loom (keep visible on screen)
# -----------------------------------------------------------------

function Invoke-Tail {
    Write-Log "Streaming container logs (Ctrl+C to stop)"
    Write-Log "One JSON event per line, every line carries a requestId."
    Write-Host ""
    docker compose logs -f adspark
}

# -----------------------------------------------------------------
# TEARDOWN
# -----------------------------------------------------------------

function Invoke-Teardown {
    Write-Log "Tearing down Docker container"
    docker compose down
    Write-Ok "Container stopped. Named volume 'adspark_adspark-output' preserved."
    Write-Log "To also remove the volume: docker compose down -v"
}

# -----------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------

switch ($Command) {
    "preflight" { Invoke-Preflight }
    "healthz"   { Invoke-Healthz }
    "generate"  { Invoke-Generate -Brief $BriefPath -TargetUrl $Target }
    "tail"      { Invoke-Tail }
    "teardown"  { Invoke-Teardown }
    "help"      {
        Write-Host "Usage: .\scripts\demo.ps1 [preflight|healthz|generate|tail|teardown]"
        Write-Host ""
        Write-Host "  preflight   Verify demo environment (run BEFORE recording)"
        Write-Host "  healthz     Probe both dev server and container /api/healthz"
        Write-Host "  generate    Fire a test brief, print timing breakdown"
        Write-Host "              Optional: .\scripts\demo.ps1 generate <brief.json> <http://url>"
        Write-Host "  tail        Stream structured JSON logs from the container"
        Write-Host "  teardown    Stop the container (keeps the output volume)"
    }
}
