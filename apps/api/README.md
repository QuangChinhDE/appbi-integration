# IntegrationHub Backend API

FastAPI-based backend for IntegrationHub backup system with PostgreSQL database.

## Features

- ✅ **PostgreSQL Database** with JSONB support for flexible data storage
- ✅ **FastAPI** async framework for high performance
- ✅ **SQLAlchemy 2.0** with async support
- ✅ **Bcrypt** one-way encryption for access tokens
- ✅ **RESTful API** for backup flow management
- ✅ **Docker-ready** with compose configuration

## Database Schema

### backup_flows Table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key (auto-generated) |
| name | VARCHAR(255) | Auto-generated name (App_Type_Dest_Timestamp) |
| source | JSONB | App info + domain + access_token_hash |
| backup_type | VARCHAR(50) | structured / unstructured / all |
| destination | JSONB | Storage destination + auth info |
| structure | JSONB | Backup structure (objects, fields, formats) |
| schedule | JSONB | Schedule configuration |
| status | VARCHAR(20) | active / paused / archived |
| last_run_at | TIMESTAMP | Last execution time |
| last_run_status | VARCHAR(20) | completed / failed / running |
| last_run_message | TEXT | Status message |
| created_by | VARCHAR(100) | Creator username |
| updated_by | VARCHAR(100) | Last updater username |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

### backup_flow_runs Table

Tracks execution history for each backup flow.

## API Endpoints

### Backup Flows

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/backup-flows` | Create a new backup flow |
| GET | `/api/backup-flows` | List all backup flows (with filters) |
| GET | `/api/backup-flows/{id}` | Get specific flow details |
| PATCH | `/api/backup-flows/{id}` | Update a backup flow |
| DELETE | `/api/backup-flows/{id}` | Delete a backup flow |
| POST | `/api/backup-flows/{id}/run` | Trigger flow execution |
| GET | `/api/backup-flows/{id}/runs` | Get execution history |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | API health status |

## Security

### Access Token Hashing

Access tokens are hashed using **bcrypt** (one-way encryption) before storage:

- Original token is **never** stored in database
- Hash is irreversible - cannot decode to get original token
- Each token gets unique salt for additional security

```python
# Example hashing
access_token = "user_token_here"
hashed = bcrypt.hashpw(access_token.encode('utf-8'), bcrypt.gensalt())
# Stored in DB: {"access_token_hash": "$2b$12$..."}
```

### Refresh Token Handling

Similar to access tokens, Google OAuth refresh tokens are also hashed before storage:

```json
{
  "destination": {
    "type": "gdrive",
    "auth": {
      "email": "user@gmail.com",
      "refresh_token_hash": "$2b$12$..."
    }
  }
}
```

## JSONB Structure Examples

### Source Object

```json
{
  "app": "request",
  "app_name": "Request",
  "domain": "company.vn",
  "access_token_hash": "$2b$12$KIXxN..."
}
```

### Destination Object

```json
{
  "type": "gdrive",
  "name": "Google Drive",
  "auth": {
    "email": "user@gmail.com",
    "refresh_token_hash": "$2b$12$..."
  }
}
```

### Structure Object

```json
{
  "objects": ["group", "request"],
  "custom_fields": ["field1", "field2"],
  "export_formats": {
    "field1": "json",
    "field2": "excel"
  }
}
```

### Schedule Object

```json
{
  "type": "daily",
  "time": "02:00",
  "enabled": true
}
```

## Development Setup

### 1. Local Development (without Docker)

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export DATABASE_URL="postgresql+asyncpg://integrationhub:integrationhub_password_2026@localhost:5434/integrationhub"
export SECRET_KEY="your-secret-key"

# Run database migrations (if init.sql not run yet)
# Connect to PostgreSQL and run init.sql manually

# Start the API server
uvicorn src.main:app --reload --host 0.0.0.0 --port 8010
```

### 2. Docker Compose (Recommended)

```bash
# From project root
docker compose up -d postgres backend

# View logs
docker compose logs -f backend

# Stop services
docker compose down
```

## API Usage Examples

### Create Backup Flow

```bash
curl -X POST http://localhost:8010/api/backup-flows \
  -H "Content-Type: application/json" \
  -d '{
    "source": {
      "app": "request",
      "app_name": "Request",
      "domain": "company.vn",
      "access_token": "actual_token_here"
    },
    "backup_type": "all",
    "destination": {
      "type": "gdrive",
      "name": "Google Drive",
      "auth": {
        "email": "user@gmail.com",
        "refresh_token": "google_refresh_token"
      }
    },
    "structure": {
      "objects": ["group", "request"]
    },
    "schedule": {
      "type": "daily",
      "time": "02:00",
      "enabled": true
    },
    "created_by": "admin@company.vn"
  }'
```

### List Backup Flows

```bash
# All flows
curl http://localhost:8010/api/backup-flows

# Filter by app
curl http://localhost:8010/api/backup-flows?app=request

# Filter by status
curl http://localhost:8010/api/backup-flows?status=active

# Pagination
curl http://localhost:8010/api/backup-flows?skip=0&limit=10
```

### Run a Backup Flow

```bash
curl -X POST http://localhost:8010/api/backup-flows/{flow_id}/run \
  -H "Content-Type: application/json" \
  -d '{"triggered_by": "admin@company.vn"}'
```

## Auto-Generated Flow Names

Flow names are automatically generated following this pattern:

```
{AppName}_{BackupType}_{Destination}_{Timestamp}
```

Examples:
- `Request_Complete_GDrive_20260412153045`
- `Workflow_Structured_GSheets_20260412153100`
- `WeWork_Unstructured_GDrive_20260412153115`

## Database Migrations

Initial schema is created automatically via `init.sql` mounted to PostgreSQL container.

For future migrations, consider using Alembic:

```bash
pip install alembic
alembic init alembic
# Configure alembic.ini and create migrations
```

## Testing

```bash
# Install test dependencies
pip install pytest pytest-asyncio httpx

# Run tests (TODO: implement tests)
pytest
```

## Production Deployment

1. Change default passwords in `docker-compose.yml`
2. Set strong `SECRET_KEY` in environment
3. Set `echo=False` in database.py
4. Configure proper CORS origins
5. Use reverse proxy (Nginx) for SSL/TLS
6. Set up monitoring and logging
7. Configure backup retention policies

## Tech Stack

- **FastAPI** 0.109.0 - Modern async web framework
- **SQLAlchemy** 2.0.25 - ORM with async support
- **AsyncPG** 0.29.0 - Async PostgreSQL driver
- **PostgreSQL** 15 - Relational database with JSONB
- **Bcrypt** 4.1.2 - Password hashing
- **Pydantic** 2.5.3 - Data validation
- **Uvicorn** 0.27.0 - ASGI server

## License

MIT
