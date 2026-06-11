from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"

    # Hive
    hive_api_key: str = ""
    hive_user_id: str = ""
    hive_workspace_id: str = ""
    hive_uat_project_id: str = ""

    # Mistral (fallback)
    mistral_api_key: str = ""
    mistral_model: str = "mistral-large-latest"

    # Email
    resend_api_key: str = ""
    email_cc_address: str = ""

    # Application
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    debug: bool = True
    log_level: str = "INFO"

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
