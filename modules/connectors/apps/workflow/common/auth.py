from urllib.parse import urlparse

from pydantic import BaseModel, Field, computed_field, field_validator

from modules.connectors.apps.workflow.common.constants import API_PREFIX


def normalize_workflow_domain(domain: str) -> str:
    cleaned = (domain or "").strip()
    if not cleaned:
        raise ValueError("domain is required")

    if "://" in cleaned:
        parsed = urlparse(cleaned)
        cleaned = parsed.netloc or parsed.path

    cleaned = cleaned.split("/")[0].strip().strip(".")
    if cleaned.startswith("workflow."):
        cleaned = cleaned[len("workflow.") :]
    if not cleaned:
        raise ValueError("domain is invalid")

    return cleaned


def build_workflow_base_urls(domain: str) -> list[str]:
    normalized = normalize_workflow_domain(domain)
    return [
        f"https://workflow.{normalized}{API_PREFIX}",
        f"https://{normalized}{API_PREFIX}",
    ]


class WorkflowCredentials(BaseModel):
    domain: str = Field(..., description="Workflow domain, e.g. company.base.com.vn")
    access_token: str = Field(..., description="Workflow API access token")

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, value: str) -> str:
        return normalize_workflow_domain(value)

    @field_validator("access_token")
    @classmethod
    def validate_access_token(cls, value: str) -> str:
        token = value.strip()
        if not token:
            raise ValueError("access_token is required")
        return token

    @computed_field
    @property
    def base_urls(self) -> list[str]:
        return build_workflow_base_urls(self.domain)

    @computed_field
    @property
    def base_url(self) -> str:
        return self.base_urls[0]