import logging

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.automation import router as automation_router
from app.api.routes import router
from app.api.screenshots import router as screenshots_router
from app.core.config import get_settings
from app.core.database import get_engine

app = FastAPI(title="LifeInbox API", version="0.1.0")
app.include_router(router)
app.include_router(automation_router)
app.include_router(screenshots_router)


@app.middleware("http")
async def private_cache(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "private, no-store"
    return response


@app.exception_handler(ValidationError)
@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc):
    errors = [{"loc": error["loc"], "msg": error["msg"], "type": error["type"]} for error in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, exc):
    logging.getLogger("lifeinbox").error("Database request failed: %s", type(exc).__name__)
    return JSONResponse(status_code=503, content={"detail": "데이터에 연결할 수 없습니다. 잠시 후 다시 시도해주세요."})


@app.get("/health")
def health():
    settings = get_settings()
    if not settings.configured:
        return JSONResponse(status_code=503, content={"status": "setup_required"})
    try:
        with get_engine().connect() as connection:
            safe_role = connection.execute(text("""
                SELECT current_user='lifeinbox_app' AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolinherit) AND NOT EXISTS (
                    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='app' AND c.relowner=r.oid
                ) FROM pg_roles r WHERE r.rolname=current_user
            """)).scalar()
            connection.execute(text("SELECT id FROM app.spaces LIMIT 1"))
            if not safe_role:
                return JSONResponse(status_code=503, content={"status": "unsafe_database_role"})
    except SQLAlchemyError:
        return JSONResponse(status_code=503, content={"status": "database_unavailable"})
    return {"status": "ok"}
