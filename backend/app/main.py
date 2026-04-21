"""FastAPI 應用入口：CORS、API 路由、health check"""
import logging
from contextlib import asynccontextmanager

import aiohttp
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import litellm
from litellm.llms.custom_httpx.aiohttp_handler import BaseLLMAIOHTTPHandler
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api import router as api_router
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.limiter import limiter
from app.services.startup_seed import (
    seed_agent_catalog,
    seed_default_admin,
    seed_default_tenant,
)
from app.services.stored_files_store import get_stored_files_base_dir

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """LiteLLM 建議：在 FastAPI 中注入 aiohttp session，避免 acompletion 在 event loop 中出錯"""
    session = aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=180),
        connector=aiohttp.TCPConnector(limit=300),
    )
    litellm.base_llm_aiohttp_handler = BaseLLMAIOHTTPHandler(client_session=session)
    _sf = get_stored_files_base_dir()
    logger.info("STORED_FILES 儲存根目錄（絕對路徑）: %s", _sf)
    if _sf is not None:
        _sf.mkdir(parents=True, exist_ok=True)

    with SessionLocal() as db:
        seed_agent_catalog(db)
        seed_default_tenant(db)
        seed_default_admin(db)

    yield
    await session.close()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.middleware("http")
async def log_requests(request, call_next):
    logger.info(f"Request: {request.method} {request.url.path}")
    response = await call_next(request)
    logger.info(f"Response: {response.status_code} for {request.url.path}")
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    from fastapi import HTTPException as FastAPIHTTPException
    if isinstance(exc, FastAPIHTTPException):
        raise exc
    logger.exception(f"未處理的例外: {request.url.path}")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )


@app.get("/health")
async def health_check():
    return {"status": "ok"}
