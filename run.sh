#!/usr/bin/env bash
# Development runner (Linux/macOS). The PowerShell twin is run.ps1.
#
#   ./run.sh setup    one-time: venv, npm installs, database, seed data
#   ./run.sh up       start engine, api, worker, frontend
#   ./run.sh down     stop what this script started
#   ./run.sh test     engine contract suite + backend unit tests
#   ./run.sh smoke    end-to-end walk through the product API
#   ./run.sh e2e      Playwright: the same journeys through a browser
#   ./run.sh e2e -d   ...including a clean install from an empty database
#   ./run.sh doctor [file]   is this configuration safe to deploy
#   ./run.sh drift    does the live schema match the models
#   ./run.sh backup   dump, with a manifest, and verify it restores
#   ./run.sh provision ...   create and administer tenants
#   ./run.sh status
#
# Deliberately not `docker compose up`: on a development machine the API and
# engine restart far faster outside a container, and the engine's dependency
# tree is the slowest thing in the repo to rebuild.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/.run"
LOG_DIR="$RUN_DIR/logs"
VENV="$ROOT/.venv"
# A venv created on Windows puts the interpreter in `Scripts/`, and Git Bash is
# a real environment people run this from. Detected rather than assumed: the
# alternative is every command in this script failing with "No such file".
if [ -x "$VENV/bin/python" ]; then
  PYTHON="$VENV/bin/python"
else
  PYTHON="$VENV/Scripts/python.exe"
fi

API_PORT="${API_PORT:-8000}"
ENGINE_PORT="${ENGINE_PORT:-8099}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
ok() { printf '\033[32m    %s\033[0m\n' "$1"; }
warn() { printf '\033[33m    %s\033[0m\n' "$1"; }

ensure_dirs() { mkdir -p "$LOG_DIR"; }

port_busy() {
  if command -v lsof > /dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN > /dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") > /dev/null 2>&1
  fi
}

env_value() {
  local name="$1"
  [ -f "$ROOT/.env" ] || return 0
  grep -E "^\s*${name}\s*=" "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d ' \r'
}

ensure_env() {
  [ -f "$ROOT/.env" ] && return 0
  step 'Creating .env with generated keys'
  cp "$ROOT/.env.example" "$ROOT/.env"
  # Generated locally: a key committed to an example file is a key every
  # deployment would share.
  local key jwt token
  key=$("$PYTHON" -c 'import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())')
  jwt=$("$PYTHON" -c 'import base64,os;print(base64.urlsafe_b64encode(os.urandom(36)).decode())')
  token=$("$PYTHON" -c 'import secrets;print(secrets.token_urlsafe(24))')
  "$PYTHON" - "$ROOT/.env" "$key" "$jwt" "$token" <<'PY'
import re, sys
path, key, jwt, token = sys.argv[1:5]
text = open(path, encoding='utf-8').read()
text = text.replace('SECRET_ENCRYPTION_KEY=\n', f'SECRET_ENCRYPTION_KEY={key}\n')
text = re.sub(r'JWT_SECRET=.*', f'JWT_SECRET={jwt}', text, count=1)
text = re.sub(r'ENGINE_INTERNAL_TOKEN=.*', f'ENGINE_INTERNAL_TOKEN={token}', text, count=1)
open(path, 'w', encoding='utf-8').write(text)
PY
  ok '.env written (keys generated locally, never committed)'
}

wait_for_postgres() {
  for _ in $(seq 1 40); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' appbi-workflow-postgres-1 2>/dev/null)" = "healthy" ]; then
      return 0
    fi
    sleep 0.5
  done
  warn 'postgres did not report healthy in time'
}

cmd_setup() {
  ensure_dirs

  step 'Python environment'
  [ -x "$PYTHON" ] || python3 -m venv "$VENV"
  "$PYTHON" -m pip install --quiet --upgrade pip
  "$PYTHON" -m pip install --quiet -r "$ROOT/backend/requirements.txt" \
                                   -r "$ROOT/backend/requirements-dev.txt"
  ok 'backend dependencies installed'

  ensure_env

  step 'Engine dependencies (the pinned n8n package set -- this is the slow one)'
  (cd "$ROOT/workflow-engine" && npm install --no-audit --no-fund)
  ok 'engine dependencies installed'

  step 'Frontend dependencies'
  (cd "$ROOT/frontend" && npm install --no-audit --no-fund)
  ok 'frontend dependencies installed'

  step 'Database'
  docker compose up -d postgres > /dev/null
  wait_for_postgres
  ok 'postgres is up on 5433'

  cmd_migrate

  step 'Seeding the node catalogue and the first account'
  (cd "$ROOT/backend" && "$PYTHON" -m app.bootstrap)

  echo
  ok 'Setup complete. Start everything with:  ./run.sh up'
}

cmd_migrate() {
  step 'Applying migrations'
  (cd "$ROOT/backend" && "$PYTHON" -m alembic upgrade head)
  ok 'schema is at head'
}

start_bg() {
  local name="$1"; shift
  local workdir="$1"; shift
  ensure_dirs
  ( cd "$workdir" && "$@" > "$LOG_DIR/$name.log" 2>&1 & echo $! > "$RUN_DIR/$name.pid" )
  ok "$name started (pid $(cat "$RUN_DIR/$name.pid")) -> $LOG_DIR/$name.log"
}

cmd_up() {
  ensure_dirs
  if [ ! -x "$PYTHON" ]; then
    warn 'No virtual environment yet. Run:  ./run.sh setup'
    return 1
  fi

  step 'Database'
  docker compose up -d postgres > /dev/null
  ok 'postgres is up on 5433'

  local token
  token="$(env_value ENGINE_INTERNAL_TOKEN)"
  token="${token:-dev-engine-token}"

  step "Engine (127.0.0.1:$ENGINE_PORT -- internal only)"
  if port_busy "$ENGINE_PORT"; then
    warn "port $ENGINE_PORT already in use; assuming the engine is already running"
  else
    ENGINE_PORT="$ENGINE_PORT" ENGINE_INTERNAL_TOKEN="$token" \
      start_bg engine "$ROOT/workflow-engine" npx tsx src/server.ts
  fi

  step "API (127.0.0.1:$API_PORT)"
  if port_busy "$API_PORT"; then
    warn "port $API_PORT already in use; set API_PORT to something else"
  else
    ENGINE_BASE_URL="http://127.0.0.1:$ENGINE_PORT" \
    PUBLIC_BASE_URL="http://localhost:$API_PORT" \
      start_bg api "$ROOT/backend" "$PYTHON" -m uvicorn app.main:app \
        --host 127.0.0.1 --port "$API_PORT" --reload
  fi

  step 'Worker'
  ENGINE_BASE_URL="http://127.0.0.1:$ENGINE_PORT" \
    start_bg worker "$ROOT/backend" "$PYTHON" -m app.worker

  step "Frontend (127.0.0.1:$FRONTEND_PORT)"
  if port_busy "$FRONTEND_PORT"; then
    warn "port $FRONTEND_PORT already in use; set FRONTEND_PORT to something else"
  else
    API_PROXY_TARGET="http://127.0.0.1:$API_PORT" \
      start_bg frontend "$ROOT/frontend" npx next dev -p "$FRONTEND_PORT"
  fi

  echo
  echo "  app       http://localhost:$FRONTEND_PORT"
  echo "  api docs  http://localhost:$API_PORT/docs"
  echo "  metrics   http://localhost:$API_PORT/metrics"
  echo "  logs      $LOG_DIR"
  echo
  echo '  Stop with:  ./run.sh down'
}

cmd_down() {
  step 'Stopping processes'
  for pidfile in "$RUN_DIR"/*.pid; do
    [ -f "$pidfile" ] || continue
    local name
    name="$(basename "$pidfile" .pid)"
    if kill "$(cat "$pidfile")" 2> /dev/null; then
      ok "$name stopped"
    else
      warn "$name was not running"
    fi
    rm -f "$pidfile"
  done
  warn 'postgres left running (docker compose stop postgres to stop it)'
}

cmd_status() {
  step 'Ports'
  for entry in "postgres:5433" "engine:$ENGINE_PORT" "api:$API_PORT" "frontend:$FRONTEND_PORT"; do
    local name="${entry%%:*}" port="${entry##*:}"
    if port_busy "$port"; then
      printf '    %-10s %-6s listening\n' "$name" "$port"
    else
      printf '    %-10s %-6s down\n' "$name" "$port"
    fi
  done

  step 'Readiness'
  curl -fsS "http://127.0.0.1:$API_PORT/readyz?deep=1" 2> /dev/null \
    | "$PYTHON" -c 'import json,sys; r=json.load(sys.stdin); print(f"    ready: {r[\"ready\"]}  engine: {r[\"checks\"][\"engine\"][\"status\"]}")' \
    || warn 'API is not answering'
}

cmd_test() {
  step 'Engine contract suite (real pinned n8n runtime)'
  (cd "$ROOT/workflow-engine" && npm test)

  step 'Backend unit tests'
  (cd "$ROOT/backend" && "$PYTHON" -m pytest -q)

  step 'Frontend component tests'
  (cd "$ROOT/frontend" && npm test)
}

cmd_e2e() {
  # A browser test needs the whole stack and it drives the *frontend*, so the
  # port it targets is the frontend's -- the API it reaches is whatever the
  # frontend proxies to.
  local base="http://127.0.0.1:$FRONTEND_PORT"
  step "Playwright against $base"
  if [ ! -d "$ROOT/e2e/node_modules" ]; then
    step 'Installing Playwright and its browser'
    (cd "$ROOT/e2e" && npm install --no-audit --no-fund && npx playwright install chromium)
  fi
  local destructive=""
  if [ "${1:-}" = "-d" ] || [ "${1:-}" = "--destructive" ]; then
    # Tears the stack down to an empty volume and brings it back, then runs
    # everything else against the fresh install.
    echo "    destructive: this deletes the database volume" >&2
    destructive=1
    shift
  fi
  (cd "$ROOT/e2e" \
    && E2E_BASE_URL="$base" E2E_DESTRUCTIVE="$destructive" \
       npx playwright test "$@")
}

cmd_doctor() {
  local file="${1:-.env}"
  step "Configuration check: $file"
  "$PYTHON" "$ROOT/scripts/doctor.py" --env-file "$file"
}

cmd_drift() {
  step 'Schema drift'
  # `schema_drift.py` reads DATABASE_URL from the environment. The application
  # would find it in `.env` through pydantic-settings, but a plain script does
  # not, so it is exported here rather than left to fail with "not set".
  if [ -f "$ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT/.env"
    set +a
  fi
  "$PYTHON" "$ROOT/scripts/schema_drift.py" "$@"
}

cmd_backup() {
  # Routed through the postgres container: the client tools are not necessarily
  # installed on a developer's machine, and a backup script that only runs
  # where they are is one nobody has tested.
  step 'Backup (via the postgres container)'
  DATABASE_URL='postgresql+asyncpg://appbi:appbi@postgres:5432/appbi_workflow' \
    "$PYTHON" "$ROOT/scripts/backup.py" --via-docker postgres \
    --out "$ROOT/backups" "$@"
}

cmd_provision() {
  (cd "$ROOT/backend" && "$PYTHON" -m app.provision "$@")
}

cmd_smoke() {
  step "End-to-end smoke test against http://127.0.0.1:$API_PORT"
  "$PYTHON" "$ROOT/scripts/smoke.py" --base "http://127.0.0.1:$API_PORT"
}

case "${1:-up}" in
  setup)   cmd_setup ;;
  up)      cmd_up ;;
  down)    cmd_down ;;
  status)  cmd_status ;;
  test)    cmd_test ;;
  smoke)   cmd_smoke ;;
  e2e)     shift; cmd_e2e "$@" ;;
  doctor)  shift; cmd_doctor "$@" ;;
  drift)   shift; cmd_drift "$@" ;;
  backup)  shift; cmd_backup "$@" ;;
  provision) shift; cmd_provision "$@" ;;
  migrate) cmd_migrate ;;
  *)       echo "usage: $0 {setup|up|down|status|test|smoke|e2e|doctor|drift|backup|provision|migrate}" >&2; exit 2 ;;
esac
