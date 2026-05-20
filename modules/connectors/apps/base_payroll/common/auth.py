from urllib.parse import urlparse

from pydantic import BaseModel, Field, computed_field, field_validator

from modules.connectors.apps.base_payroll.common.constants import API_PREFIX


def normalize_payroll_domain(domain: str) -> str:
    cleaned = (domain or "").strip()
    if not cleaned:
        raise ValueError("domain is required")
    if "://" in cleaned:
        parsed = urlparse(cleaned)
        cleaned = parsed.netloc or parsed.path
    cleaned = cleaned.split("/")[0].strip().strip(".")
    if cleaned.startswith("payroll."):
        cleaned = cleaned[len("payroll."):]
    if not cleaned:
        raise ValueError("domain is invalid")
    return cleaned


class PayrollCredentials(BaseModel):
    domain: str = Field(..., description="Base domain, e.g. company.base.com.vn")
    access_token: str = Field(..., description="Base Account access token v2")

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, value: str) -> str:
        return normalize_payroll_domain(value)

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
        return f"https://payroll.{self.domain}{API_PREFIX}"
