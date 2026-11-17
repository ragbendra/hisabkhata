import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import APIRouter, Depends, FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .jobs import run_weekly_email
from .routers import auth, corrections, customers, entries, export, fruit_names, khata, reports
from .routers import settings as settings_router
from .routers import users

log = logging.getLogger("hisab.scheduler")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Starts the weekly-email check inside the app, so no separate cron service is needed.

    The job only sends when the owner's chosen day and time has passed and nothing was sent today
    (see run_weekly_email), so running it every 15 minutes is safe. Set FK_RUN_SCHEDULER=0 to turn it
    off, for example when a separate cron job is used instead or on a second instance.
    """
    scheduler = None
    if os.environ.get("FK_RUN_SCHEDULER", "1") != "0":
        scheduler = BackgroundScheduler(timezone="UTC")
        scheduler.add_job(
            run_weekly_email,
            "interval",
            minutes=15,
            id="weekly_email",
            max_instances=1,  # never two runs at once
            coalesce=True,  # after a sleep, run once, not once per missed slot
            misfire_grace_time=3600,
        )
        scheduler.start()
        log.info("Scheduler started: weekly email check every 15 minutes")
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)


app = FastAPI(title="Hisab", version="1.0.0", lifespan=lifespan)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def require_app_header(request: Request, call_next):
    """CSRF guard: browsers cannot add this header cross-site without a CORS preflight."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api"):
        if request.headers.get("x-requested-with") != "fruit-khata":
            return JSONResponse({"detail": "Missing X-Requested-With header"}, status_code=403)
    return await call_next(request)


api = APIRouter(prefix="/api")
for module in (
    auth, users, entries, customers, corrections, fruit_names, khata, reports, settings_router, export,
):
    api.include_router(module.router)


@api.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"ok": True, "db": True}
    except Exception as e:
        return JSONResponse(
            {"ok": False, "db": False, "error": str(e)},
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


app.include_router(api)

# Optional: serve the built frontend (frontend/dist) from the same server.
_static = Path(os.environ.get("FK_STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if _static.is_dir():
    app.mount("/assets", StaticFiles(directory=_static / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        candidate = (_static / path).resolve()
        if path and candidate.is_file() and _static.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(_static / "index.html")
