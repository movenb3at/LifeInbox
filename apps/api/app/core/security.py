from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import HTTPException
from jwt import PyJWKClient

from app.core.config import get_settings


@lru_cache
def jwks_client(url: str) -> PyJWKClient:
    return PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", lifespan=300, timeout=10)


def verify_token(token: str) -> UUID:
    settings = get_settings()
    if not settings.configured:
        raise HTTPException(503, "Supabase와 DB 환경변수를 먼저 설정해주세요.")
    try:
        key = jwks_client(settings.supabase_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token, key.key, algorithms=["ES256", "RS256"], audience="authenticated",
            issuer=f"{settings.supabase_url}/auth/v1",
            options={"require": ["sub", "exp", "iss", "aud", "role"]},
        )
        if claims["role"] != "authenticated":
            raise ValueError("invalid role")
        return UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise HTTPException(401, "로그인이 필요합니다.", headers={"WWW-Authenticate": "Bearer"}) from exc
