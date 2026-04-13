# Production Deployment Guide

## Quick Start

### Build and run with Docker Compose:

```bash
docker compose up --build
```

The application will be available at `http://localhost`

### Stop the containers:

```bash
docker compose down
```

## Detailed Steps

### 1. Build the Docker image

```bash
docker compose build
```

This will:
- Use Node 18 Alpine as builder
- Install dependencies
- Build production assets with Vite
- Create optimized Nginx container
- Final image size: ~25MB

### 2. Run the container

```bash
docker compose up
```

Or run in detached mode:

```bash
docker compose up -d
```

### 3. View logs

```bash
docker compose logs -f frontend
```

### 4. Rebuild after changes

```bash
docker compose up --build --force-recreate
```

## Manual Docker Commands

### Build Frontend Image

```bash
cd frontend
docker build -t integrationhub-frontend:latest .
```

### Run Frontend Container

```bash
docker run -d \
  --name integrationhub-frontend \
  -p 80:80 \
  integrationhub-frontend:latest
```

### Stop and Remove Container

```bash
docker stop integrationhub-frontend
docker rm integrationhub-frontend
```

## Environment Variables

Create `.env` file in project root:

```env
# Frontend
VITE_API_URL=http://localhost:8000

# Add more variables as needed
```

## Nginx Configuration

The production build uses Nginx with:
- Gzip compression
- Static asset caching (1 year)
- SPA routing support
- Security headers
- Cache busting for index.html

## Build Optimization

The Dockerfile uses multi-stage builds:

1. **Builder Stage** (node:18-alpine)
   - Installs dependencies
   - Runs `npm run build`
   - Outputs to `/app/dist`

2. **Production Stage** (nginx:alpine)
   - Copies built assets from builder
   - Configures Nginx
   - Minimal final image

## Troubleshooting

### Port already in use

If port 80 is already in use, edit `docker-compose.yml`:

```yaml
services:
  frontend:
    ports:
      - "8080:80"  # Change to any available port
```

### Build fails

Clear Docker cache and rebuild:

```bash
docker compose build --no-cache
```

### Container crashes

Check logs:

```bash
docker compose logs frontend
```

### Permission issues on Windows

Run PowerShell as Administrator or use WSL2.

## Production Checklist

- [ ] Update `VITE_API_URL` in `.env`
- [ ] Build production image
- [ ] Test locally with Docker Compose
- [ ] Configure reverse proxy (if needed)
- [ ] Set up SSL/TLS certificates
- [ ] Configure firewall rules
- [ ] Set up monitoring and logging
- [ ] Configure automatic restarts

## Performance

Production build includes:
- Code splitting
- Tree shaking
- Minification
- Gzip compression
- Asset caching
- Optimized bundle size

Expected bundle sizes:
- Main bundle: ~150KB (gzipped)
- Vendor bundle: ~200KB (gzipped)
- Total: ~350KB (gzipped)

## Security

The Nginx configuration includes:
- X-Frame-Options: SAMEORIGIN
- X-Content-Type-Options: nosniff
- X-XSS-Protection: 1; mode=block

For production, also consider:
- HTTPS/TLS
- Content Security Policy
- Rate limiting
- Web Application Firewall

## Scaling

To run multiple instances:

```yaml
services:
  frontend:
    deploy:
      replicas: 3
    # ... rest of config
```

Then use a load balancer (Nginx, HAProxy, Traefik) in front.
