from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core import security


@pytest.fixture
def jwks_key(monkeypatch):
    private = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(security.settings, "SUPABASE_JWKS_URL", "https://example.test/auth/v1/keys")
    monkeypatch.setattr(security.settings, "SUPABASE_JWT_ISSUER", "https://example.test/auth/v1")
    monkeypatch.setattr(security.settings, "SUPABASE_JWT_AUDIENCE", "authenticated")
    monkeypatch.setattr(security, "jwks_client", Mock(get_signing_key_from_jwt=lambda _: Mock(key=private.public_key())))
    return private


def token_for(key, **overrides):
    now = datetime.now(UTC)
    claims = {
        "sub": "4b2f1ad0-d501-4b20-8cf1-728bed2a40cf",
        "iss": "https://example.test/auth/v1",
        "aud": "authenticated",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="ES256")


def credentials(token):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_es256_jwks_valid_token_returns_identity(jwks_key):
    payload = security.get_current_user(credentials(token_for(jwks_key)))
    assert payload["sub"] == "4b2f1ad0-d501-4b20-8cf1-728bed2a40cf"
    assert payload["_token"].count(".") == 2


@pytest.mark.parametrize("claims", [
    {"exp": datetime.now(UTC) - timedelta(minutes=1)},
    {"iss": "https://attacker.test"},
    {"aud": "anon"},
])
def test_expired_wrong_issuer_and_wrong_audience_are_rejected(jwks_key, claims):
    with pytest.raises(HTTPException) as error:
        security.get_current_user(credentials(token_for(jwks_key, **claims)))
    assert error.value.status_code == 401


def test_wrong_signature_is_rejected(jwks_key):
    other = ec.generate_private_key(ec.SECP256R1())
    with pytest.raises(HTTPException) as error:
        security.get_current_user(credentials(token_for(other)))
    assert error.value.status_code == 401


def test_wrong_algorithm_and_malformed_jwt_are_rejected(jwks_key):
    wrong_alg = jwt.encode({"sub": "u", "iss": "https://example.test/auth/v1", "aud": "authenticated", "exp": datetime.now(UTC) + timedelta(minutes=5)}, "x" * 40, algorithm="HS256")
    for token in (wrong_alg, "malformed.token"):
        with pytest.raises(HTTPException) as error:
            security.get_current_user(credentials(token))
        assert error.value.status_code == 401
