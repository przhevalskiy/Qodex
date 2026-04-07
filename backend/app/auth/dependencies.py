"""FastAPI authentication dependencies using Supabase JWT."""

import logging
from dataclasses import dataclass
import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings


@dataclass
class UserContext:
    user_id: str
    email: str
    display_name: str

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer()

# JWKS client — caches keys so we don't hit the endpoint on every request.
_jwks_client: PyJWKClient = None


def _get_jwks_client() -> PyJWKClient:
    """Lazy-init a PyJWKClient pointing at the Supabase JWKS endpoint."""
    global _jwks_client
    if _jwks_client is None:
        settings = get_settings()
        jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
        logger.info(f"Initialized JWKS client: {jwks_url}")
    return _jwks_client


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> str:
    """Decode Supabase JWT and return the user's UUID.

    Supports both ES256 (new JWKS-based keys) and HS256 (legacy shared secret).
    Raises 401 if the token is missing, expired, or invalid.
    """
    settings = get_settings()
    token = credentials.credentials

    try:
        header = jwt.get_unverified_header(token)
        token_alg = header.get("alg", "HS256")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        )

    try:
        if token_alg in ("ES256", "RS256", "EdDSA"):
            # Asymmetric algorithm — use JWKS public key
            jwks = _get_jwks_client()
            signing_key = jwks.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[token_alg],
                audience="authenticated",
            )
        else:
            # HS256 legacy — use shared secret
            if not settings.supabase_jwt_secret:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="SUPABASE_JWT_SECRET is not configured",
                )
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError as e:
        logger.error(f"JWT decode failed (alg={token_alg}): {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user identifier",
        )

    return user_id


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> UserContext:
    """Decode Supabase JWT and return user_id, email, and display_name."""
    user_id = await get_current_user_id(credentials)

    # Re-decode without verification to extract claims (already verified above)
    token = credentials.credentials
    unverified = jwt.decode(token, options={"verify_signature": False})

    email = unverified.get("email") or ""
    user_metadata = unverified.get("user_metadata") or {}
    display_name = (
        user_metadata.get("display_name")
        or (email.split("@")[0] if email else "")
    )

    return UserContext(user_id=user_id, email=email, display_name=display_name)
