"""Verify Supabase access tokens sent by the frontend as `Authorization: Bearer <jwt>`."""
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

_bearer = HTTPBearer(auto_error=False)
_jwks = jwt.PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")


def _decode(token: str) -> dict:
    alg = jwt.get_unverified_header(token).get("alg")
    if alg == "HS256":  # legacy Supabase projects
        if not settings.supabase_jwt_secret:
            raise HTTPException(401, "HS256 token but SUPABASE_JWT_SECRET is not set")
        key = settings.supabase_jwt_secret
    else:  # new projects sign with asymmetric keys (ES256/RS256)
        key = _jwks.get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=[alg], audience="authenticated")


def optional_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict | None:
    if not creds:
        return None
    try:
        return _decode(creds.credentials)
    except Exception:
        return None


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Not signed in")
    try:
        return _decode(creds.credentials)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(401, f"Invalid token: {e}")
