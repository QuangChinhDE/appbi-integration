import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from jose import jwt


ALGORITHM = 'HS256'


def _jwt_secret() -> str:
    return os.getenv('AUTH_JWT_SECRET') or os.getenv('SECRET_KEY', 'change-this-jwt-secret-in-production')


def _access_token_expire_minutes() -> int:
    raw_value = os.getenv('AUTH_JWT_EXPIRE_MINUTES', '480')
    try:
        return max(int(raw_value), 15)
    except (TypeError, ValueError):
        return 480


def create_access_token(user_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        'sub': user_id,
        'email': email,
        'jti': str(uuid4()),
        'iat': now,
        'exp': now + timedelta(minutes=_access_token_expire_minutes()),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, _jwt_secret(), algorithms=[ALGORITHM])