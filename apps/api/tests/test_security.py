from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app.core import security


@pytest.fixture
def signer(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(security, "get_settings", lambda: SimpleNamespace(configured=True, supabase_url="https://project.supabase.co"))
    monkeypatch.setattr(security, "jwks_client", lambda url: SimpleNamespace(get_signing_key_from_jwt=lambda token: SimpleNamespace(key=key.public_key())))
    return key


def claims():
    return {"sub": str(uuid4()), "exp": datetime.now(UTC) + timedelta(minutes=5),
            "iss": "https://project.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated"}


def test_valid_jwt(signer):
    payload = claims()
    assert str(security.verify_token(jwt.encode(payload, signer, algorithm="RS256"))) == payload["sub"]


@pytest.mark.parametrize("override", [
    {"exp": 1}, {"iss": "https://other.supabase.co/auth/v1"}, {"aud": "other"},
    {"role": "service_role"}, {"sub": "not-a-uuid"},
])
def test_rejects_invalid_jwt(signer, override):
    with pytest.raises(HTTPException) as exc:
        security.verify_token(jwt.encode(claims() | override, signer, algorithm="RS256"))
    assert exc.value.status_code == 401


def test_rejects_forged_signature(signer):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(HTTPException):
        security.verify_token(jwt.encode(claims(), other, algorithm="RS256"))
