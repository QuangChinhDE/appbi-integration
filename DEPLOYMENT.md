# Deployment Guide

## Run Modes

## Environment Setup

Before running Docker on a new machine:

```bash
cp .env.example .env
```

Then fill the machine-specific values in `.env`, especially:

- `POSTGRES_PASSWORD`
- `SECRET_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` when Google OAuth is needed

### Production-style stack

```bash
docker compose up -d --build
```

### Development stack with hot reload

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

### Stop services

```bash
docker compose down
docker compose -f docker-compose.dev.yml down
```

## Default Ports

- Frontend: 3002
- Backend API: 8010
- PostgreSQL: 5434

These ports are reserved for appbi-integration so they do not conflict with appbi-ai.

## Logs

```bash
docker compose logs -f frontend backend postgres
docker compose -f docker-compose.dev.yml logs -f frontend backend postgres
```

## Rebuild One Service

```bash
docker compose up -d --build backend
docker compose -f docker-compose.dev.yml up -d --build frontend
```

## Environment Overrides

Use the root `.env.example` as the template and create a root `.env` file from it:

```env
FRONTEND_PORT=3002
BACKEND_PORT=8010
POSTGRES_PORT=5434
GOOGLE_REDIRECT_URI=http://localhost:8010/api/google/callback
```

## Troubleshooting

### Port already in use

Change the corresponding variable in .env or edit the port mapping in the compose file.

### Dev frontend cannot reach backend

The Vite dev server proxies /api/* to VITE_PROXY_TARGET, which defaults to http://localhost:8010 outside Docker and is set to http://backend:8000 inside docker-compose.dev.yml.

### Container fails to start

Inspect logs first:

```bash
docker compose logs -f frontend backend postgres
```