from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "SHEild AI 2.0"
    API_V1_STR: str = "/api/v1"
    
    # Supabase config
    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_JWT_SECRET: str | None = None
    SUPABASE_JWT_ISSUER: str
    SUPABASE_JWT_AUDIENCE: str
    SUPABASE_JWKS_URL: str | None = None
    
    # Database
    DATABASE_URL: str
    
    # Mock Alert settings
    ALERT_PROVIDER: Literal["mock"] = "mock"
    LOCATION_RETENTION_HOURS: int = 48
    APP_ENV: str = "development"
    CORS_ORIGINS: list[str] | None = None

    @property
    def allowed_cors_origins(self) -> list[str]:
        if self.CORS_ORIGINS is not None:
            return self.CORS_ORIGINS
        return ["http://localhost:3000", "http://localhost:8081"] if self.APP_ENV == "development" else []

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
