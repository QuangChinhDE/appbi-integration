from urllib.parse import urlparse

from pydantic import BaseModel, Field, computed_field, field_validator


def normalize_crm_domain(domain: str) -> str:
    cleaned = (domain or "").strip()
    if not cleaned:
        raise ValueError("domain is required")

    if "://" in cleaned:
        parsed = urlparse(cleaned)
        cleaned = parsed.netloc or parsed.path

    cleaned = cleaned.split("/")[0].strip().strip(".")
    for prefix in ("apis.", "crm."):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):]

    if not cleaned:
        raise ValueError("domain is invalid")

    return cleaned


class CrmCredentials(BaseModel):
    domain: str = Field(..., description="Base domain, e.g. company.base.com.vn")
    access_token: str = Field(..., description="CRM access token")
    password: str = Field(..., description="CRM API password")

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, value: str) -> str:
        return normalize_crm_domain(value)

    @field_validator("access_token")
    @classmethod
    def validate_access_token(cls, value: str) -> str:
        token = value.strip()
        if not token:
            raise ValueError("access_token is required")
        return token

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        pw = value.strip()
        if not pw:
            raise ValueError("password is required")
        return pw

    @computed_field
    @property
    def lead_base_url(self) -> str:
        return f"https://apis.{self.domain}/leads"

    @computed_field
    @property
    def deal_base_url(self) -> str:
        return f"https://apis.{self.domain}/sales/v1"
