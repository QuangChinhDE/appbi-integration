from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from datetime import datetime

from modules.apps.backend.api.routes import router as apps_router
from modules.backup.backend.api.routes import router as backup_router
from modules.backup.backend.services.backup_flow_service import BackupFlowService
from modules.connectors.backend.api.routes import router as connectors_router
from modules.credentials.backend.api.routes import router as credentials_router
from modules.destinations.backend.api.routes import router as destinations_router
from modules.identity.backend.api.routes import router as identity_router
from modules.sources.backend.api.routes import router as sources_router
from packages.auth.src.bootstrap import ensure_bootstrap_admin
from packages.database.src import Base, async_session, engine, get_db

# Create FastAPI app
app = FastAPI(
    title="IntegrationHub API",
    description="Backend API for IntegrationHub backup system",
    version="1.0.0"
)

# CORS Configuration
origins = os.getenv("CORS_ORIGINS", "http://localhost:3002,http://localhost:8010").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables on startup
@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await ensure_bootstrap_admin(db)
        await BackupFlowService(db).interrupt_incomplete_runs()

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

app.include_router(backup_router)
app.include_router(identity_router)
app.include_router(credentials_router)
app.include_router(apps_router)
app.include_router(connectors_router)
app.include_router(sources_router)
app.include_router(destinations_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
