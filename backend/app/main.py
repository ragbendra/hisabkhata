import os
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .routers import auth, corrections, customers, entries, export, fruit_names, khata, reports
from .routers import settings as settings_router
from .routers import users

app = FastAPI(title="Hisab", version="1.0.0")

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


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
