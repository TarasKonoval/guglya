"""Verify Cognito ID tokens sent by the frontend as `Authorization: Bearer <jwt>`."""
import json
import urllib.request

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings
from .db import execute

_bearer = HTTPBearer(auto_error=False)


def _load_jwks() -> jwt.PyJWKSet:
    raw = settings.cognito_jwks
    if not raw:  # local dev: fetch it (Lambda gets it from Terraform because the VPC has no internet)
        with urllib.request.urlopen(f"{settings.cognito_issuer}/.well-known/jwks.json", timeout=10) as r:
            raw = r.read().decode()
    return jwt.PyJWKSet.from_json(raw)


_jwks = _load_jwks()


def _decode(token: str) -> dict:
    kid = jwt.get_unverified_header(token).get("kid")
    key = next((k for k in _jwks.keys if k.key_id == kid), None)
    if key is None:
        raise HTTPException(401, "Unknown signing key")
    claims = jwt.decode(
        token,
        key.key,
        algorithms=["RS256"],
        audience=settings.cognito_client_id,
        issuer=settings.cognito_issuer,
        options={"require": ["exp", "iss", "aud", "sub"]},
    )
    if claims.get("token_use") != "id":
        raise HTTPException(401, "Expected an ID token")
    return claims


def _upsert_user(claims: dict) -> dict:
    execute(
        """insert into users (id, email) values (%s, %s)
           on conflict (id) do update set email = excluded.email, last_seen_at = now()""",
        (claims["sub"], claims.get("email")),
    )
    return claims


def optional_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict | None:
    if not creds:
        return None
    try:
        claims = _decode(creds.credentials)
    except Exception:
        return None
    return _upsert_user(claims)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Not signed in")
    try:
        claims = _decode(creds.credentials)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(401, f"Invalid token: {e}")
    return _upsert_user(claims)


def is_admin(user: dict) -> bool:
    return "admins" in user.get("cognito:groups", [])


def admin_user(user: dict = Depends(current_user)) -> dict:
    """Members of the Cognito group "admins" (outfit builders)."""
    if not is_admin(user):
        raise HTTPException(403, "Admins only")
    return user
