# AppBI Integration

Monorepo for connecting business apps, managing credentials, running backup flows, and building data pipelines. Built with FastAPI + React/Vite + PostgreSQL.

## Modules

| Module | Description |
|---|---|
| **Apps** | Unified credential registry for 15 apps (source + Google destination) |
| **Connectors** | Stream-level connector framework with `BaseConnector` interface — 15 connectors (Request, Service, Workflow, WeWork, CRM, HRM, Table, Goal, Income, Meeting, Payroll, Timeoff, GDrive, GSheets, BigQuery) |
| **Backup** | Backup flows using `GenericConnectorExtractor` — reads connector streams → Excel → GDrive |
| **Pipeline** | Source-to-destination data sync with multi-binding model (bindings[] JSONB), scheduled runs |
| **Identity** | Auth (password + Google OAuth), per-module RBAC, user management |
| **Automation** | Module shell — disabled until Pipeline/Backup stabilize |

## Tech stack

- **Backend:** FastAPI, SQLAlchemy, asyncpg, PostgreSQL
- **Frontend:** React 18, React Router, Zustand, Vite, Tailwind CSS
- **Auth:** JWT, bcrypt, per-module RBAC (backup/apps/pipeline/automation/settings)
- **Google:** OAuth, Drive, Sheets, optional shared service account
- **Runtime:** Docker Compose

## Repository layout

```
apps/
  api/          # FastAPI entrypoint
  web/          # Vite frontend
  scheduler/    # Background job scheduler
  worker/       # Async task worker
modules/
  apps/         # Credential CRUD (backend + frontend)
  backup/       # Backup flows + generic extractor
  connectors/   # Connector registry, runtime, 15 app connectors
  pipeline/     # Pipeline CRUD, execution engine, wizard UI
  identity/     # Login, users, permissions
  automation/   # Module shell (disabled)
packages/
  auth/         # JWT, password, permission helpers
  database/     # SQLAlchemy models, migrations, init.sql
  ui/           # Shared hooks, components
  utils/        # Module registry, helpers
  logger/       # Logging utilities
```

## Quick start

```bash
cp .env.example .env        # then edit secrets
docker compose up -d --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3002 |
| Backend API | http://localhost:8010 |
| PostgreSQL | localhost:5434 |

Dev mode with hot reload:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

### Key `.env` variables

`POSTGRES_PASSWORD`, `SECRET_KEY`, `AUTH_JWT_SECRET`, `AUTH_BOOTSTRAP_PASSWORD`

For Google features: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `VITE_GOOGLE_CLIENT_ID`

## Status

> **Work in progress** — connector framework and pipeline module are initial code ideas, not yet fully tested for runtime correctness.

## Default bootstrap admin

When `AUTH_BOOTSTRAP_ENABLED=true`, the backend creates an admin account on first startup if it does not already exist.
The bootstrap user receives the preset from `AUTH_BOOTSTRAP_PRESET`, which defaults to `admin` and grants full access across every enabled module.

Default values from `.env.example`:

- Email: `admin@appbi.local`
- Password: `CHANGE_ME`
- Name: `Platform Admin`
- Preset: `admin`

Change these before using the environment with teammates.

## Environment variables you will most likely touch

### Core runtime

- `FRONTEND_PORT`
- `BACKEND_PORT`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

### Module feature flags

- `FEATURE_MODULE_BACKUP_ENABLED`
- `FEATURE_MODULE_APPS_ENABLED`
- `FEATURE_MODULE_PIPELINE_ENABLED`
- `FEATURE_MODULE_AUTOMATION_ENABLED`
- `FEATURE_MODULE_SETTINGS_ENABLED`

### Auth and RBAC

- `SECRET_KEY`
- `AUTH_BOOTSTRAP_ENABLED`
- `AUTH_BOOTSTRAP_PRESET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`
- `AUTH_PASSWORD_LOGIN_ENABLED`
- `AUTH_GOOGLE_ENABLED`
- `AUTH_GOOGLE_AUTO_CREATE_USERS`

### Frontend auth flags

- `VITE_AUTH_PASSWORD_ENABLED`
- `VITE_AUTH_GOOGLE_ENABLED`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_API_URL`

### Google integration

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GCP_SERVICE_ACCOUNT_CLIENT_EMAIL`

See `.env.example` for the full template and defaults.

## Local development without Docker

If you prefer to run services directly, match the container toolchain as closely as possible:

- Node.js 20
- Python 3.11
- PostgreSQL 15

### Frontend

Install dependencies from the repo root:

```bash
npm install
```

Run the frontend:

```bash
npm run web:dev
```

Or directly through the workspace package:

```bash
npm --workspace apps/web run dev
```

### Backend

Install Python dependencies:

```bash
pip install -r apps/api/requirements.txt
```

Run the API:

```bash
uvicorn apps.api.src.main:app --reload --host 0.0.0.0 --port 8010
```

### Database

Start only PostgreSQL through Docker if you do not want to run a local database manually:

```bash
docker compose up -d postgres
```

## Useful commands

### Docker

```bash
docker compose ps
docker compose logs -f frontend backend postgres
docker compose -f docker-compose.dev.yml logs -f frontend backend postgres
docker compose up -d --build backend
docker compose -f docker-compose.dev.yml up -d --build frontend
```

### Frontend

```bash
npm run web:build
npm --workspace apps/web run build
```

### Backend

```bash
uvicorn apps.api.src.main:app --reload --host 0.0.0.0 --port 8010
```

## Notes for contributors

- Root `.env.example` is the portable template. Root `.env` is machine-specific and should stay uncommitted.
- The backend creates database tables from current SQLAlchemy models on startup.
- The frontend exposes the Apps module at `/apps` (registry) and `/apps/:appId` (per-app credentials). The Apps module is role-neutral — it stores reusable credentials. The Backup module decides, per flow, which credential plays the source role and which plays the destination role.
- `docker-compose.yml` builds the web image with Vite auth flags, while `docker-compose.dev.yml` mounts the repo for hot reload.