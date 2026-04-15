# IntegrationHub

Modern web application for managing cloud application integrations and backups.

## Docker Run Pattern

This project now follows the same Docker run pattern as appbi-ai:

- docker-compose.yml: production-style stack
- docker-compose.dev.yml: development stack with hot reload

## Quick Start

### 0. Create environment file

```bash
cp .env.example .env
```

Open `.env` and update at least:

- `POSTGRES_PASSWORD`
- `SECRET_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` if using Google sign-in / Drive / Sheets

### Production stack

```bash
docker compose up -d --build
```

### Development stack

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

### Stop the stack

```bash
docker compose down
docker compose -f docker-compose.dev.yml down
```

## Default Ports

- Frontend: http://localhost:3002
- Backend API: http://localhost:8010
- PostgreSQL: localhost:5434

These defaults intentionally differ from appbi-ai (3000, 8000, 5432) so both projects can run at the same time on one machine.

## Project Structure

```text
appbi-integration/
├── apps/
│   ├── api/                  # FastAPI backend
│   └── web/                  # React + Vite frontend
├── docker-compose.yml        # Production-style Docker stack
├── docker-compose.dev.yml    # Development Docker stack
├── infrastructure/compose/   # Legacy helper compose files
├── modules/                  # Domain modules
└── packages/                 # Shared packages
```

## Local Development Without Docker

### Frontend

```bash
npm install
npm --workspace apps/web run dev
```

The Vite dev server runs on http://localhost:3002 and proxies /api/* to http://localhost:8010 by default.

### Backend

```bash
pip install -r apps/api/requirements.txt
uvicorn apps.api.src.main:app --reload --host 0.0.0.0 --port 8010
```

### Database

```bash
docker compose up -d postgres
```

## Useful Commands

```bash
docker compose ps
docker compose logs -f frontend backend postgres
docker compose -f docker-compose.dev.yml logs -f frontend backend postgres
docker compose up -d --build backend
docker compose -f docker-compose.dev.yml up -d --build frontend
```

## Environment Notes

- Root `.env.example` is the portable template for Docker deployments on new machines.
- Root `.env` is the machine-specific runtime file and should not be committed.
- Backend CORS defaults to http://localhost:3002
- Google OAuth redirect URI defaults to http://localhost:8010/api/google/callback
- Frontend dev proxy target can be overridden with VITE_PROXY_TARGET

## License

MIT