import logging
import re
import time
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1.guardians import router as guardians_router
from app.api.v1.incidents import router as incidents_router
from app.api.v1.journeys import router as journeys_router
from app.core.config import settings
from app.db.supabase import get_supabase_client

logger = logging.getLogger("sheild.api")

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Emergency alert and guardian coordination MVP",
    version="1.0.0",
)

class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", request_id):
            request_id = str(uuid4())
        request.state.request_id = request_id
        started = time.monotonic()
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            logger.info("request_complete request_id=%s method=%s path=%s status=%s duration_ms=%d", request_id, request.method, request.url.path, response.status_code, round((time.monotonic() - started) * 1000))
            return response
        except Exception as exc:
            logger.error("request_failed request_id=%s method=%s path=%s error_type=%s", request_id, request.method, request.url.path, type(exc).__name__)
            raise

app.add_middleware(RequestIdMiddleware)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    messages = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 422: "VALIDATION_ERROR", 429: "RATE_LIMITED"}
    message = str(exc.detail) if exc.status_code < 500 else "The request could not be completed."
    body = {"code": messages.get(exc.status_code, "REQUEST_ERROR"), "message": message, "request_id": getattr(request.state, "request_id", None)}
    return JSONResponse(status_code=exc.status_code, headers=exc.headers, content={"detail": message, "error": body})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    message = "Request validation failed."
    body = {"code": "VALIDATION_ERROR", "message": message, "request_id": getattr(request.state, "request_id", None)}
    return JSONResponse(status_code=422, content={"detail": message, "error": body})

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class HealthResponse(BaseModel):
    status: str
    message: str

@app.get(f"{settings.API_V1_STR}/health/live", response_model=HealthResponse, tags=["Health"])
def health_live():
    """
    Process health, no secrets.
    """
    return {"status": "ok", "message": "SHEild AI backend is alive"}

@app.get(f"{settings.API_V1_STR}/health/ready", response_model=HealthResponse, tags=["Health"])
def health_ready():
    """Readiness requires Supabase/PostgREST to answer; liveness does not."""
    try:
        get_supabase_client().table("profiles").select("id").limit(1).execute()
    except Exception as exc:  # noqa: BLE001 - readiness covers driver/network failures.
        logger.error("readiness_check_failed error_type=%s", type(exc).__name__)
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Required database service is unavailable.") from None
    return {"status": "ok", "message": "Required dependencies are available"}

app.include_router(incidents_router, prefix=f"{settings.API_V1_STR}/incidents", tags=["Incidents"])
app.include_router(guardians_router, prefix=f"{settings.API_V1_STR}/guardians", tags=["Guardians"])
app.include_router(journeys_router, prefix=f"{settings.API_V1_STR}/journeys", tags=["Safe Journey"])
