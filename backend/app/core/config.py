from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Supabase Database Configuration
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    # AI Provider API Keys
    openai_api_key: str = ""  # Used for Pinecone embeddings (text-embedding-3-small)
    anthropic_api_key: str = ""
    mistral_api_key: str = ""

    # AI Model Configurations
    anthropic_model: str = "claude-sonnet-4-5-20250929"
    mistral_model: str = "mistral-large-latest"

    # Pinecone Configuration
    pinecone_api_key: str = ""
    pinecone_host: str = ""
    pinecone_environment: str = "us-east-1"
    pinecone_index_name: str = "qodex-documents"

    # Application Configuration
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    debug: bool = True
    log_level: str = "INFO"

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins from comma-separated string."""
        return [origin.strip() for origin in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
