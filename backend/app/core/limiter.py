"""全域 Rate Limiter 實例（slowapi）：由 main.py 掛載、public API 端點引用"""
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _rate_limit_key(request: Request) -> str:
    """Rate limit key：優先用 X-API-Key，退而求其次用 IP"""
    return request.headers.get("X-API-Key") or get_remote_address(request)


limiter = Limiter(key_func=_rate_limit_key)
