from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import logging
import os
from datetime import datetime

from modules.automation.backend.api.routes import router as automation_router
from modules.apps.backend.api.routes import router as apps_router
from modules.backup.backend.api.routes import router as backup_router
from modules.backup.backend.services.backup_flow_service import BackupFlowService
from modules.connectors.backend.api.routes import router as connectors_router
from modules.credentials.backend.api.routes import router as credentials_router
from modules.identity.backend.api.routes import router as identity_router
from modules.identity.backend.api.share_routes import router as share_router
from modules.pipeline.backend.api.routes import router as pipeline_router
from modules.pipeline.backend.services.pipeline_service import PipelineService
from packages.auth.src.bootstrap import ensure_bootstrap_admin
from packages.auth.src.module_registry import is_module_enabled
from packages.database.src import Base, async_session, engine, get_db
from packages.database.src.schema_migrations import run_startup_schema_migrations

# Create FastAPI app
logger = logging.getLogger(__name__)
pipeline_scheduler_task: asyncio.Task | None = None

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
async def _pipeline_scheduler_loop() -> None:
    while True:
        try:
            async with async_session() as db:
                await PipelineService(db).run_due_schedules_once()
                await db.commit()
        except Exception:
            logger.exception("Pipeline scheduler loop failed")
        await asyncio.sleep(60)


@app.on_event("startup")
async def startup():
    global pipeline_scheduler_task
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await run_startup_schema_migrations(db)
        await ensure_bootstrap_admin(db)
        if is_module_enabled('backup'):
            await BackupFlowService(db).interrupt_incomplete_runs()
        if is_module_enabled('pipeline'):
            await PipelineService(db).interrupt_incomplete_runs()
    if is_module_enabled('pipeline') and pipeline_scheduler_task is None:
        pipeline_scheduler_task = asyncio.create_task(_pipeline_scheduler_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    global pipeline_scheduler_task
    if pipeline_scheduler_task is not None:
        pipeline_scheduler_task.cancel()
        pipeline_scheduler_task = None

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

app.include_router(identity_router)
app.include_router(share_router)
app.include_router(credentials_router)
app.include_router(apps_router)
if is_module_enabled('backup') or is_module_enabled('pipeline'):
    app.include_router(connectors_router)
if is_module_enabled('backup'):
    app.include_router(backup_router)
if is_module_enabled('pipeline'):
    app.include_router(pipeline_router)
if is_module_enabled('automation'):
    app.include_router(automation_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
