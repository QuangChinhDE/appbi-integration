from urllib.parse import urlparse

from pydantic import BaseModel, Field, computed_field, field_validator

from modules.connectors.apps.service.common.constants import API_PREFIX


def normalize_service_domain(domain: str) -> str:
    cleaned = (domain or "").strip()
    if not cleaned:
        raise ValueError("domain is required")

    if "://" in cleaned:
        cleaned = urlparse(cleaned).netloc or urlparse(cleaned).path

    cleaned = cleaned.split("/")[0].strip().strip(".")
    if cleaned.startswith("service."):
        cleaned = cleaned[len("service.") :]

    if not cleaned:
        raise ValueError("domain is invalid")

    return cleaned


class ServiceCredentials(BaseModel):
    domain: str = Field(..., description="Base domain, e.g. company.vn")
    access_token: str = Field(..., description="Base Account access token v2")

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, value: str) -> str:
        return normalize_service_domain(value)

    @field_validator("access_token")
    @classmethod
    def validate_access_token(cls, value: str) -> str:
        token = value.strip()
        if not token:
            raise ValueError("access_token is required")
        return token

    @computed_field
    @property
    def base_url(self) -> str:
        return f"https://service.{self.domain}{API_PREFIX}"