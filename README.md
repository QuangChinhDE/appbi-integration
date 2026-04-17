# AppBI Integration

AppBI Integration is the operational workspace for connecting business apps, preparing reusable storage targets, and building backup flows on top of those connections. The repository is organized as a small monorepo with a FastAPI backend, a React + Vite frontend, shared packages, and domain modules such as Apps, Backup, Identity, and Automation.

The current direction of the product is:

- connect an app once in Apps
- reuse that connection later in Backup or other modules
- manage workspace access with role-based permissions
- support both Google OAuth and service-account based Google storage flows

## What the project includes

### Apps workspace

- Reusable source app connections for Request, Service, Workflow, and WeWork
- Reusable Google Drive and Google Sheets storage profiles
- Search-first UI for finding and creating app connections

### Backup workspace

- Draft-first backup flow creation
- Responsive multi-step wizard for source, scope, destination, and review
- Reusable saved source and destination pickers
- Flow detail, publish, run, stop, and delete actions

### Identity and settings

- Password-based login
- Bootstrap admin account on first startup
- Per-module permissions for `backup`, `apps`, `automation`, and `settings`
- User and permission management endpoints/UI under Settings

### Automation

- Standardized module shell is in place
- Full automation behavior is not implemented yet

## Tech stack

- Backend: FastAPI, SQLAlchemy, asyncpg, PostgreSQL
- Frontend: React 18, React Router, Zustand, Vite, Tailwind CSS
- Auth/security: JWT, Passlib, bcrypt, per-module RBAC
- Google integration: Google OAuth, Google Drive, Google Sheets, optional shared service account
- Runtime: Docker Compose for both production-style and hot-reload development stacks

## Repository layout

```text
appbi-integration/
├── apps/
│   ├── api/                     # FastAPI application entrypoint and container image
│   └── web/                     # Vite frontend application
├── modules/
│   ├── apps/                    # Unified app connection/storage routes and pages
│   ├── backup/                  # Backup flow backend + frontend wizard
│   ├── identity/                # Login, permissions, user management
│   ├── sources/                 # Source connection domain implementation
│   ├── destinations/            # Storage profile domain implementation
│   └── automation/              # Automation module shell
├── packages/
│   ├── auth/                    # JWT, password, permission helpers
│   ├── database/                # SQLAlchemy base/models/init
│   └── ui/                      # Shared frontend UI shells/components
├── docker-compose.yml           # Production-style stack
├── docker-compose.dev.yml       # Development stack with hot reload
└── .env.example                 # Runtime environment template
```

## Quick start with Docker

Docker is the recommended way to run the project locally because it aligns backend, frontend, and PostgreSQL with the repo defaults.

### 1. Create the environment file

```bash
cp .env.example .env
```

At minimum, update these values before sharing or deploying the stack:

- `POSTGRES_PASSWORD`
- `SECRET_KEY`
- `AUTH_JWT_SECRET`
- `AUTH_BOOTSTRAP_PASSWORD`

If you plan to use Google login or Google storage features, also set:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `VITE_GOOGLE_CLIENT_ID`

### 2. Start the production-style stack

```bash
docker compose up -d --build
```

### 3. Start the development stack with hot reload

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

### 4. Stop the stack

```bash
docker compose down
docker compose -f docker-compose.dev.yml down
```

## Default local URLs and ports

- Frontend: http://localhost:3002
- Backend API: http://localhost:8010
- PostgreSQL: localhost:5434

These ports intentionally differ from `appbi-ai` so both projects can run side-by-side on one machine.

## Default bootstrap admin

When `AUTH_BOOTSTRAP_ENABLED=true`, the backend creates an admin account on first startup if it does not already exist.

Default values from `.env.example`:

- Email: `admin@appbi.local`
- Password: `Admin123!`
- Name: `Platform Admin`

Change these before using the environment with teammates.

## Environment variables you will most likely touch

### Core runtime

- `FRONTEND_PORT`
- `BACKEND_PORT`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

### Auth and RBAC

- `SECRET_KEY`
- `AUTH_JWT_SECRET`
- `AUTH_BOOTSTRAP_ENABLED`
- `AUTH_BOOTSTRAP_EMAIL`
- `AUTH_BOOTSTRAP_PASSWORD`
- `AUTH_BOOTSTRAP_NAME`
- `AUTH_PASSWORD_LOGIN_ENABLED`
- `AUTH_GOOGLE_LOGIN_ENABLED`
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
- The frontend uses the unified `Apps` module paths: `/apps`, `/apps/connections`, and `/apps/storage`.
- Legacy source/destination concepts still exist at the domain layer, but the active UI now treats them as one Apps workspace.
- `docker-compose.yml` builds the web image with Vite auth flags, while `docker-compose.dev.yml` mounts the repo for hot reload.