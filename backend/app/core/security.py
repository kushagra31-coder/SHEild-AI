import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

security = HTTPBearer(auto_error=True)

jwks_client = None
if settings.SUPABASE_JWKS_URL:
    jwks_client = jwt.PyJWKClient(settings.SUPABASE_JWKS_URL)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    Validate Supabase JWT and extract user identity.

    Returns the JWT payload dict plus '_token' (raw Bearer string) so callers
    can forward it to the Supabase PostgREST client without a second Depends.
    """
    token = credentials.credentials

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        if jwks_client:
            # Production: RS256/ES256 verified via Supabase JWKS endpoint
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=settings.SUPABASE_JWT_AUDIENCE or None,
                issuer=settings.SUPABASE_JWT_ISSUER or None,
            )
        elif settings.SUPABASE_JWT_SECRET:
            # Local / testing: HS256 with shared secret
            payload = jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                # Allow empty audience/issuer for local dev
                options={
                    "verify_aud": bool(settings.SUPABASE_JWT_AUDIENCE),
                    "verify_iss": bool(settings.SUPABASE_JWT_ISSUER),
                },
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="JWT configuration missing on server",
            )

        if not payload.get("sub"):
            raise credentials_exception

        # Attach the raw token so route handlers can forward it to Supabase
        payload["_token"] = token
        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise credentials_exception
