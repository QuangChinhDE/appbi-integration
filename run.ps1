<#
.SYNOPSIS
  Development runner for the AppBI Workflow Automation Platform.

.DESCRIPTION
  Starts the four processes the product needs and tells you where they are:

    postgres   docker compose service, port 5433
    engine     the n8n runtime, loopback only (guardrail 15)
    api        the product API / BFF
    worker     dispatch, schedule tick, reconciliation
    frontend   Next.js

  It is deliberately not `docker compose up`: on a laptop the API and the
  engine restart far faster outside a container, and the engine's node
  dependencies are the slowest thing in the repo to rebuild.

.EXAMPLE
  .\run.ps1 setup          # one-time: venv, npm installs, database, seed data
  .\run.ps1 up             # start everything
  .\run.ps1 up -ApiPort 8001
  .\run.ps1 down           # stop the processes this script started
  .\run.ps1 test           # engine contract suite + backend unit tests
  .\run.ps1 smoke          # end-to-end walk through the product API
  .\run.ps1 e2e            # Playwright: the same journeys through a browser
  .\run.ps1 e2e -Destructive   # ...including a clean install from an empty DB
  .\run.ps1 doctor         # is this configuration safe to deploy
  .\run.ps1 drift          # does the live schema match the models
  .\run.ps1 backup         # dump, with a manifest, and verify it restores
  .\run.ps1 status
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('setup', 'up', 'down', 'status', 'test', 'smoke', 'e2e', 'doctor',
                 'drift', 'backup', 'provision', 'migrate', 'logs')]
    [string]$Command = 'up',

    [int]$ApiPort = 8000,
    [int]$EnginePort = 8099,
    [int]$FrontendPort = 3000,
    [string]$Service = '',
    [string]$EnvFile = '.env',
    # The clean-install test deletes the data volume, so it is opt-in.
    [switch]$Destructive,
    # Everything after `--` goes to the underlying tool.
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$RunDir = Join-Path $Root '.run'
$LogDir = Join-Path $RunDir 'logs'
$Venv = Join-Path $Root '.venv'
$Python = Join-Path $Venv 'Scripts\python.exe'

function Write-Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Write-Ok($message) { Write-Host "    $message" -ForegroundColor Green }
function Write-Warn($message) { Write-Host "    $message" -ForegroundColor Yellow }

function Ensure-Dirs {
    New-Item -ItemType Directory -Force -Path $RunDir, $LogDir | Out-Null
}

function Test-Port([int]$Port) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $listener
}

function Ensure-Env {
    $envFile = Join-Path $Root '.env'
    if (Test-Path $envFile) { return }

    Write-Step 'Creating .env with generated keys'
    Copy-Item (Join-Path $Root '.env.example') $envFile

    # Generated here rather than shipped: a key committed to an example file is
    # a key every deployment shares.
    $key = & $Python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
    $jwt = & $Python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(36)).decode())"
    $token = & $Python -c "import secrets;print(secrets.token_urlsafe(24))"

    $content = Get-Content $envFile -Raw
    $content = $content -replace 'SECRET_ENCRYPTION_KEY=', "SECRET_ENCRYPTION_KEY=$key"
    $content = $content -replace 'JWT_SECRET=.*', "JWT_SECRET=$jwt"
    $content = $content -replace 'ENGINE_INTERNAL_TOKEN=.*', "ENGINE_INTERNAL_TOKEN=$token"
    Set-Content -Path $envFile -Value $content -Encoding utf8
    Write-Ok '.env written (keys generated locally, never committed)'
}

function Get-EnvValue([string]$Name) {
    $envFile = Join-Path $Root '.env'
    if (-not (Test-Path $envFile)) { return $null }
    foreach ($line in Get-Content $envFile) {
        if ($line -match "^\s*$Name\s*=\s*(.*)$") { return $Matches[1].Trim() }
    }
    return $null
}

function Invoke-Setup {
    Ensure-Dirs

    Write-Step 'Python environment'
    if (-not (Test-Path $Python)) { python -m venv $Venv }
    & $Python -m pip install --quiet --upgrade pip
    & $Python -m pip install --quiet -r (Join-Path $Root 'backend\requirements.txt') `
                                     -r (Join-Path $Root 'backend\requirements-dev.txt')
    Write-Ok 'backend dependencies installed'

    Ensure-Env

    Write-Step 'Engine dependencies (the pinned n8n package set -- this is the slow one)'
    Push-Location (Join-Path $Root 'workflow-engine')
    try { npm install --no-audit --no-fund } finally { Pop-Location }
    Write-Ok 'engine dependencies installed'

    Write-Step 'Frontend dependencies'
    Push-Location (Join-Path $Root 'frontend')
    try { npm install --no-audit --no-fund } finally { Pop-Location }
    Write-Ok 'frontend dependencies installed'

    Write-Step 'Database'
    docker compose up -d postgres | Out-Null
    for ($i = 0; $i -lt 40; $i++) {
        $health = docker inspect --format '{{.State.Health.Status}}' appbi-workflow-postgres-1 2>$null
        if ($health -eq 'healthy') { break }
        Start-Sleep -Milliseconds 500
    }
    Write-Ok 'postgres is up on 5433'

    Invoke-Migrate

    Write-Step 'Seeding the node catalogue and the first account'
    Push-Location (Join-Path $Root 'backend')
    try { & $Python -m app.bootstrap } finally { Pop-Location }

    Write-Host ''
    Write-Ok 'Setup complete. Start everything with:  .\run.ps1 up'
}

function Invoke-Migrate {
    Write-Step 'Applying migrations'
    Push-Location (Join-Path $Root 'backend')
    try {
        & $Python -m alembic upgrade head
        Write-Ok 'schema is at head'
    } finally { Pop-Location }
}

function Start-Background($Name, $WorkDir, $File, $Arguments, $EnvOverrides) {
    Ensure-Dirs
    $log = Join-Path $LogDir "$Name.log"
    $pidFile = Join-Path $RunDir "$Name.pid"

    foreach ($pair in $EnvOverrides.GetEnumerator()) {
        Set-Item -Path "Env:$($pair.Key)" -Value $pair.Value
    }

    $process = Start-Process -FilePath $File -ArgumentList $Arguments `
        -WorkingDirectory $WorkDir -RedirectStandardOutput $log `
        -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden
    Set-Content -Path $pidFile -Value $process.Id
    Write-Ok "$Name started (pid $($process.Id)) -> $log"
}

function Invoke-Up {
    Ensure-Dirs
    if (-not (Test-Path $Python)) {
        Write-Warn 'No virtual environment yet. Run:  .\run.ps1 setup'
        return
    }

    Write-Step 'Database'
    docker compose up -d postgres | Out-Null
    Write-Ok 'postgres is up on 5433'

    $token = Get-EnvValue 'ENGINE_INTERNAL_TOKEN'
    if (-not $token) { $token = 'dev-engine-token' }

    Write-Step "Engine (127.0.0.1:$EnginePort -- internal only)"
    if (Test-Port $EnginePort) {
        Write-Warn "port $EnginePort already in use; assuming the engine is already running"
    } else {
        Start-Background 'engine' (Join-Path $Root 'workflow-engine') 'npx.cmd' `
            @('tsx', 'src/server.ts') `
            @{ ENGINE_PORT = "$EnginePort"; ENGINE_INTERNAL_TOKEN = $token }
    }

    Write-Step "API (127.0.0.1:$ApiPort)"
    if (Test-Port $ApiPort) {
        Write-Warn "port $ApiPort already in use; pick another with -ApiPort"
    } else {
        Start-Background 'api' (Join-Path $Root 'backend') $Python `
            @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$ApiPort", '--reload') `
            @{ ENGINE_BASE_URL = "http://127.0.0.1:$EnginePort"; PUBLIC_BASE_URL = "http://localhost:$ApiPort" }
    }

    Write-Step 'Worker'
    Start-Background 'worker' (Join-Path $Root 'backend') $Python @('-m', 'app.worker') `
        @{ ENGINE_BASE_URL = "http://127.0.0.1:$EnginePort" }

    Write-Step "Frontend (127.0.0.1:$FrontendPort)"
    if (Test-Port $FrontendPort) {
        Write-Warn "port $FrontendPort already in use; pick another with -FrontendPort"
    } else {
        Start-Background 'frontend' (Join-Path $Root 'frontend') 'npx.cmd' `
            @('next', 'dev', '-p', "$FrontendPort") `
            @{ API_PROXY_TARGET = "http://127.0.0.1:$ApiPort" }
    }

    Write-Host ''
    Write-Host "  app       http://localhost:$FrontendPort" -ForegroundColor White
    Write-Host "  api docs  http://localhost:$ApiPort/docs" -ForegroundColor White
    Write-Host "  metrics   http://localhost:$ApiPort/metrics" -ForegroundColor Gray
    Write-Host "  logs      $LogDir" -ForegroundColor Gray
    Write-Host ''
    Write-Host '  Stop with:  .\run.ps1 down' -ForegroundColor Gray
}

function Invoke-Down {
    Write-Step 'Stopping processes'
    if (Test-Path $RunDir) {
        Get-ChildItem $RunDir -Filter '*.pid' | ForEach-Object {
            $processId = Get-Content $_.FullName
            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop
                Write-Ok "$($_.BaseName) stopped"
            } catch {
                Write-Warn "$($_.BaseName) was not running"
            }
            Remove-Item $_.FullName -Force
        }
    }
    Write-Warn 'postgres left running (docker compose stop postgres to stop it)'
}

function Invoke-Status {
    Write-Step 'Ports'
    foreach ($entry in @(
        @{ Name = 'postgres'; Port = 5433 },
        @{ Name = 'engine';   Port = $EnginePort },
        @{ Name = 'api';      Port = $ApiPort },
        @{ Name = 'frontend'; Port = $FrontendPort }
    )) {
        $state = if (Test-Port $entry.Port) { 'listening' } else { 'down' }
        $colour = if ($state -eq 'listening') { 'Green' } else { 'DarkGray' }
        Write-Host ("    {0,-10} {1,-6} {2}" -f $entry.Name, $entry.Port, $state) -ForegroundColor $colour
    }

    Write-Step 'Readiness'
    try {
        $ready = Invoke-RestMethod "http://127.0.0.1:$ApiPort/readyz?deep=1" -TimeoutSec 5
        Write-Host "    ready: $($ready.ready)  engine: $($ready.checks.engine.status)" -ForegroundColor White
    } catch {
        Write-Warn 'API is not answering'
    }
}

function Invoke-Test {
    Write-Step 'Engine contract suite (real pinned n8n runtime)'
    Push-Location (Join-Path $Root 'workflow-engine')
    try { npm test } finally { Pop-Location }

    Write-Step 'Backend unit tests'
    Push-Location (Join-Path $Root 'backend')
    try { & $Python -m pytest -q } finally { Pop-Location }

    Write-Step 'Frontend component tests'
    Push-Location (Join-Path $Root 'frontend')
    try { npm test } finally { Pop-Location }
}

function Invoke-Smoke {
    Write-Step "End-to-end smoke test against http://127.0.0.1:$ApiPort"
    & $Python (Join-Path $Root 'scripts\smoke.py') --base "http://127.0.0.1:$ApiPort"
}

function Invoke-E2E {
    # A browser test needs the whole stack and it drives the *frontend*, so the
    # port it targets is the frontend's -- the API it reaches is whatever the
    # frontend proxies to.
    $base = "http://127.0.0.1:$FrontendPort"
    Write-Step "Playwright against $base"

    Push-Location (Join-Path $Root 'e2e')
    try {
        if (-not (Test-Path 'node_modules')) {
            Write-Step 'Installing Playwright and its browser'
            npm install
            npx playwright install chromium
        }
        $env:E2E_BASE_URL = $base
        if ($Destructive) {
            # Tears the stack down to an empty volume and brings it back, then
            # runs everything else against the fresh install.
            Write-Warn 'Destructive: this deletes the database volume.'
            $env:E2E_DESTRUCTIVE = '1'
        }
        npx playwright test @Rest
    } finally {
        $env:E2E_DESTRUCTIVE = $null
        Pop-Location
    }
}

function Invoke-Doctor {
    Write-Step "Configuration check: $EnvFile"
    & $Python (Join-Path $Root 'scripts\doctor.py') --env-file $EnvFile @Rest
}

function Invoke-Drift {
    Write-Step 'Schema drift'
    & $Python (Join-Path $Root 'scripts\schema_drift.py') @Rest
}

function Invoke-Backup {
    # Routed through the postgres container: the client tools are not
    # necessarily installed on a developer's machine, and a backup script that
    # only runs where they are is one nobody has tested.
    Write-Step 'Backup (via the postgres container)'
    $env:DATABASE_URL = 'postgresql+asyncpg://appbi:appbi@postgres:5432/appbi_workflow'
    & $Python (Join-Path $Root 'scripts\backup.py') --via-docker postgres `
        --out (Join-Path $Root 'backups') @Rest
}

function Invoke-Provision {
    Push-Location (Join-Path $Root 'backend')
    try { & $Python -m app.provision @Rest } finally { Pop-Location }
}

function Invoke-Logs {
    if (-not $Service) {
        Get-ChildItem $LogDir -Filter '*.log' | ForEach-Object { Write-Host $_.Name }
        return
    }
    Get-Content (Join-Path $LogDir "$Service.log") -Tail 80 -Wait
}

switch ($Command) {
    'setup'   { Invoke-Setup }
    'up'      { Invoke-Up }
    'down'    { Invoke-Down }
    'status'  { Invoke-Status }
    'test'    { Invoke-Test }
    'smoke'   { Invoke-Smoke }
    'e2e'     { Invoke-E2E }
    'doctor'  { Invoke-Doctor }
    'drift'   { Invoke-Drift }
    'backup'  { Invoke-Backup }
    'provision' { Invoke-Provision }
    'migrate' { Invoke-Migrate }
    'logs'    { Invoke-Logs }
}
