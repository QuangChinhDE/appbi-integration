from passlib.context import CryptContext


_pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto', bcrypt__rounds=12)


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    return _pwd_context.verify(password, password_hash)